import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { runStage } from './runStage.js';
import type { StageCompany, StageResult } from './stages/types.js';

function makeAxiosError(status: number, retryAfter?: string): Error {
  const err = new axios.AxiosError('Request failed', String(status));
  err.response = {
    status,
    headers: retryAfter ? { 'retry-after': retryAfter } : {},
    data: {},
    statusText: String(status),
    config: {} as InternalAxiosRequestConfig,
  } as AxiosResponse;
  return err;
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function makeCompanies(n: number): StageCompany[] {
  return Array.from({ length: n }, (_, i) => ({
    companyName: `Co${i}`,
    domain: `co${i}.com`,
  }));
}

describe('runStage', () => {
  it('batches companies by batchSize', async () => {
    const companies = makeCompanies(5);
    const call = vi.fn().mockResolvedValue('raw');
    const parse = vi.fn().mockImplementation((_raw: string, batch: StageCompany[]) =>
      batch.map<StageResult<string>>((c) => ({ company: c, data: 'ok' }))
    );

    await runStage({ name: 's', companies, batchSize: 2, call, parse });

    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[0]![0]).toEqual(['co0.com', 'co1.com']);
    expect(call.mock.calls[1]![0]).toEqual(['co2.com', 'co3.com']);
    expect(call.mock.calls[2]![0]).toEqual(['co4.com']);
  });

  it('aggregates per-batch parse results in order', async () => {
    const companies = makeCompanies(4);
    const call = vi.fn().mockResolvedValue('raw');
    const parse = vi.fn().mockImplementation((_raw: string, batch: StageCompany[]) =>
      batch.map<StageResult<string>>((c) => ({ company: c, data: c.domain }))
    );

    const out = await runStage({ name: 's', companies, batchSize: 2, call, parse });
    expect(out.map((r) => (r.error ? 'err' : r.data))).toEqual([
      'co0.com',
      'co1.com',
      'co2.com',
      'co3.com',
    ]);
  });

  it('converts a failed batch into per-company error results without aborting', async () => {
    const companies = makeCompanies(4);
    const call = vi
      .fn()
      .mockResolvedValueOnce('raw')
      .mockRejectedValueOnce(new Error('batch2 failed'));
    const parse = vi.fn().mockImplementation((_raw: string, batch: StageCompany[]) =>
      batch.map<StageResult<string>>((c) => ({ company: c, data: 'ok' }))
    );

    const out = await runStage({ name: 's', companies, batchSize: 2, call, parse });

    expect(out).toHaveLength(4);
    expect(out[0]!.error).toBeUndefined();
    expect(out[1]!.error).toBeUndefined();
    expect(out[2]!.error).toBe('batch2 failed');
    expect(out[3]!.error).toBe('batch2 failed');
  });

  it('stringifies non-Error throws in batch failures', async () => {
    const companies = makeCompanies(2);
    const call = vi.fn().mockRejectedValueOnce('weird-throw');
    const parse = vi.fn();

    const out = await runStage({ name: 's', companies, batchSize: 2, call, parse });
    expect(out[0]!.error).toBe('weird-throw');
    expect(parse).not.toHaveBeenCalled();
  });

  it('returns an empty array when there are no companies', async () => {
    const call = vi.fn();
    const parse = vi.fn();
    const out = await runStage({ name: 's', companies: [], batchSize: 2, call, parse });
    expect(out).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });

  it('does not abort later batches when an earlier batch throws', async () => {
    const companies = makeCompanies(4);
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error('first-fail'))
      .mockResolvedValueOnce('raw');
    const parse = vi.fn().mockImplementation((_raw: string, batch: StageCompany[]) =>
      batch.map<StageResult<string>>((c) => ({ company: c, data: 'ok' }))
    );

    const out = await runStage({ name: 's', companies, batchSize: 2, call, parse });
    expect(out[0]!.error).toBe('first-fail');
    expect(out[2]!.data).toBe('ok');
  });

  it('calls afterBatch once per batch with that batch results', async () => {
    const companies = makeCompanies(4);
    const call = vi.fn().mockResolvedValue('raw');
    const parse = vi.fn().mockImplementation((_raw: string, batch: StageCompany[]) =>
      batch.map<StageResult<string>>((c) => ({ company: c, data: c.domain }))
    );
    const afterBatch = vi.fn().mockResolvedValue(undefined);

    await runStage({ name: 's', companies, batchSize: 2, call, parse, afterBatch });

    expect(afterBatch).toHaveBeenCalledTimes(2);
    expect(afterBatch.mock.calls[0]![0]).toHaveLength(2);
    expect(afterBatch.mock.calls[1]![0]).toHaveLength(2);
  });

  it('calls afterBatch with error results when call throws', async () => {
    const companies = makeCompanies(2);
    const call = vi.fn().mockRejectedValue(new Error('API down'));
    const parse = vi.fn();
    const afterBatch = vi.fn().mockResolvedValue(undefined);

    await runStage({ name: 's', companies, batchSize: 2, call, parse, afterBatch });

    expect(afterBatch).toHaveBeenCalledTimes(1);
    const results: StageResult<string>[] = afterBatch.mock.calls[0]![0];
    expect(results).toHaveLength(2);
    expect(results[0]?.error).toBe('API down');
    expect(results[1]?.error).toBe('API down');
  });

  it('works without afterBatch (backward compat)', async () => {
    const companies = makeCompanies(2);
    const call = vi.fn().mockResolvedValue('raw');
    const parse = vi.fn().mockImplementation((_raw: string, batch: StageCompany[]) =>
      batch.map<StageResult<string>>((c) => ({ company: c, data: 'ok' }))
    );

    const results = await runStage({ name: 's', companies, batchSize: 2, call, parse });
    expect(results).toHaveLength(2);
    expect(results[0]?.error).toBeUndefined();
  });

  it('retries a failing batch up to retry.tries and succeeds on the last attempt', async () => {
    const companies = makeCompanies(2);
    const call = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(503))
      .mockRejectedValueOnce(makeAxiosError(503))
      .mockResolvedValueOnce('raw');
    const parse = vi.fn().mockImplementation((_raw: string, batch: StageCompany[]) =>
      batch.map<StageResult<string>>((c) => ({ company: c, data: 'ok' }))
    );

    const out = await runStage({
      name: 's',
      companies,
      batchSize: 2,
      call,
      parse,
      retry: { tries: 3, baseMs: 1 },
    });
    expect(call).toHaveBeenCalledTimes(3);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data).toBe('ok');
  });

  it('gives up after retry.tries exhausted and yields per-company error results', async () => {
    const companies = makeCompanies(2);
    const call = vi.fn().mockRejectedValue(makeAxiosError(500));
    const parse = vi.fn();

    const out = await runStage({
      name: 's',
      companies,
      batchSize: 2,
      call,
      parse,
      retry: { tries: 3, baseMs: 1 },
    });
    expect(call).toHaveBeenCalledTimes(3);
    expect(out[0]!.error).toBeDefined();
    expect(out[1]!.error).toBeDefined();
  });

  it('does not retry non-retryable 4xx errors', async () => {
    const companies = makeCompanies(1);
    const call = vi.fn().mockRejectedValue(makeAxiosError(400));
    const parse = vi.fn();
    const out = await runStage({ name: 's', companies, batchSize: 1, call, parse, retry: { tries: 3, baseMs: 1 } });
    expect(call).toHaveBeenCalledTimes(1);
    expect(out[0]!.error).toBeDefined();
  });

  it('retries on 429 and uses Retry-After header wait', async () => {
    const companies = makeCompanies(1);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const call = vi
      .fn()
      .mockRejectedValueOnce(makeAxiosError(429, '1'))
      .mockResolvedValueOnce('raw');
    const parse = vi.fn().mockImplementation((_raw: string, batch: StageCompany[]) =>
      batch.map<StageResult<string>>((c) => ({ company: c, data: 'ok' }))
    );
    const out = await runStage({ name: 's', companies, batchSize: 1, call, parse, retry: { tries: 3, baseMs: 1 } });
    expect(call).toHaveBeenCalledTimes(2);
    expect(out[0]!.data).toBe('ok');
  });

  it('does not block other batches while one batch is retrying', async () => {
    const companies = makeCompanies(4);
    let slowResolved = false;
    const call = vi.fn().mockImplementation(async (domains: string[]) => {
      if (domains[0] === 'co0.com') {
        await new Promise((r) => setTimeout(r, 50));
        slowResolved = true;
        return 'raw-slow';
      }
      expect(slowResolved).toBe(false);
      return 'raw-fast';
    });
    const parse = vi.fn().mockImplementation((_raw: string, batch: StageCompany[]) =>
      batch.map<StageResult<string>>((c) => ({ company: c, data: 'ok' }))
    );

    const out = await runStage({ name: 's', companies, batchSize: 2, call, parse });
    expect(out).toHaveLength(4);
  });

  it('swallows afterBatch throws so one bad write does not abort the stage', async () => {
    const companies = makeCompanies(4);
    const call = vi.fn().mockResolvedValue('raw');
    const parse = vi.fn().mockImplementation((_raw: string, batch: StageCompany[]) =>
      batch.map<StageResult<string>>((c) => ({ company: c, data: 'ok' }))
    );
    const afterBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('attio-write-blew-up'))
      .mockResolvedValue(undefined);

    const out = await runStage({
      name: 's',
      companies,
      batchSize: 2,
      call,
      parse,
      afterBatch,
    });
    expect(out).toHaveLength(4);
    expect(out.every((r) => r.error === undefined)).toBe(true);
  });
});
