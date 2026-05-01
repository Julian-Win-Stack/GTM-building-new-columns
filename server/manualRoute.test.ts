import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['UPLOAD_DIR'] = '/tmp/manual-route-test/uploads';
  process.env['ATTIO_API_KEY'] = 'test-attio';
  process.env['EXA_API_KEY'] = 'test-exa';
  process.env['THEIRSTACK_API_KEY'] = 'test-theirstack';
  process.env['APOLLO_API_KEY'] = 'test-apollo';
  process.env['APIFY_TOKEN'] = 'test-apify';
  process.env['AZURE_OPENAI_API_KEY'] = 'test-openai';
  process.env['AZURE_OPENAI_BASE_URL'] = 'https://test.openai.azure.com';
  process.env['X_API_KEY'] = 'test-x';
});

// Mock the pipeline so tests stay at the HTTP boundary — no Exa / Apify / Apollo / OpenAI
// calls, no rate-limiter init noise. The mock captures the materialized CSV's path AND
// contents at call-time, before startRunAsync's `finally` block unlinks the file. Tests
// inspect `capture` instead of racing the unlink on disk.
const { enrichAllMock, capture } = vi.hoisted(() => {
  const capture = {
    paths: [] as string[],
    contents: new Map<string, string>(),
    callOpts: [] as Array<{ csv: string; accountPurpose?: string; skipConfirm: boolean }>,
  };
  const enrichAllMock = vi.fn(
    async (opts: { csv: string; accountPurpose?: string; skipConfirm: boolean }) => {
      const fsp = await import('node:fs/promises');
      const content = await fsp.readFile(opts.csv, 'utf8');
      capture.paths.push(opts.csv);
      capture.contents.set(opts.csv, content);
      capture.callOpts.push({
        csv: opts.csv,
        accountPurpose: opts.accountPurpose,
        skipConfirm: opts.skipConfirm,
      });
      return new Map<string, Record<string, string>>();
    }
  );
  return { enrichAllMock, capture };
});
vi.mock('../src/commands/enrichAll.js', () => ({
  enrichAll: enrichAllMock,
}));

const { app } = await import('./index.js');
const { getRun } = await import('./runRegistry.js');

const UPLOAD_DIR = '/tmp/manual-route-test/uploads';
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  enrichAllMock.mockClear();
  capture.paths.length = 0;
  capture.contents.clear();
  capture.callOpts.length = 0;
});

type ManualBody = {
  companyName?: unknown;
  website?: unknown;
  linkedinUrl?: unknown;
  description?: unknown;
  accountPurpose?: unknown;
};

async function postManual(
  body: ManualBody | string,
  contentType = 'application/json',
  expectedCaptures = 1
) {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
  const before = capture.paths.length;
  const resp = await fetch(`${baseUrl}/api/runs/manual`, init);
  const text = await resp.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // leave json undefined for malformed responses
  }
  // If the request was accepted, startRunAsync's IIFE has been scheduled but hasn't run
  // yet. Wait until the mock body has captured the materialized CSV (which happens before
  // startRunAsync's `finally` unlinks the file).
  if (resp.status === 200) {
    const deadline = Date.now() + 1000;
    while (capture.paths.length < before + expectedCaptures && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1));
    }
  }
  return { status: resp.status, json: json as { runId?: string; error?: string } | undefined };
}

function lastCapturedCsv(): string {
  const path = capture.paths.at(-1);
  if (!path) throw new Error('no captured CSV path');
  const content = capture.contents.get(path);
  if (content === undefined) throw new Error(`no captured content for ${path}`);
  return content;
}

const validBody: ManualBody = {
  companyName: 'Acme Inc.',
  website: 'acme.com',
  linkedinUrl: 'https://www.linkedin.com/company/acme',
  description: 'A widget company.',
  accountPurpose: 'Q2 2026',
};

describe('POST /api/runs/manual — happy path', () => {
  it('accepts a complete payload and returns a UUID v4 runId', async () => {
    const { status, json } = await postManual(validBody);
    expect(status).toBe(200);
    expect(json?.runId).toMatch(UUID_V4_RE);

    const run = getRun(json!.runId!);
    expect(run).toBeDefined();
    expect(run?.accountPurpose).toBe('Q2 2026');
  });

  it('accepts required-only payload (no description / accountPurpose)', async () => {
    const { status, json } = await postManual({
      companyName: 'Acme',
      website: 'acme.com',
      linkedinUrl: 'https://www.linkedin.com/company/acme',
    });
    expect(status).toBe(200);
    expect(json?.runId).toMatch(UUID_V4_RE);
    const run = getRun(json!.runId!);
    expect(run?.accountPurpose).toBeUndefined();
  });
});

