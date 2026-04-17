import { PATHS } from '../config.js';
import { readInputCsv } from '../csv.js';
import { digitalNativeExaSearch } from '../apis/exa.js';
import { deriveDomain } from '../util.js';
import type { InputRow } from '../types.js';

export type EnrichAllOptions = {
  csv?: string;
  limit?: number;
  dryRun?: boolean;
};

export async function enrichAll(opts: EnrichAllOptions): Promise<void> {
  const csvPath = opts.csv ?? PATHS.defaultInputCsv;
  const rows = await readInputCsv(csvPath);
  const subset = opts.limit ? rows.slice(0, opts.limit) : rows;

  type Usable = { row: InputRow; domain: string; label: string };
  const usable: Usable[] = [];
  let skippedBadDomain = 0;

  for (const row of subset) {
    const label = row['Company Name'] || row['Website'] || '(unknown)';
    const domain = deriveDomain(row['Website']);
    if (!domain) {
      skippedBadDomain++;
      console.error(`[fail] ${label}: no parseable domain in Website — skipping`);
      continue;
    }
    usable.push({ row, domain, label });
  }

  const batches: Usable[][] = [];
  for (let i = 0; i < usable.length; i += 2) batches.push(usable.slice(i, i + 2));

  console.log(
    `[enrich-all] csv=${csvPath} rows=${subset.length} usable=${usable.length} batches=${batches.length} badDomains=${skippedBadDomain} dryRun=${!!opts.dryRun}`
  );

  for (const batch of batches) {
    const domains = batch.map((b) => b.domain);
    const labels = batch.map((b) => b.label).join(' + ');

    if (opts.dryRun) {
      console.log(`[dry] digital-native Exa: ${domains.join(', ')}  (${labels})`);
      continue;
    }

    console.log(`\n=== [digital-native] batch: ${domains.join(', ')}  (${labels}) ===`);
    try {
      const response = await digitalNativeExaSearch(domains);
      console.log(JSON.stringify(response, null, 2));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[fail] digital-native batch ${domains.join(', ')}: ${msg}`);
    }
  }

  console.log(`\n[done] batches=${batches.length} badDomains=${skippedBadDomain}`);
}
