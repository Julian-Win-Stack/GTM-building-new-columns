import { stringify } from 'csv-stringify/sync';
import { CSV_COLUMNS } from './columns.js';
import { FIELD_SLUGS } from '../src/apis/attio.js';

const FINAL_SCORE_SLUG = FIELD_SLUGS['Final Score']!;
const COMPANY_NAME_SLUG = FIELD_SLUGS['Company Name']!;

export function renderCsv(cache: Map<string, Record<string, string>>): string {
  const header = CSV_COLUMNS.map((c) => c.display);
  const rows: string[][] = [];
  // Sort by Final Score descending where present, then by company name
  const entries = Array.from(cache.entries()).sort(([, av], [, bv]) => {
    const aFinal = parseFinalScore(av[FINAL_SCORE_SLUG] ?? '');
    const bFinal = parseFinalScore(bv[FINAL_SCORE_SLUG] ?? '');
    if (aFinal !== bFinal) return bFinal - aFinal;
    const aName = av[COMPANY_NAME_SLUG] ?? '';
    const bName = bv[COMPANY_NAME_SLUG] ?? '';
    return aName.localeCompare(bName);
  });

  for (const [, values] of entries) {
    rows.push(CSV_COLUMNS.map((c) => values[c.slug] ?? ''));
  }

  return stringify([header, ...rows]);
}

// Final Score cells are formatted like "4.5\n\nReasoning: ...". Parse the leading number.
function parseFinalScore(cell: string): number {
  if (!cell) return -1;
  const firstLine = cell.split('\n', 1)[0]!.trim();
  const n = parseFloat(firstLine);
  return Number.isFinite(n) ? n : -1;
}
