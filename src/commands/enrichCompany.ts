import { PATHS } from '../config.js';
import { readInputCsv } from '../csv.js';
import { digitalNativeExaSearch } from '../apis/exa.js';
import { deriveDomain } from '../util.js';

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
  if (!row) throw new Error(`Company with domain "${opts.domain}" not found in ${csvPath}`);

  const label = row['Company Name'] || row['Website'];
  console.log(`[enrich-company] ${label} (${target}) dryRun=${!!opts.dryRun}`);

  if (opts.dryRun) {
    console.log(`[dry] digital-native Exa: ${target}`);
    return;
  }

  console.log(`\n=== [digital-native] ${target} ===`);
  const response = await digitalNativeExaSearch([target]);
  console.log(JSON.stringify(response, null, 2));
}
