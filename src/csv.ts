import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { OUTPUT_COLUMNS } from './config.js';
import type { OutputRow } from './types.js';

export async function readCsv<T extends Record<string, string> = Record<string, string>>(
  filePath: string
): Promise<T[]> {
  const text = await fsp.readFile(filePath, 'utf8');
  return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as T[];
}

export async function ensureOutputCsv(filePath: string): Promise<void> {
  try {
    await fsp.access(filePath);
  } catch {
    const header = stringify([OUTPUT_COLUMNS as unknown as string[]]);
    await fsp.writeFile(filePath, header, 'utf8');
  }
}

export async function loadProcessedKeys(
  filePath: string,
  keyFn: (row: Record<string, string>) => string
): Promise<Map<string, Record<string, string>>> {
  try {
    const rows = await readCsv(filePath);
    const done = new Map<string, Record<string, string>>();
    for (const row of rows) {
      if (row.Status === 'done') done.set(keyFn(row), row);
    }
    return done;
  } catch {
    return new Map();
  }
}

export function appendRow(filePath: string, rowObj: Partial<OutputRow>): void {
  const values = OUTPUT_COLUMNS.map((c) => (rowObj as Record<string, string>)[c] ?? '');
  const line = stringify([values]);
  fs.appendFileSync(filePath, line, 'utf8');
}

export function companyKey(row: Record<string, string>): string {
  const name = (row['Company Name'] ?? '').trim().toLowerCase();
  const site = (row['Website'] ?? row['Domain'] ?? '').trim().toLowerCase();
  return `${name}|${site}`;
}
