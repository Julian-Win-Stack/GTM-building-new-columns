import { PATHS } from '../config.js';
import { readInputCsv } from '../csv.js';
import { upsertCompanyByDomain } from '../apis/attio.js';
import { deriveDomain } from '../util.js';

export type AttioSmokeOptions = { domain: string; csv?: string };

export async function attioSmoke(opts: AttioSmokeOptions): Promise<void> {
  const target = opts.domain.trim().toLowerCase().replace(/^www\./, '');
  const csvPath = opts.csv ?? PATHS.defaultInputCsv;
  const rows = await readInputCsv(csvPath);
  const row = rows.find((r) => deriveDomain(r['Website']) === target);
  if (!row) throw new Error(`Company with domain "${opts.domain}" not found in ${csvPath}`);

  const companyName = row['Company Name'];
  console.log(`[attio-smoke] upserting ${companyName} (${target}) → ${PATHS.defaultInputCsv}`);
  const record = await upsertCompanyByDomain({ 'Company Name': companyName, 'Domain': target });
  console.log(`[attio-smoke] OK record_id=${record.id}`);
}
