import { PATHS, EXA_RETRY_TRIES, EXA_RETRY_BASE_MS, THEIRSTACK_RETRY_TRIES, THEIRSTACK_RETRY_BASE_MS, APOLLO_RETRY_TRIES, APOLLO_RETRY_BASE_MS, APIFY_RETRY_TRIES, APIFY_RETRY_BASE_MS, TWITTER_API_RETRY_TRIES, TWITTER_API_RETRY_BASE_MS } from '../config.js';
import { readInputCsv } from '../csv.js';
import { digitalNativeExaSearch, observabilityToolExaSearch, cloudToolExaSearch, fundingGrowthExaSearch, revenueGrowthExaSearch, numberOfUsersExaSearch } from '../apis/exa.js';
import { collectJobUrls, theirstackJobsByTechnology } from '../apis/theirstack.js';
import { scheduleExa, scheduleTheirstack, scheduleApollo, scheduleApify, scheduleTwitterApi } from '../rateLimit.js';
import { deriveDomain, normalizeLinkedInUrl } from '../util.js';
import type { InputRow } from '../types.js';
import type { StageCompany, StageResult } from '../stages/types.js';
import { runStage } from '../runStage.js';
import { writeStageColumn } from '../writeStageColumn.js';
import { filterSurvivors, filterCachedSurvivors } from '../filterSurvivors.js';
import {
  parseDigitalNativeResponse,
  digitalNativeGate,
  formatDigitalNativeForAttio,
  digitalNativeCacheGate,
} from '../stages/digitalNative.js';
import {
  parseObservabilityToolResponse,
  observabilityToolGate,
  formatObservabilityToolForAttio,
  observabilityToolCacheGate,
} from '../stages/observabilityTool.js';
import {
  parseCommunicationToolResponse,
  communicationToolGate,
  formatCommunicationToolForAttio,
  communicationToolCacheGate,
  type CommunicationToolRaw,
  type CommunicationToolData,
} from '../stages/communicationTool.js';
import {
  matchCompetitorTools,
  competitorToolGate,
  formatCompetitorToolForAttio,
  competitorToolCacheGate,
  type CompetitorToolData,
} from '../stages/competitorTool.js';
import {
  parseCloudToolResponse,
  cloudToolGate,
  formatCloudToolForAttio,
  cloudToolCacheGate,
} from '../stages/cloudTool.js';
import { parseFundingGrowthResponse, formatFundingGrowthForAttio } from '../stages/fundingGrowth.js';
import { parseRevenueGrowthResponse, formatRevenueGrowthForAttio } from '../stages/revenueGrowth.js';
import { parseNumberOfUsersResponse, formatNumberOfUsersForAttio } from '../stages/numberOfUsers.js';
import { apolloMixedPeopleApiSearch } from '../apis/apollo.js';
import { parseNumberOfEngineersResponse, formatNumberOfEngineersForAttio, ENGINEER_TITLES } from '../stages/numberOfEngineers.js';
import { parseNumberOfSresResponse, formatNumberOfSresForAttio, SRE_TITLES, type NumberOfSresData } from '../stages/numberOfSres.js';
import { runHarvestLinkedInEmployees, runCareerSiteJobListings, type HarvestEmployeesResponse, type CareerSiteJobListingsResponse } from '../apis/apify.js';
import { parseHiringResponse, formatEngineerHiringForAttio, formatSreHiringForAttio, type CombinedHiringData } from '../stages/engineerHiring.js';
import { parseCustomerComplaintsResponse, formatCustomerComplaintsForAttio, type CustomerComplaintsData } from '../stages/customerComplaintsOnX.js';
import { fetchComplaintTweets } from '../apis/twitterapi.js';
import { fetchAllRecords, upsertCompanyByDomain, FIELD_SLUGS } from '../apis/attio.js';
import { attioWriteLimit } from '../rateLimit.js';

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
  const linkedinByDomain = new Map<string, string>();
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
    const li = normalizeLinkedInUrl((row as InputRow)['Company Linkedin Url'] ?? '');
    if (li) linkedinByDomain.set(domain, li);
  }

  console.log(
    `[enrich-all] csv=${csvPath} rows=${subset.length} companies=${companies.length} badDomains=${skippedBadDomain} dryRun=${!!opts.dryRun}`
  );

  console.log(`[enrich-all] pre-fetching Attio records…`);
  const attioCache = await fetchAllRecords(companies.map((c) => c.domain));
  console.log(`[enrich-all] attio cache loaded (${attioCache.size} records found)`);

  // Write LinkedIn URL for companies that don't yet have an Attio record
  const newCompanies = companies.filter((c) => !attioCache.has(c.domain) && linkedinByDomain.has(c.domain));
  if (newCompanies.length > 0 && !opts.dryRun) {
    console.log(`[enrich-all] writing LinkedIn URL for ${newCompanies.length} new companies…`);
    await Promise.all(
      newCompanies.map((c) =>
        attioWriteLimit(() =>
          upsertCompanyByDomain({
            'Company Name': c.companyName,
            'Domain': c.domain,
            'LinkedIn Page': linkedinByDomain.get(c.domain)!,
          }).catch((err) => {
            console.error(`[linkedin-preflight] failed for ${c.domain}: ${err instanceof Error ? err.message : String(err)}`);
          })
        )
      )
    );
  }

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
    const { todo: cloud, done: cloudDone } = splitByCache(companies, attioCache, FIELD_SLUGS['Cloud Tool']!);
    console.log(`[dry] cloud-tool: todo=${cloud.length} skipped=${cloudDone.length}`);
    const { todo: fg, done: fgDone } = splitByCache(companies, attioCache, FIELD_SLUGS['Funding Growth']!);
    console.log(`[dry] funding-growth: todo=${fg.length} skipped=${fgDone.length}`);
    const { todo: rg, done: rgDone } = splitByCache(companies, attioCache, FIELD_SLUGS['Revenue Growth']!);
    console.log(`[dry] revenue-growth: todo=${rg.length} skipped=${rgDone.length}`);
    const { todo: nou, done: nouDone } = splitByCache(companies, attioCache, FIELD_SLUGS['Number of Users']!);
    console.log(`[dry] number-of-users: todo=${nou.length} skipped=${nouDone.length}`);
    const { todo: cc, done: ccDone } = splitByCache(companies, attioCache, FIELD_SLUGS['Customer complains on X']!);
    console.log(`[dry] customer-complaints-on-x: todo=${cc.length} skipped=${ccDone.length}`);
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
  const stage1DoneSurvivors = filterCachedSurvivors('competitorTool', stage1Done, attioCache, stage1Slug, competitorToolCacheGate);
  const survivorsAfterStage1 = [...stage1TodoSurvivors, ...stage1DoneSurvivors];

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
  const stage2DoneSurvivors = filterCachedSurvivors('digitalNative', stage2Done, attioCache, stage2Slug, digitalNativeCacheGate);
  const survivorsAfterStage2 = [...stage2TodoSurvivors, ...stage2DoneSurvivors];

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
  const stage3DoneSurvivors = filterCachedSurvivors('observabilityTool', stage3Done, attioCache, stage3Slug, observabilityToolCacheGate);
  const survivorsAfterStage3 = [...stage3TodoSurvivors, ...stage3DoneSurvivors];

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
      if (slackJob) {
        const sourceUrl = collectJobUrls(slackJob);
        if (sourceUrl) return { domain, tool: 'Slack', sourceUrl };
      }
      const teamsRes = await scheduleTheirstack(() =>
        theirstackJobsByTechnology(domain, 'microsoft-teams')
      );
      const teamsJob = teamsRes.data?.[0];
      if (teamsJob) {
        const sourceUrl = collectJobUrls(teamsJob);
        if (sourceUrl) return { domain, tool: 'Microsoft Teams', sourceUrl };
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
  const stage4DoneSurvivors = filterCachedSurvivors('communicationTool', stage4Done, attioCache, stage4Slug, communicationToolCacheGate);
  const survivorsAfterStage4 = [...stage4TodoSurvivors, ...stage4DoneSurvivors];

  // Stage 5 — Cloud Tool
  const stage5Slug = FIELD_SLUGS['Cloud Tool']!;
  const { todo: stage5Todo, done: stage5Done } = splitByCache(survivorsAfterStage4, attioCache, stage5Slug);
  console.log(`[cloudTool] todo=${stage5Todo.length} skipped=${stage5Done.length}`);

  const stage5Results = await runStage({
    name: 'cloudTool',
    companies: stage5Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => cloudToolExaSearch(domains)),
    parse: (raw, batch) => parseCloudToolResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Cloud Tool', batchResults, formatCloudToolForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage5Slug]: formatCloudToolForAttio(r.data) });
        }
      }
    },
  });

  const stage5TodoSurvivors = filterSurvivors('cloudTool', stage5Results, cloudToolGate);
  const stage5DoneSurvivors = filterCachedSurvivors('cloudTool', stage5Done, attioCache, stage5Slug, cloudToolCacheGate);
  const survivorsAfterStage5 = [...stage5TodoSurvivors, ...stage5DoneSurvivors];

  console.log(`\n[enrich-all] survivors after stage 5 (${survivorsAfterStage5.length}):`);
  for (const c of survivorsAfterStage5) console.log(`  ${c.domain}  (${c.companyName})`);

  // Stage 6 — Funding Growth (non-gating, data collection only)
  const stage6Slug = FIELD_SLUGS['Funding Growth']!;
  const { todo: stage6Todo, done: stage6Done } = splitByCache(survivorsAfterStage5, attioCache, stage6Slug);
  console.log(`[fundingGrowth] todo=${stage6Todo.length} skipped=${stage6Done.length}`);

  await runStage({
    name: 'fundingGrowth',
    companies: stage6Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => fundingGrowthExaSearch(domains)),
    parse: (raw, batch) => parseFundingGrowthResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Funding Growth', batchResults, formatFundingGrowthForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage6Slug]: formatFundingGrowthForAttio(r.data) });
        }
      }
    },
  });

  // Stage 7 — Revenue Growth (non-gating, data collection only)
  const stage7Slug = FIELD_SLUGS['Revenue Growth']!;
  const { todo: stage7Todo, done: stage7Done } = splitByCache(survivorsAfterStage5, attioCache, stage7Slug);
  console.log(`[revenueGrowth] todo=${stage7Todo.length} skipped=${stage7Done.length}`);

  await runStage({
    name: 'revenueGrowth',
    companies: stage7Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => revenueGrowthExaSearch(domains)),
    parse: (raw, batch) => parseRevenueGrowthResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Revenue Growth', batchResults, formatRevenueGrowthForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage7Slug]: formatRevenueGrowthForAttio(r.data) });
        }
      }
    },
  });

  // Stage 8 — Number of Users (non-gating, data collection only)
  const stage8Slug = FIELD_SLUGS['Number of Users']!;
  const { todo: stage8Todo, done: stage8Done } = splitByCache(survivorsAfterStage5, attioCache, stage8Slug);
  console.log(`[numberOfUsers] todo=${stage8Todo.length} skipped=${stage8Done.length}`);

  await runStage({
    name: 'numberOfUsers',
    companies: stage8Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => numberOfUsersExaSearch(domains)),
    parse: (raw, batch) => parseNumberOfUsersResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Number of Users', batchResults, formatNumberOfUsersForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage8Slug]: formatNumberOfUsersForAttio(r.data) });
        }
      }
    },
  });

  // Stage 9 — Number of Engineers (non-gating, data collection only)
  const stage9Slug = FIELD_SLUGS['Number of Engineers']!;
  const { todo: stage9Todo, done: stage9Done } = splitByCache(survivorsAfterStage5, attioCache, stage9Slug);
  console.log(`[numberOfEngineers] todo=${stage9Todo.length} skipped=${stage9Done.length}`);

  await runStage({
    name: 'numberOfEngineers',
    companies: stage9Todo,
    batchSize: 1,
    retry: { tries: APOLLO_RETRY_TRIES, baseMs: APOLLO_RETRY_BASE_MS },
    call: (domains) => {
      const domain = domains[0]!;
      return scheduleApollo(() => apolloMixedPeopleApiSearch(domain, ENGINEER_TITLES));
    },
    parse: (raw, batch) => parseNumberOfEngineersResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Number of Engineers', batchResults, formatNumberOfEngineersForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage9Slug]: formatNumberOfEngineersForAttio(r.data) });
        }
      }
    },
  });

  // Stage 10 — Number of SREs (non-gating, data collection only)
  const stage10Slug = FIELD_SLUGS['Number of SREs']!;
  const { todo: stage10Todo, done: stage10Done } = splitByCache(survivorsAfterStage5, attioCache, stage10Slug);
  console.log(`[numberOfSres] todo=${stage10Todo.length} skipped=${stage10Done.length}`);

  const stage10NoLinkedIn = stage10Todo.filter((c) => !linkedinByDomain.has(c.domain));
  const stage10HaveLinkedIn = stage10Todo.filter((c) => linkedinByDomain.has(c.domain));

  if (stage10NoLinkedIn.length > 0) {
    console.log(`[numberOfSres] writing N/A for ${stage10NoLinkedIn.length} companies missing LinkedIn URL`);
    const naResults: { company: StageCompany; data: NumberOfSresData }[] = stage10NoLinkedIn.map((c) => ({
      company: c,
      data: { count: 0, linkedinUrls: [], na: true as const },
    }));
    await writeStageColumn('Number of SREs', naResults, formatNumberOfSresForAttio);
    for (const r of naResults) {
      const existing = attioCache.get(r.company.domain) ?? {};
      attioCache.set(r.company.domain, { ...existing, [stage10Slug]: 'N/A' });
    }
  }

  await runStage<HarvestEmployeesResponse, NumberOfSresData>({
    name: 'numberOfSres',
    companies: stage10HaveLinkedIn,
    batchSize: 1,
    retry: { tries: APIFY_RETRY_TRIES, baseMs: APIFY_RETRY_BASE_MS },
    call: (domains) => {
      const domain = domains[0]!;
      const url = linkedinByDomain.get(domain)!;
      return scheduleApify(() => runHarvestLinkedInEmployees(url, [...SRE_TITLES]));
    },
    parse: (raw, batch) => parseNumberOfSresResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Number of SREs', batchResults, formatNumberOfSresForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage10Slug]: formatNumberOfSresForAttio(r.data) });
        }
      }
    },
  });

  // Stage 11+12 — Engineer Hiring + SRE Hiring (non-gating, single Apify call feeds both columns)
  const stage11EngSlug = FIELD_SLUGS['Engineer Hiring']!;
  const stage11SreSlug = FIELD_SLUGS['SRE Hiring']!;
  const stage11Todo = survivorsAfterStage5.filter((c) => {
    const cached = attioCache.get(c.domain) ?? {};
    return !cached[stage11EngSlug] || !cached[stage11SreSlug];
  });
  const stage11Done = survivorsAfterStage5.filter((c) => {
    const cached = attioCache.get(c.domain) ?? {};
    return !!cached[stage11EngSlug] && !!cached[stage11SreSlug];
  });
  console.log(`[engineerHiring+sreHiring] todo=${stage11Todo.length} skipped=${stage11Done.length}`);

  await runStage<CareerSiteJobListingsResponse, CombinedHiringData>({
    name: 'engineerHiring+sreHiring',
    companies: stage11Todo,
    batchSize: 1,
    retry: { tries: APIFY_RETRY_TRIES, baseMs: APIFY_RETRY_BASE_MS },
    call: (domains) => scheduleApify(() => runCareerSiteJobListings(domains[0]!)),
    parse: (raw, batch) => parseHiringResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Engineer Hiring', batchResults, formatEngineerHiringForAttio);
      await writeStageColumn('SRE Hiring', batchResults, formatSreHiringForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, {
            ...existing,
            [stage11EngSlug]: formatEngineerHiringForAttio(r.data),
            [stage11SreSlug]: formatSreHiringForAttio(r.data),
          });
        }
      }
    },
  });

  // Stage 13 — Customer complains on X (non-gating, data collection only)
  const stage13Slug = FIELD_SLUGS['Customer complains on X']!;
  const { todo: stage13Todo, done: stage13Done } = splitByCache(survivorsAfterStage5, attioCache, stage13Slug);
  console.log(`[customerComplaintsOnX] todo=${stage13Todo.length} skipped=${stage13Done.length}`);

  const companyNameByDomain13 = new Map(stage13Todo.map((c) => [c.domain, c.companyName]));

  await runStage<string[], CustomerComplaintsData>({
    name: 'customerComplaintsOnX',
    companies: stage13Todo,
    batchSize: 1,
    retry: { tries: TWITTER_API_RETRY_TRIES, baseMs: TWITTER_API_RETRY_BASE_MS },
    call: (domains) => {
      const domain = domains[0]!;
      const name = companyNameByDomain13.get(domain) ?? '';
      return fetchComplaintTweets(domain, name);
    },
    parse: (raw, batch) => parseCustomerComplaintsResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Customer complains on X', batchResults, formatCustomerComplaintsForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage13Slug]: formatCustomerComplaintsForAttio(r.data) });
        }
      }
    },
  });

  console.log(`\n[done] total=${companies.length} survivors=${survivorsAfterStage5.length} badDomains=${skippedBadDomain}`);
}
