import { PATHS, EXA_RETRY_TRIES, EXA_RETRY_BASE_MS, THEIRSTACK_RETRY_TRIES, THEIRSTACK_RETRY_BASE_MS } from '../config.js';
import { readInputCsv } from '../csv.js';
import { digitalNativeExaSearch, observabilityToolExaSearch } from '../apis/exa.js';
import { theirstackJobsByTechnology } from '../apis/theirstack.js';
import { scheduleExa, scheduleTheirstack } from '../rateLimit.js';
import { deriveDomain } from '../util.js';
import type { InputRow } from '../types.js';
import type { StageCompany, StageResult } from '../stages/types.js';
import { runStage } from '../stages/runStage.js';
import { writeStageColumn } from '../stages/writeStageColumn.js';
import { filterSurvivors } from '../stages/filterSurvivors.js';
import {
  parseDigitalNativeResponse,
  digitalNativeGate,
  formatDigitalNativeForAttio,
} from '../stages/digitalNative.js';
import {
  parseObservabilityToolResponse,
  observabilityToolGate,
  formatObservabilityToolForAttio,
} from '../stages/observabilityTool.js';
import {
  parseCommunicationToolResponse,
  communicationToolGate,
  formatCommunicationToolForAttio,
  type CommunicationToolRaw,
  type CommunicationToolData,
} from '../stages/communicationTool.js';
import {
  matchCompetitorTools,
  competitorToolGate,
  formatCompetitorToolForAttio,
  type CompetitorToolData,
} from '../stages/competitorTool.js';
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
    const { todo: comp, done: compDone } = splitByCache(companies, attioCache, FIELD_SLUGS['Competitor Tooling']!);
    console.log(`[dry] competitor-tool: todo=${comp.length} skipped=${compDone.length}`);
    const { todo: dn, done: dnDone } = splitByCache(companies, attioCache, FIELD_SLUGS['Digital Native']!);
    console.log(`[dry] digital-native: todo=${dn.length} skipped=${dnDone.length}`);
    for (let i = 0; i < dn.length; i += 2) {
      const batch = dn.slice(i, i + 2);
      console.log(`[dry]   batch: ${batch.map((c) => c.domain).join(', ')}`);
    }
    const { todo: obs, done: obsDone } = splitByCache(companies, attioCache, FIELD_SLUGS['Observability Tool']!);
    console.log(`[dry] observability-tool: todo=${obs.length} skipped=${obsDone.length}`);
    const { todo: comm, done: commDone } = splitByCache(companies, attioCache, FIELD_SLUGS['Communication Tool']!);
    console.log(`[dry] communication-tool: todo=${comm.length} skipped=${commDone.length}`);
    return;
  }

  // Stage 1 — Competitor Tool (local match, no API call)
  const stage1Slug = FIELD_SLUGS['Competitor Tooling']!;
  const { todo: stage1Todo, done: stage1Done } = splitByCache(companies, attioCache, stage1Slug);
  console.log(`[competitorTool] todo=${stage1Todo.length} skipped=${stage1Done.length}`);

  const stage1Results: StageResult<CompetitorToolData>[] = stage1Todo.map((company) => ({
    company,
    data: { matchedTools: matchCompetitorTools(company.companyName) },
  }));
  await writeStageColumn('Competitor Tooling', stage1Results, formatCompetitorToolForAttio);
  for (const r of stage1Results) {
    if (r.error === undefined) {
      const existing = attioCache.get(r.company.domain) ?? {};
      attioCache.set(r.company.domain, {
        ...existing,
        [stage1Slug]: formatCompetitorToolForAttio(r.data),
      });
    }
  }
  const stage1TodoSurvivors = filterSurvivors('competitorTool', stage1Results, competitorToolGate);
  const survivorsAfterStage1 = [...stage1TodoSurvivors, ...stage1Done];

  // Stage 2 — Digital Native
  const stage2Slug = FIELD_SLUGS['Digital Native']!;
  const { todo: stage2Todo, done: stage2Done } = splitByCache(survivorsAfterStage1, attioCache, stage2Slug);
  console.log(`[digitalNative] todo=${stage2Todo.length} skipped=${stage2Done.length}`);

  const stage2Results = await runStage({
    name: 'digitalNative',
    companies: stage2Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => digitalNativeExaSearch(domains)),
    parse: (raw, batch) => parseDigitalNativeResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Digital Native', batchResults, formatDigitalNativeForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage2Slug]: formatDigitalNativeForAttio(r.data) });
        }
      }
    },
  });

  const stage2TodoSurvivors = filterSurvivors('digitalNative', stage2Results, digitalNativeGate);
  const survivorsAfterStage2 = [...stage2TodoSurvivors, ...stage2Done];

  // Stage 3 — Observability Tool
  const stage3Slug = FIELD_SLUGS['Observability Tool']!;
  const { todo: stage3Todo, done: stage3Done } = splitByCache(survivorsAfterStage2, attioCache, stage3Slug);
  console.log(`[observabilityTool] todo=${stage3Todo.length} skipped=${stage3Done.length}`);

  const stage3Results = await runStage({
    name: 'observabilityTool',
    companies: stage3Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => observabilityToolExaSearch(domains)),
    parse: (raw, batch) => parseObservabilityToolResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Observability Tool', batchResults, formatObservabilityToolForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage3Slug]: formatObservabilityToolForAttio(r.data) });
        }
      }
    },
  });

  const stage3TodoSurvivors = filterSurvivors('observabilityTool', stage3Results, observabilityToolGate);
  const survivorsAfterStage3 = [...stage3TodoSurvivors, ...stage3Done];

  // Stage 4 — Communication Tool
  const stage4Slug = FIELD_SLUGS['Communication Tool']!;
  const { todo: stage4Todo, done: stage4Done } = splitByCache(survivorsAfterStage3, attioCache, stage4Slug);
  console.log(`[communicationTool] todo=${stage4Todo.length} skipped=${stage4Done.length}`);

  const stage4Results = await runStage<CommunicationToolRaw, CommunicationToolData>({
    name: 'communicationTool',
    companies: stage4Todo,
    batchSize: 1,
    retry: { tries: THEIRSTACK_RETRY_TRIES, baseMs: THEIRSTACK_RETRY_BASE_MS },
    call: async (domains) => {
      const domain = domains[0]!;
      const slackRes = await scheduleTheirstack(() => theirstackJobsByTechnology(domain, 'slack'));
      const slackJob = slackRes.data?.[0];
      if (slackJob?.source_url) {
        return { domain, tool: 'Slack', sourceUrl: slackJob.source_url };
      }
      const teamsRes = await scheduleTheirstack(() =>
        theirstackJobsByTechnology(domain, 'microsoft-teams')
      );
      const teamsJob = teamsRes.data?.[0];
      if (teamsJob?.source_url) {
        return { domain, tool: 'Microsoft Teams', sourceUrl: teamsJob.source_url };
      }
      return { domain, tool: null, sourceUrl: null };
    },
    parse: parseCommunicationToolResponse,
    afterBatch: async (batchResults) => {
      await writeStageColumn('Communication Tool', batchResults, formatCommunicationToolForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, {
            ...existing,
            [stage4Slug]: formatCommunicationToolForAttio(r.data),
          });
        }
      }
    },
  });

  const stage4TodoSurvivors = filterSurvivors('communicationTool', stage4Results, communicationToolGate);
  const survivorsAfterStage4 = [...stage4TodoSurvivors, ...stage4Done];

  console.log(`\n[enrich-all] survivors after stage 4 (${survivorsAfterStage4.length}):`);
  for (const c of survivorsAfterStage4) console.log(`  ${c.domain}  (${c.companyName})`);

  console.log(`\n[done] total=${companies.length} survivors=${survivorsAfterStage4.length} badDomains=${skippedBadDomain}`);
}
