import { stringify } from 'csv-stringify/sync';
import { CSV_COLUMNS } from './columns.js';

export function renderCsv(cache: Map<string, Record<string, string>>): string {
  const header = CSV_COLUMNS.map((c) => c.display);
  const rows: string[][] = [];
  // Sort by Final Score descending where present, then by company name
  const entries = Array.from(cache.entries()).sort(([, av], [, bv]) => {
    const aFinal = parseFinalScore(av['account_score'] ?? '');
    const bFinal = parseFinalScore(bv['account_score'] ?? '');
    if (aFinal !== bFinal) return bFinal - aFinal;
    const aName = av['company_name'] ?? '';
    const bName = bv['company_name'] ?? '';
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