describe('POST /api/runs/manual — required-field validation', () => {
  it.each([
    ['companyName', 'Company Name'],
    ['website', 'Website'],
    ['linkedinUrl', 'LinkedIn URL'],
  ])('rejects missing %s', async (field, label) => {
    const body = { ...validBody };
    delete (body as Record<string, unknown>)[field];
    const { status, json } = await postManual(body);
    expect(status).toBe(400);
    expect(json?.error).toContain(label);
    expect(json?.error?.toLowerCase()).toContain('required');
  });

  it.each([
    ['companyName', 'Company Name'],
    ['website', 'Website'],
    ['linkedinUrl', 'LinkedIn URL'],
  ])('rejects empty string %s', async (field, label) => {
    const { status, json } = await postManual({ ...validBody, [field]: '' });
    expect(status).toBe(400);
    expect(json?.error).toContain(label);
    expect(json?.error?.toLowerCase()).toContain('required');
  });

  it.each([
    ['companyName', 'Company Name'],
    ['website', 'Website'],
    ['linkedinUrl', 'LinkedIn URL'],
  ])('rejects whitespace-only %s', async (field, label) => {
    const { status, json } = await postManual({ ...validBody, [field]: '   \t  ' });
    expect(status).toBe(400);
    expect(json?.error).toContain(label);
  });

  it('rejects when all three required fields are missing', async () => {
    const { status, json } = await postManual({});
    expect(status).toBe(400);
    expect(json?.error?.toLowerCase()).toContain('required');
  });

  it('accepts when description is absent', async () => {
    const body = { ...validBody };
    delete body.description;
    const { status } = await postManual(body);
    expect(status).toBe(200);
  });

  it('accepts when accountPurpose is absent', async () => {
    const body = { ...validBody };
    delete body.accountPurpose;
    const { status } = await postManual(body);
    expect(status).toBe(200);
  });

  it('accepts when description is empty / whitespace', async () => {
    const { status: s1 } = await postManual({ ...validBody, description: '' });
    expect(s1).toBe(200);
    const { status: s2 } = await postManual({ ...validBody, description: '   ' });
    expect(s2).toBe(200);
  });
});

describe('POST /api/runs/manual — type validation', () => {
  it.each([
    ['companyName', 123],
    ['companyName', true],
    ['companyName', { foo: 'bar' }], // used to coerce to "[object Object]" and pass
    ['companyName', ['Acme']], // used to coerce to "Acme" and pass
    ['website', 42],
    ['website', { url: 'acme.com' }],
    ['linkedinUrl', false],
    ['linkedinUrl', ['https://linkedin.com/company/acme']],
    ['description', { x: 1 }],
    ['accountPurpose', 42],
  ])('rejects non-string %s (%j) with "must be a string"', async (field, value) => {
    const { status, json } = await postManual({ ...validBody, [field]: value });
    expect(status).toBe(400);
    expect(json?.error?.toLowerCase()).toContain('must be a string');
  });

  it('treats null on a required field as missing', async () => {
    const { status, json } = await postManual({ ...validBody, companyName: null });
    expect(status).toBe(400);
    expect(json?.error?.toLowerCase()).toContain('required');
  });

  it('treats null on an optional field as absent (passes)', async () => {
    const { status } = await postManual({ ...validBody, description: null, accountPurpose: null });
    expect(status).toBe(200);
  });
});

