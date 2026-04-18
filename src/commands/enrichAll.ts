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
import { fetchAllRecords, FIELD_SLUGS } from '../apis/attio.js';

export type EnrichAllOptions = {
  csv?: string;
  limit?: number;
  dryRun?: boolean;
};

function splitByCache(
  companies: StageCompany[],
  cache: Map<string, Record<string, string>>,
  slug: string
): { todo: StageCompany[]; done: StageCompany[] } {
  const todo: StageCompany[] = [];
  const done: StageCompany[] = [];
  for (const c of companies) {
    if (cache.get(c.domain)?.[slug]) done.push(c);
    else todo.push(c);
  }
  return { todo, done };
}

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

  console.log(`[enrich-all] pre-fetching Attio records…`);
  const attioCache = await fetchAllRecords(companies.map((c) => c.domain));
  console.log(`[enrich-all] attio cache loaded (${attioCache.size} records found)`);

  if (opts.dryRun) {
    const { todo, done } = splitByCache(companies, attioCache, FIELD_SLUGS['Digital Native']!);
    console.log(`[dry] digital-native: todo=${todo.length} skipped=${done.length}`);
    for (let i = 0; i < todo.length; i += 2) {
      const batch = todo.slice(i, i + 2);
      console.log(`[dry]   batch: ${batch.map((c) => c.domain).join(', ')}`);
    }
    return;
  }

  // Stage 1 — Digital Native
  const stage1Slug = FIELD_SLUGS['Digital Native']!;
  const { todo: stage1Todo, done: stage1Done } = splitByCache(companies, attioCache, stage1Slug);
  console.log(`[digitalNative] todo=${stage1Todo.length} skipped=${stage1Done.length}`);

  const stage1Results = await runStage({
    name: 'digitalNative',
    companies: stage1Todo,
    batchSize: 2,
    call: (domains) => digitalNativeExaSearch(domains),
    parse: (raw, batch) => parseDigitalNativeResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Digital Native', batchResults, formatDigitalNativeForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage1Slug]: formatDigitalNativeForAttio(r.data) });
        }
      }
    },
  });

  const stage1TodoSurvivors = filterSurvivors('digitalNative', stage1Results, digitalNativeGate);
  const survivors = [...stage1TodoSurvivors, ...stage1Done];

  console.log(`\n[enrich-all] survivors (${survivors.length}):`);
  for (const c of survivors) console.log(`  ${c.domain}  (${c.companyName})`);

  console.log(`\n[done] total=${companies.length} survivors=${survivors.length} badDomains=${skippedBadDomain}`);
}
