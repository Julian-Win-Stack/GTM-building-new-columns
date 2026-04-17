import { PATHS } from '../config.js';
import { readInputCsv } from '../csv.js';
import { runSingleEnricher } from '../pipeline.js';
import { findCompanyByDomain, updateCompany } from '../apis/attio.js';
import { ENRICHABLE_COLUMN_LIST } from '../enrichers/index.js';
import { deriveDomain, nowIso } from '../util.js';
import type { EnrichableColumn, InputRow } from '../types.js';

export type EnrichColumnOptions = {
  domain: string;
  column: string;
  csv?: string;
  dryRun?: boolean;
};

export async function enrichColumn(opts: EnrichColumnOptions): Promise<void> {
  if (!ENRICHABLE_COLUMN_LIST.includes(opts.column as EnrichableColumn)) {
    throw new Error(
      `Unknown column "${opts.column}". Valid columns:\n  - ${ENRICHABLE_COLUMN_LIST.join('\n  - ')}`
    );
  }
  const column = opts.column as EnrichableColumn;

  const target = opts.domain.trim().toLowerCase().replace(/^www\./, '');
  const csvPath = opts.csv ?? PATHS.defaultInputCsv;
  const rows = await readInputCsv(csvPath);
  const row = rows.find((r) => deriveDomain(r['Website']) === target);
  if (!row) {
    throw new Error(`Company with domain "${opts.domain}" not found in ${csvPath}`);
  }

  const label = row['Company Name'] || row['Website'];
  const domain = deriveDomain(row['Website']);
  console.log(`[enrich-column] ${label} column="${column}" dryRun=${!!opts.dryRun}`);

  if (opts.dryRun) {
    console.log(`[dry] would run enricher for "${column}" and UPDATE Attio record for ${label}`);
    return;
  }

  const existing = domain ? await findCompanyByDomain(domain) : null;
  if (!existing) {
    throw new Error(
      `Company "${label}" is not in Attio — use enrich-company to create it before overwriting a single column`
    );
  }

  const value = await runSingleEnricher(row, column);
  await updateCompany(existing.id, {
    [column]: value,
    'Last Attempt': nowIso(),
  } as Record<string, string>);
  console.log(`[update] ${label}: ${column} = ${JSON.stringify(value)}`);
}