describe('POST /api/runs/manual — length limits', () => {
  it('accepts companyName at exactly 600 chars', async () => {
    const { status } = await postManual({ ...validBody, companyName: 'a'.repeat(600) });
    expect(status).toBe(200);
  });

  it('rejects companyName at 601 chars', async () => {
    const { status, json } = await postManual({ ...validBody, companyName: 'a'.repeat(601) });
    expect(status).toBe(400);
    expect(json?.error).toContain('600');
  });

  it('accepts a 600-char input that has trailing whitespace beyond 600 (trim runs first)', async () => {
    const { status } = await postManual({ ...validBody, companyName: `${'a'.repeat(600)}   ` });
    expect(status).toBe(200);
  });

  it('rejects website at 1501 chars', async () => {
    const longPath = 'a'.repeat(1500);
    const { status, json } = await postManual({ ...validBody, website: `acme.com/${longPath}` });
    expect(status).toBe(400);
    expect(json?.error).toContain('1500');
  });

  it('rejects linkedinUrl at 1501 chars', async () => {
    const { status, json } = await postManual({ ...validBody, linkedinUrl: 'a'.repeat(1501) });
    expect(status).toBe(400);
    expect(json?.error).toContain('1500');
  });

  it('accepts description at exactly 15000 chars', async () => {
    const { status } = await postManual({ ...validBody, description: 'a'.repeat(15000) });
    expect(status).toBe(200);
  });

  it('rejects description at 15001 chars', async () => {
    const { status, json } = await postManual({ ...validBody, description: 'a'.repeat(15001) });
    expect(status).toBe(400);
    expect(json?.error).toContain('15000');
  });

  it('rejects accountPurpose at 601 chars', async () => {
    const { status, json } = await postManual({ ...validBody, accountPurpose: 'a'.repeat(601) });
    expect(status).toBe(400);
    expect(json?.error).toContain('600');
  });
});

describe('POST /api/runs/manual — control-character rejection', () => {
  it.each([
    ['companyName', 'Acme\nInc'],
    ['companyName', 'Acme\rInc'],
    ['companyName', 'Acme\x00Inc'],
    ['companyName', 'Acme\x07Inc'],
    ['website', 'acme.com\nevil.com'],
    ['linkedinUrl', 'https://linkedin.com/company/\nacme'],
    ['accountPurpose', 'Q2\n2026'],
  ])('rejects %s containing control char (%j)', async (field, value) => {
    const { status, json } = await postManual({ ...validBody, [field]: value });
    expect(status).toBe(400);
    expect(json?.error?.toLowerCase()).toMatch(/control character|line break/);
  });

  it('accepts description with embedded \\n', async () => {
    const { status } = await postManual({ ...validBody, description: 'Line 1\nLine 2' });
    expect(status).toBe(200);
  });

  it('accepts description with \\r\\n', async () => {
    const { status } = await postManual({ ...validBody, description: 'Line 1\r\nLine 2' });
    expect(status).toBe(200);
  });

  it('accepts description with tabs', async () => {
    const { status } = await postManual({ ...validBody, description: 'Col1\tCol2' });
    expect(status).toBe(200);
  });

  it('rejects description with null byte', async () => {
    const { status, json } = await postManual({ ...validBody, description: 'evil\x00payload' });
    expect(status).toBe(400);
    expect(json?.error?.toLowerCase()).toContain('control character');
  });
});

describe('POST /api/runs/manual — website domain extraction (lenient by design)', () => {
  it.each([
    'www.acme.com',
    'www.acme.com/some/path',
    'www.acme.com/some/path?q=1&r=2',
    'https://acme.com',
    'http://acme.com:8080/path',
    'ACME.COM',
    'acme.co.uk',
    'sub.domain.acme.com',
  ])('accepts website "%s"', async (website) => {
    const { status } = await postManual({ ...validBody, website });
    expect(status).toBe(200);
  });

  it.each([
    ['foobar', 'no dot'],
    ['localhost', 'no dot'],
  ])('rejects website "%s" (%s)', async (website) => {
    const { status, json } = await postManual({ ...validBody, website });
    expect(status).toBe(400);
    expect(json?.error?.toLowerCase()).toContain('valid url or domain');
  });
});

