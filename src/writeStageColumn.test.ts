import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StageResult } from './stages/types.js';

const upsertMock = vi.fn();

vi.mock('./apis/attio.js', () => ({
  upsertCompanyByDomain: upsertMock,
}));

const { writeStageColumn } = await import('./writeStageColumn.js');

beforeEach(() => {
  upsertMock.mockReset().mockResolvedValue({ id: 'rec_1', values: {} });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('writeStageColumn', () => {
  it('upserts successful results with the formatted value', async () => {
    const results: StageResult<{ x: string }>[] = [
      { company: { companyName: 'Acme', domain: 'acme.com' }, data: { x: 'foo' } },
    ];
    await writeStageColumn('Digital Native', results, (d) => `fmt:${d.x}`);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith({
      'Company Name': 'Acme',
      Domain: 'acme.com',
      'Digital Native': 'fmt:foo',
    });
  });

  it('skips errored results', async () => {
    const results: StageResult<{ x: string }>[] = [
      { company: { companyName: 'Acme', domain: 'acme.com' }, error: 'nope' },
      { company: { companyName: 'Beta', domain: 'beta.io' }, data: { x: 'y' } },
    ];
    await writeStageColumn('Digital Native', results, (d) => d.x);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0]![0]).toMatchObject({ Domain: 'beta.io' });
  });

  it('writes nothing when all results errored', async () => {
    const results: StageResult<{ x: string }>[] = [
      { company: { companyName: 'Acme', domain: 'acme.com' }, error: 'e1' },
      { company: { companyName: 'Beta', domain: 'beta.io' }, error: 'e2' },
    ];
    await writeStageColumn('Digital Native', results, (d) => d.x);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('passes through whatever string the formatter produces, including empty strings', async () => {
    const results: StageResult<{ x: string }>[] = [
      { company: { companyName: 'Acme', domain: 'acme.com' }, data: { x: '' } },
    ];
    await writeStageColumn('Digital Native', results, (d) => d.x);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ 'Digital Native': '' })
    );
  });

  it('logs written and skipped counts', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const results: StageResult<{ x: string }>[] = [
      { company: { companyName: 'Acme', domain: 'acme.com' }, data: { x: 'a' } },
      { company: { companyName: 'Beta', domain: 'beta.io' }, error: 'e' },
    ];
    await writeStageColumn('Digital Native', results, (d) => d.x);
    const line = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(line).toContain('written=1');
    expect(line).toContain('skipped=1');
  });

  it('logs and continues when an Attio upsert throws, without aborting the batch', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    upsertMock
      .mockReset()
      .mockRejectedValueOnce(new Error('attio 500'))
      .mockResolvedValueOnce({ id: 'rec_2', values: {} });

    const results: StageResult<{ x: string }>[] = [
      { company: { companyName: 'Acme', domain: 'acme.com' }, data: { x: 'a' } },
      { company: { companyName: 'Beta', domain: 'beta.io' }, data: { x: 'b' } },
    ];
    await expect(writeStageColumn('Digital Native', results, (d) => d.x)).resolves.toBeUndefined();
    expect(upsertMock).toHaveBeenCalledTimes(2);
    const errLine = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errLine).toContain('acme.com');
    expect(errLine).toContain('attio 500');
  });

  it('logs a failed count when writes fail', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    upsertMock.mockReset().mockRejectedValue(new Error('attio boom'));

    const results: StageResult<{ x: string }>[] = [
      { company: { companyName: 'Acme', domain: 'acme.com' }, data: { x: 'a' } },
      { company: { companyName: 'Beta', domain: 'beta.io' }, data: { x: 'b' } },
    ];
    await writeStageColumn('Digital Native', results, (d) => d.x);
    const summary = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(summary).toContain('written=0');
    expect(summary).toContain('failed=2');
  });
});
