import { PATHS } from '../config.js';
import { readInputCsv } from '../csv.js';
import { runPipeline } from '../pipeline.js';
import { createCompany, findCompanyByDomain, updateCompany } from '../apis/attio.js';
import { deriveDomain } from '../util.js';
import type { InputRow } from '../types.js';

export type EnrichCompanyOptions = {
  domain: string;
  csv?: string;
  dryRun?: boolean;
};

export async function enrichCompany(opts: EnrichCompanyOptions): Promise<void> {
  const target = opts.domain.trim().toLowerCase().replace(/^www\./, '');
  const csvPath = opts.csv ?? PATHS.defaultInputCsv;
  const rows = await readInputCsv(csvPath);
  const row = rows.find((r) => deriveDomain(r['Website']) === target);
  if (!row) {
    throw new Error(`Company with domain "${opts.domain}" not found in ${csvPath}`);
  }

  const label = row['Company Name'] || row['Website'];
  const domain = deriveDomain(row['Website']);
  console.log(`[enrich-company] ${label} (${domain})  dryRun=${!!opts.dryRun}`);

  if (opts.dryRun) {
    console.log(`[dry] would run full pipeline and create-or-update Attio record for ${label}`);
    return;
  }

  const existing = domain ? await findCompanyByDomain(domain) : null;
  const result = await runPipeline(row);

  if (existing) {
    await updateCompany(existing.id, result);
    console.log(`[update] ${label}`);
  } else {
    await createCompany(result);
    console.log(`[create] ${label}`);
  }
}