describe('POST /api/runs/manual — whitespace and Unicode', () => {
  it('trims surrounding whitespace before writing to CSV', async () => {
    const { status } = await postManual({
      ...validBody,
      companyName: '  Acme  ',
    });
    expect(status).toBe(200);
    const csvText = lastCapturedCsv();
    expect(csvText).toContain('Acme');
    expect(csvText).not.toContain('  Acme  ');
  });

  it('preserves emoji in companyName and description', async () => {
    const { status } = await postManual({
      ...validBody,
      companyName: 'Acme 🚀',
      description: 'Built with ❤️ by us',
    });
    expect(status).toBe(200);
    const csvText = lastCapturedCsv();
    expect(csvText).toContain('Acme 🚀');
    expect(csvText).toContain('Built with ❤️ by us');
  });

  it('preserves CJK characters', async () => {
    const { status } = await postManual({
      ...validBody,
      companyName: '北京字节跳动',
    });
    expect(status).toBe(200);
    const csvText = lastCapturedCsv();
    expect(csvText).toContain('北京字节跳动');
  });

  it('properly quotes a companyName containing a comma', async () => {
    const { status } = await postManual({
      ...validBody,
      companyName: 'Acme, Inc.',
    });
    expect(status).toBe(200);
    const csvText = lastCapturedCsv();
    expect(csvText).toContain('"Acme, Inc."');
  });

  it('properly escapes a description containing double quotes', async () => {
    const { status } = await postManual({
      ...validBody,
      description: 'They said "ship it" loudly.',
    });
    expect(status).toBe(200);
    const csvText = lastCapturedCsv();
    expect(csvText).toContain('""ship it""');
  });
});

describe('POST /api/runs/manual — CSV materialization', () => {
  it('writes a 5-column CSV with the exact header and values', async () => {
    const { status } = await postManual({
      companyName: 'Acme',
      website: 'acme.com',
      linkedinUrl: 'https://www.linkedin.com/company/acme',
      description: 'desc',
      accountPurpose: 'AP',
    });
    expect(status).toBe(200);
    const csvText = lastCapturedCsv();
    const lines = csvText.split(/\r?\n/).filter(Boolean);
    expect(lines[0]).toBe('Company Name,Website,Company Linkedin Url,Short Description,Apollo Account Id');
    expect(lines[1]).toBe('Acme,acme.com,https://www.linkedin.com/company/acme,desc,');
    expect(lines).toHaveLength(2);
  });

  it('writes the file under UPLOAD_DIR with the manual- prefix', async () => {
    const { status } = await postManual(validBody);
    expect(status).toBe(200);
    const csvPath = capture.paths.at(-1);
    expect(csvPath).toBeTruthy();
    const resolved = path.resolve(csvPath!);
    expect(resolved.startsWith(path.resolve(UPLOAD_DIR))).toBe(true);
    expect(path.basename(resolved)).toMatch(/^manual-[0-9a-f-]+\.csv$/);
  });
});

describe('POST /api/runs/manual — run lifecycle', () => {
  it('invokes enrichAll with the materialized csv path and the right options', async () => {
    const { status, json } = await postManual(validBody);
    expect(status).toBe(200);

    expect(enrichAllMock).toHaveBeenCalled();
    const callOpts = capture.callOpts.at(-1);
    expect(callOpts).toBeDefined();
    expect(callOpts!.accountPurpose).toBe('Q2 2026');
    expect(callOpts!.skipConfirm).toBe(true);
    expect(path.basename(callOpts!.csv)).toMatch(/^manual-[0-9a-f-]+\.csv$/);

    const run = getRun(json!.runId!);
    expect(run).toBeDefined();
  });
});

describe('POST /api/runs/manual — concurrent calls', () => {
  it('produces 5 distinct runIds and 5 distinct CSV file paths in parallel', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postManual(validBody, 'application/json', 5))
    );
    const runIds = responses.map((r) => r.json?.runId);
    expect(new Set(runIds).size).toBe(5);
    expect(runIds.every((id) => UUID_V4_RE.test(id ?? ''))).toBe(true);

    expect(capture.paths.length).toBeGreaterThanOrEqual(5);
    const uniquePaths = new Set(capture.paths.slice(-5));
    expect(uniquePaths.size).toBe(5);
  });
});

describe('POST /api/runs/manual — malformed body', () => {
  it('rejects non-JSON body when Content-Type is application/json', async () => {
    const { status } = await postManual('not-valid-json', 'application/json');
    // express.json() returns 400 on parse failure before our handler runs
    expect(status).toBe(400);
  });

  it('rejects oversize JSON body (> 1 MB)', async () => {
    const huge = { ...validBody, description: 'a'.repeat(1_100_000) };
    const { status } = await postManual(huge);
    // express returns 413 (PayloadTooLarge) when body exceeds the configured limit
    expect(status).toBe(413);
  });

  it('treats a text/plain body as missing JSON (handler sees empty body, requires fields)', async () => {
    const { status, json } = await postManual('hello world', 'text/plain');
    expect(status).toBe(400);
    expect(json?.error?.toLowerCase()).toContain('required');
  });
});

