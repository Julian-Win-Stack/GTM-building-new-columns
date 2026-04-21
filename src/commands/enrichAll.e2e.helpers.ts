import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { ExaSearchResponse } from '../apis/exa.js';

export type CsvRow = {
  'Company Name': string;
  Website: string;
  'Company Linkedin Url': string;
  'Short Description': string;
};

export async function makeCsv(tmpDir: string, rows: Partial<CsvRow>[]): Promise<string> {
  const csvPath = path.join(tmpDir, 'input.csv');
  const header = 'Company Name,Website,Company Linkedin Url,Short Description';
  const lines = rows.map((r) =>
    [
      csvEscape(r['Company Name'] ?? ''),
      csvEscape(r['Website'] ?? ''),
      csvEscape(r['Company Linkedin Url'] ?? ''),
      csvEscape(r['Short Description'] ?? ''),
    ].join(',')
  );
  await fsp.writeFile(csvPath, [header, ...lines].join('\n'), 'utf-8');
  return csvPath;
}

function csvEscape(s: string): string {
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function makeExaResponse(companies: Record<string, unknown>[]): ExaSearchResponse {
  return {
    results: [],
    searchTime: 0,
    output: { content: { companies }, grounding: [] },
    costDollars: { total: 0 },
  };
}

export function makeExaTextResponse(text: string): ExaSearchResponse {
  return {
    results: [],
    searchTime: 0,
    output: { content: text, grounding: [] },
    costDollars: { total: 0 },
  };
}
