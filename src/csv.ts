import fsp from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import type { InputRow } from './types.js';

export async function readInputCsv(filePath: string): Promise<InputRow[]> {
  const text = await fsp.readFile(filePath, 'utf8');
  return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as InputRow[];
}
