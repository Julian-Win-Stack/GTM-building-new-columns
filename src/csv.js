import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { OUTPUT_COLUMNS } from './config.js';

export async function readCsv(filePath) {
  const text = await fsp.readFile(filePath, 'utf8');
  return parse(text, { columns: true, skip_empty_lines: true, trim: true });
}

export async function ensureOutputCsv(filePath) {
  try {
    await fsp.access(filePath);
  } catch {
    const header = stringify([OUTPUT_COLUMNS]);
    await fsp.writeFile(filePath, header, 'utf8');
  }
}

export async function loadProcessedKeys(filePath, keyFn) {
  try {
    const rows = await readCsv(filePath);
    const done = new Map();
    for (const row of rows) {
      if (row.Status === 'done') done.set(keyFn(row), row);
    }
    return done;
  } catch {
    return new Map();
  }
}

export function appendRow(filePath, rowObj) {
  const values = OUTPUT_COLUMNS.map((c) => rowObj[c] ?? '');
  const line = stringify([values]);
  fs.appendFileSync(filePath, line, 'utf8');
}

export function companyKey(row) {
  const name = (row['Company Name'] ?? '').trim().toLowerCase();
  const site = (row['Website'] ?? row['Domain'] ?? '').trim().toLowerCase();
  return `${name}|${site}`;
}
