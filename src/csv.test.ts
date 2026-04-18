import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readInputCsv } from './csv.js';

describe('readInputCsv', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gtm-csv-test-'));
  });
  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeCsv(contents: string): Promise<string> {
    const p = path.join(tmpDir, 'input.csv');
    await fsp.writeFile(p, contents, 'utf8');
    return p;
  }

  it('parses headers into object keys', async () => {
    const file = await writeCsv(
      'Company Name,Website,Company Linkedin Url\nAcme,acme.com,https://linkedin.com/company/acme\n'
    );
    const rows = await readInputCsv(file);
    expect(rows).toEqual([
      {
        'Company Name': 'Acme',
        Website: 'acme.com',
        'Company Linkedin Url': 'https://linkedin.com/company/acme',
      },
    ]);
  });

  it('parses multiple rows', async () => {
    const file = await writeCsv(
      'Company Name,Website,Company Linkedin Url\nAcme,acme.com,a\nBeta,beta.io,b\n'
    );
    const rows = await readInputCsv(file);
    expect(rows).toHaveLength(2);
    expect(rows[0]!['Company Name']).toBe('Acme');
    expect(rows[1]!['Company Name']).toBe('Beta');
  });

  it('skips empty lines', async () => {
    const file = await writeCsv(
      'Company Name,Website,Company Linkedin Url\nAcme,acme.com,a\n\n\nBeta,beta.io,b\n'
    );
    const rows = await readInputCsv(file);
    expect(rows).toHaveLength(2);
  });

  it('trims whitespace around values', async () => {
    const file = await writeCsv(
      'Company Name,Website,Company Linkedin Url\n  Acme  ,  acme.com  ,  a  \n'
    );
    const rows = await readInputCsv(file);
    expect(rows[0]!['Company Name']).toBe('Acme');
    expect(rows[0]!['Website']).toBe('acme.com');
  });

  it('returns empty array when the file has only a header row', async () => {
    const file = await writeCsv('Company Name,Website,Company Linkedin Url\n');
    const rows = await readInputCsv(file);
    expect(rows).toEqual([]);
  });

  it('rejects when the file does not exist', async () => {
    await expect(readInputCsv(path.join(tmpDir, 'missing.csv'))).rejects.toThrow();
  });
});
