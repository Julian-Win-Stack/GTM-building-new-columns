import { PATHS } from '../config.js';
import { readInputCsv } from '../csv.js';
import { digitalNativeExaSearch } from '../apis/exa.js';
import { deriveDomain } from '../util.js';
import type { InputRow } from '../types.js';
import type { StageCompany } from '../stages/types.js';
import { runStage } from '../stages/runStage.js';
import { writeStageColumn } from '../stages/writeStageColumn.js';
import { filterSurvivors } from '../stages/filterSurvivors.js';
import {
  parseDigitalNativeResponse,
  digitalNativeGate,
  formatDigitalNativeForAttio,
} from '../stages/digitalNative.js';

export type EnrichAllOptions = {
  csv?: string;
  limit?: number;
  dryRun?: boolean;
};

export async function enrichAll(opts: EnrichAllOptions): Promise<void> {
  const csvPath = opts.csv ?? PATHS.defaultInputCsv;
  const rows = await readInputCsv(csvPath);
  const subset = opts.limit ? rows.slice(0, opts.limit) : rows;

  const companies: StageCompany[] = [];
  let skippedBadDomain = 0;

  for (const row of subset) {
    const label = (row as InputRow)['Company Name'] || (row as InputRow)['Website'] || '(unknown)';
    const domain = deriveDomain((row as InputRow)['Website']);
    if (!domain) {
      skippedBadDomain++;
      console.error(`[fail] ${label}: no parseable domain — skipping`);
      continue;
    }
    companies.push({ companyName: (row as InputRow)['Company Name'], domain });
  }

  console.log(
    `[enrich-all] csv=${csvPath} rows=${subset.length} companies=${companies.length} badDomains=${skippedBadDomain} dryRun=${!!opts.dryRun}`
  );

  if (opts.dryRun) {
    for (let i = 0; i < companies.length; i += 2) {
      const batch = companies.slice(i, i + 2);
      console.log(`[dry] digital-native: ${batch.map((c) => c.domain).join(', ')}`);
    }
    return;
  }

  // Stage 1 — Digital Native
  const stage1Results = await runStage({
    name: 'digitalNative',
    companies,
    batchSize: 2,
    call: (domains) => digitalNativeExaSearch(domains),
    parse: (raw, batch) => parseDigitalNativeResponse(raw, batch),
  });

  await writeStageColumn('Digital Native', stage1Results, formatDigitalNativeForAttio);

  const survivors = filterSurvivors('digitalNative', stage1Results, digitalNativeGate);

  console.log(`\n[enrich-all] survivors (${survivors.length}):`);
  for (const c of survivors) console.log(`  ${c.domain}  (${c.companyName})`);

  console.log(`\n[done] total=${companies.length} survivors=${survivors.length} badDomains=${skippedBadDomain}`);
}
