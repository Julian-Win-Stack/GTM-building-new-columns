import { PATHS, EXA_RETRY_TRIES, EXA_RETRY_BASE_MS, THEIRSTACK_RETRY_TRIES, THEIRSTACK_RETRY_BASE_MS, APOLLO_RETRY_TRIES, APOLLO_RETRY_BASE_MS, APIFY_RETRY_TRIES, APIFY_RETRY_BASE_MS, TWITTER_API_RETRY_TRIES, TWITTER_API_RETRY_BASE_MS, STATUSPAGE_RETRY_TRIES, STATUSPAGE_RETRY_BASE_MS, ENRICHABLE_COLUMNS } from '../config.js';
import { readInputCsv } from '../csv.js';
import { digitalNativeExaSearch, observabilityToolExaSearch, cloudToolExaSearch, fundingGrowthExaSearch, revenueGrowthExaSearch, numberOfUsersExaSearch, aiAdoptionMindsetExaSearch, aiSreMaturityExaSearch, industryExaSearch, type ExaSearchResponse } from '../apis/exa.js';
import { collectJobUrls, theirstackJobsByTechnology, theirstackJobsByAnySlugs } from '../apis/theirstack.js';
import { scheduleExa, scheduleTheirstack, scheduleApollo, scheduleApify, scheduleTwitterApi } from '../rateLimit.js';
import { deriveDomain, normalizeLinkedInUrl } from '../util.js';
import type { EnrichmentResult, InputRow } from '../types.js';
import type { StageCompany, StageResult } from '../stages/types.js';
import { runStage } from '../runStage.js';
import { writeStageColumn } from '../writeStageColumn.js';
import { filterSurvivors, filterCachedSurvivors } from '../filterSurvivors.js';
import { writeRejectionReasons } from '../writeRejectionReason.js';
import {
  digitalNativeRejectionReason, digitalNativeCacheRejectionReason,
  numberOfUsersRejectionReason,
  observabilityToolRejectionReason, observabilityToolCacheRejectionReason,
  communicationToolRejectionReason, communicationToolCacheRejectionReason,
  cloudToolRejectionReason, cloudToolCacheRejectionReason,
} from '../rejectionReasons.js';
import {
  parseDigitalNativeResponse,
  digitalNativeGate,
  formatDigitalNativeForAttio,
  digitalNativeCacheGate,
  getDigitalNativeCategoryFromCached,
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
  formatCompetitorToolForAttio,
  detectCompetitorToolsFromTheirStack,
  COMPETITOR_THEIRSTACK_SLUGS,
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
import { parseNumberOfUsersResponse, formatNumberOfUsersForAttio, extractUserCountBucketFromCached, type UserCountBucket } from '../stages/numberOfUsers.js';
import { apolloMixedPeopleApiSearch } from '../apis/apollo.js';
import { parseNumberOfEngineersResponse, formatNumberOfEngineersForAttio, ENGINEER_TITLES } from '../stages/numberOfEngineers.js';
import { parseNumberOfSresResponse, formatNumberOfSresForAttio, SRE_TITLES, type NumberOfSresData } from '../stages/numberOfSres.js';
import { runHarvestLinkedInEmployees, runCareerSiteJobListings, type HarvestEmployeesResponse, type CareerSiteJobListingsResponse } from '../apis/apify.js';
import { parseHiringResponse, formatEngineerHiringForAttio, formatSreHiringForAttio, type CombinedHiringData } from '../stages/engineerHiring.js';
import { parseCustomerComplaintsResponse, formatCustomerComplaintsForAttio, type CustomerComplaintsData } from '../stages/customerComplaintsOnX.js';
import { fetchComplaintTweets, type TweetItem } from '../apis/twitterapi.js';
import { parseRecentIncidentsResponse, formatRecentIncidentsForAttio, type RecentIncidentsData } from '../stages/recentIncidents.js';
import { fetchRecentIncidents, type FetchOutcome as StatuspageFetchOutcome } from '../apis/statuspage.js';
import { parseAiAdoptionMindsetResponse, formatAiAdoptionMindsetForAttio, type AiAdoptionMindsetData } from '../stages/aiAdoptionMindset.js';
import { parseAiSreMaturityResponse, formatAiSreMaturityForAttio, type AiSreMaturityData } from '../stages/aiSreMaturity.js';
import { parseIndustryResponse, formatIndustryForAttio, type IndustryData } from '../stages/industry.js';
import { computeInputHash, scoreCompanyContext, formatContextScoreForAttio, type ContextScoreData } from '../stages/companyContextScore.js';
import { scoreToolingMatch, formatToolingMatchScoreForAttio, TOOLING_MATCH_INPUT_COLUMNS, type ToolingMatchScoreData } from '../stages/toolingMatchScore.js';
import { scoreIntentSignal, formatIntentSignalScoreForAttio, INTENT_SIGNAL_INPUT_COLUMNS, type IntentSignalScoreData } from '../stages/intentSignalScore.js';
import { scoreFinal, formatFinalScoreForAttio, FINAL_SCORE_INPUT_COLUMNS, type FinalScoreData } from '../stages/finalScore.js';
import { fetchAllRecords, upsertCompanyByDomain, FIELD_SLUGS } from '../apis/attio.js';
import { attioWriteLimit } from '../rateLimit.js';

export type EnrichAllOptions = {
  csv?: string;
  limit?: number;
  accountPurpose?: string;
  // Internal: tests set this to skip the 3-second pre-run countdown so the suite stays fast.
  // Not exposed as a CLI flag; the wrapper script and src/index.ts never set it.
  skipConfirm?: boolean;
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

  type CsvIdentity = {
    name: string;
    domain: string;
    linkedinUrl: string;
    description: string;
    website: string;
    apolloId: string;
  };

  const csvIdentities: CsvIdentity[] = [];
  const companies: StageCompany[] = [];
  const linkedinByDomain = new Map<string, string>();
  const skippedRows: Array<{ name: string; linkedinUrl?: string; missingApolloId: boolean }> = [];
  const missingApolloIdRows: Array<{ name: string; domain: string }> = [];

  for (const raw of subset) {
    const row = raw as InputRow;
    const website = row['Website'] ?? '';
    const domain = deriveDomain(website);
    const linkedinUrl = normalizeLinkedInUrl(row['Company Linkedin Url'] ?? '');
    const name = row['Company Name'] ?? '';
    const description = row['Short Description'] ?? '';
    const apolloId = (row['Apollo Account Id'] ?? '').trim();

    if (!domain) {
      skippedRows.push({ name: name || '(unknown)', linkedinUrl: linkedinUrl || undefined, missingApolloId: !apolloId });
      continue;
    }

    const identity: CsvIdentity = { name, domain, linkedinUrl, description, website, apolloId };
    csvIdentities.push(identity);
    companies.push({ companyName: name, domain });
    if (linkedinUrl) linkedinByDomain.set(domain, linkedinUrl);
    if (!apolloId) missingApolloIdRows.push({ name: name || domain, domain });
  }

  const skippedBadDomain = skippedRows.length;

  // Preflight: surface skip decisions before any Attio writes so the user can Ctrl-C.
  console.log(`[enrich] CSV: ${csvPath}`);
  console.log(`[enrich] Account purpose: ${opts.accountPurpose ? `"${opts.accountPurpose}"` : '(none — Account Purpose column will not be touched)'}`);
  console.log(`[enrich] Limit: ${opts.limit ? `${opts.limit} ${opts.limit === 1 ? 'row' : 'rows'}` : 'none (process all rows)'}`);
  console.log();
  console.log(`[preflight] Scanned ${subset.length} ${subset.length === 1 ? 'row' : 'rows'} in CSV.`);
  if (skippedRows.length === 0 && missingApolloIdRows.length === 0) {
    console.log(`[preflight] Every company in the CSV looks good — nothing will be skipped.`);
  } else {
    if (skippedRows.length > 0) {
      console.log(`[preflight] ${skippedRows.length} ${skippedRows.length === 1 ? 'row' : 'rows'} will be skipped:`);
      const sortedSkipped = [...skippedRows].sort((a, b) => (b.linkedinUrl ? 1 : 0) - (a.linkedinUrl ? 1 : 0));
      for (const s of sortedSkipped) {
        const apolloNote = s.missingApolloId ? ' (also doesn\'t have Apollo ID)' : '';
        console.log(`  - "${s.name}"${s.linkedinUrl ? ` [${s.linkedinUrl}]` : ''}${apolloNote}`);
      }
      const usableCount = subset.length - skippedRows.length;
      console.log(`[preflight] ${usableCount} ${usableCount === 1 ? 'company' : 'companies'} from CSV will be processed.`);
    }
    if (missingApolloIdRows.length > 0) {
      console.log(`[preflight] ${missingApolloIdRows.length} ${missingApolloIdRows.length === 1 ? 'company' : 'companies'} missing Apollo ID (will still be processed):`);
      for (const r of missingApolloIdRows) console.log(`  - "${r.name}" [${r.domain}]`);
    }
  }
  console.log();

  if (!opts.skipConfirm) {
    console.log(`[enrich] Starting in 3 seconds — Ctrl-C to abort`);
    for (const i of [3, 2, 1]) {
      process.stdout.write(`${i}... `);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log();
  }

  console.log(`[enrich-all] pre-fetching Attio records…`);
  const attioCache = await fetchAllRecords();
  console.log(`[enrich-all] attio cache loaded (${attioCache.size} records found)`);

  const reasonSlug = FIELD_SLUGS['Reason for Rejection']!;
  const nameSlug = FIELD_SLUGS['Company Name']!;
  const linkedinSlug = FIELD_SLUGS['LinkedIn Page']!;
  const domainSlug = FIELD_SLUGS['Domain']!;
  const descriptionSlug = FIELD_SLUGS['Description']!;
  const websiteSlug = FIELD_SLUGS['Website']!;
  const apolloIdSlug = FIELD_SLUGS['Apollo ID']!;

  const csvDomainSet = new Set(companies.map((c) => c.domain));
  let attioOnlyIncluded = 0;
  let attioOnlyRejected = 0;
  for (const [domain, values] of attioCache) {
    if (csvDomainSet.has(domain)) continue;
    if (values[reasonSlug]) {
      attioOnlyRejected++;
      continue;
    }
    const name = values[nameSlug] || domain;
    companies.push({ companyName: name, domain });
    attioOnlyIncluded++;
    const li = values[linkedinSlug];
    if (li && !linkedinByDomain.has(domain)) linkedinByDomain.set(domain, li);
  }
  console.log(
    `[enrich-all] csv=${csvPath} rows=${subset.length} csvCompanies=${csvIdentities.length} badRows=${skippedBadDomain} totalCompanies=${companies.length} (attio-only-included=${attioOnlyIncluded} attio-only-rejected-skipped=${attioOnlyRejected})`
  );

  // Identity-write: for each CSV row, fill empty identity columns (Name, Domain, LinkedIn Page, Description, Website) and
  // always overwrite Account Purpose when --account-purpose is set. Match by domain.
  const identityWrites = csvIdentities
    .map((id) => {
      const existingValues: Record<string, string> = attioCache.get(id.domain) ?? {};
      const toWrite: Partial<EnrichmentResult> = {};
      if (id.name && !existingValues[nameSlug]) toWrite['Company Name'] = id.name;
      if (id.domain && !existingValues[domainSlug]) toWrite['Domain'] = id.domain;
      if (id.linkedinUrl && !existingValues[linkedinSlug]) toWrite['LinkedIn Page'] = id.linkedinUrl;
      if (id.description && !existingValues[descriptionSlug]) toWrite['Description'] = id.description;
      if (id.website && !existingValues[websiteSlug]) toWrite['Website'] = id.website;
      if (id.apolloId && !existingValues[apolloIdSlug]) toWrite['Apollo ID'] = id.apolloId;
      if (opts.accountPurpose) toWrite['Account Purpose'] = opts.accountPurpose;
      return { id, toWrite };
    })
    .filter(({ toWrite }) => Object.keys(toWrite).length > 0);

  if (identityWrites.length > 0) {
    console.log(`[enrich-all] writing identity columns for ${identityWrites.length} companies…`);
    await Promise.all(
      identityWrites.map(({ id, toWrite }) =>
        attioWriteLimit(() => {
          return upsertCompanyByDomain({ 'Domain': id.domain, ...toWrite }).catch((err) => {
            const ref = id.domain;
            console.error(`[identity-preflight] failed for ${ref}: ${err instanceof Error ? err.message : String(err)}`);
          });
        })
      )
    );
  }

  // Stage 1 — Competitor Tool (local match + TheirStack sub-step, no gate)
  const stage1Slug = FIELD_SLUGS['Competitor Tooling']!;
  const { todo: stage1Todo, done: stage1Done } = splitByCache(companies, attioCache, stage1Slug);
  console.log(`[competitorTool] todo=${stage1Todo.length} skipped=${stage1Done.length}`);

  const stage1LocallyMatched: StageResult<CompetitorToolData>[] = [];
  const stage1NeedsTheirStack: StageCompany[] = [];
  for (const company of stage1Todo) {
    const data = matchCompetitorTools(company.companyName);
    if (data.matchedTools.length > 0) {
      stage1LocallyMatched.push({ company, data });
    } else {
      stage1NeedsTheirStack.push(company);
    }
  }

  await writeStageColumn('Competitor Tooling', stage1LocallyMatched, formatCompetitorToolForAttio);
  for (const r of stage1LocallyMatched) {
    if (r.error !== undefined) continue;
    const existing = attioCache.get(r.company.domain) ?? {};
    attioCache.set(r.company.domain, { ...existing, [stage1Slug]: formatCompetitorToolForAttio(r.data) });
  }

  await runStage<CompetitorToolData, CompetitorToolData>({
    name: 'competitorTool',
    companies: stage1NeedsTheirStack,
    batchSize: 1,
    retry: { tries: THEIRSTACK_RETRY_TRIES, baseMs: THEIRSTACK_RETRY_BASE_MS },
    call: async (domains) => {
      const domain = domains[0]!;
      const res = await scheduleTheirstack(() =>
        theirstackJobsByAnySlugs(domain, [...COMPETITOR_THEIRSTACK_SLUGS])
      );
      const job = res.data?.[0];
      if (!job) return { matchedTools: [], evidence: {} };
      const detected = detectCompetitorToolsFromTheirStack(job);
      const sourceUrl = collectJobUrls(job);
      const evidence: CompetitorToolData['evidence'] = {};
      for (const tool of detected) evidence[tool] = { type: 'theirstack', sourceUrl };
      return { matchedTools: detected, evidence };
    },
    parse: (data, batch) => batch.map((c) => ({ company: c, data })),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Competitor Tooling', batchResults, formatCompetitorToolForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage1Slug]: formatCompetitorToolForAttio(r.data) });
        }
      }
    },
  });

  // No gate — all companies continue to Stage 2
  const survivorsAfterStage1 = [...stage1Todo, ...stage1Done];

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

  const { survivors: stage2TodoSurvivors, rejected: stage2TodoRejected } = filterSurvivors('digitalNative', stage2Results, digitalNativeGate, digitalNativeRejectionReason);
  const { survivors: stage2DoneSurvivors, rejected: stage2DoneRejected } = filterCachedSurvivors('digitalNative', stage2Done, attioCache, stage2Slug, digitalNativeCacheGate, digitalNativeCacheRejectionReason);
  await writeRejectionReasons([...stage2TodoRejected, ...stage2DoneRejected]);
  const survivorsAfterStage2 = [...stage2TodoSurvivors, ...stage2DoneSurvivors];

  // Stage 3 — Number of Users (conditional gate: Digital-native B2B and Digitally critical B2B must have >= 100k users)
  const stage3Slug = FIELD_SLUGS['Number of Users']!;
  const dnSlug = FIELD_SLUGS['Digital Native']!;
  const { todo: stage3Todo, done: stage3Done } = splitByCache(survivorsAfterStage2, attioCache, stage3Slug);
  console.log(`[numberOfUsers] todo=${stage3Todo.length} skipped=${stage3Done.length}`);

  const stage3Results = await runStage({
    name: 'numberOfUsers',
    companies: stage3Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => numberOfUsersExaSearch(domains)),
    parse: (raw, batch) => parseNumberOfUsersResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Number of Users', batchResults, formatNumberOfUsersForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage3Slug]: formatNumberOfUsersForAttio(r.data) });
        }
      }
    },
  });

  function userCountPassesGate(domain: string, bucket: UserCountBucket | null, hadError: boolean): boolean {
    const dnCategory = getDigitalNativeCategoryFromCached(attioCache.get(domain)?.[dnSlug] ?? '');
    if (dnCategory !== 'Digital-native B2B' && dnCategory !== 'Digitally critical B2B') return true;
    if (hadError) return true;
    if (bucket === null || bucket === 'unknown') return true;
    return bucket === '100K+';
  }

  const stage3TodoSurvivors: StageCompany[] = [];
  const stage3TodoRejected: Array<{ company: StageCompany; reason: string }> = [];
  for (const r of stage3Results) {
    if (r.error !== undefined) {
      stage3TodoSurvivors.push(r.company);
      continue;
    }
    if (userCountPassesGate(r.company.domain, r.data.user_count_bucket, false)) {
      stage3TodoSurvivors.push(r.company);
    } else {
      stage3TodoRejected.push({ company: r.company, reason: numberOfUsersRejectionReason(r.data.user_count_bucket) });
    }
  }
  const stage3DoneSurvivors: StageCompany[] = [];
  const stage3DoneRejected: Array<{ company: StageCompany; reason: string }> = [];
  for (const c of stage3Done) {
    const bucket = extractUserCountBucketFromCached(attioCache.get(c.domain)?.[stage3Slug] ?? '');
    if (userCountPassesGate(c.domain, bucket, false)) {
      stage3DoneSurvivors.push(c);
    } else {
      stage3DoneRejected.push({ company: c, reason: numberOfUsersRejectionReason(bucket ?? 'unknown') });
    }
  }
  const stage3TotalRejected = stage3TodoRejected.length + stage3DoneRejected.length;
  console.log(`[numberOfUsers] passed=${stage3TodoSurvivors.length + stage3DoneSurvivors.length} rejected=${stage3TotalRejected}`);
  await writeRejectionReasons([...stage3TodoRejected, ...stage3DoneRejected]);
  const survivorsAfterStage3 = [...stage3TodoSurvivors, ...stage3DoneSurvivors];

  // Stage 4 — Observability Tool
  const stage4Slug = FIELD_SLUGS['Observability Tool']!;
  const { todo: stage4Todo, done: stage4Done } = splitByCache(survivorsAfterStage3, attioCache, stage4Slug);
  console.log(`[observabilityTool] todo=${stage4Todo.length} skipped=${stage4Done.length}`);

  const stage4Results = await runStage({
    name: 'observabilityTool',
    companies: stage4Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => observabilityToolExaSearch(domains)),
    parse: (raw, batch) => parseObservabilityToolResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Observability Tool', batchResults, formatObservabilityToolForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage4Slug]: formatObservabilityToolForAttio(r.data) });
        }
      }
    },
  });

  const { survivors: stage4TodoSurvivors, rejected: stage4TodoRejected } = filterSurvivors('observabilityTool', stage4Results, observabilityToolGate, observabilityToolRejectionReason);
  const { survivors: stage4DoneSurvivors, rejected: stage4DoneRejected } = filterCachedSurvivors('observabilityTool', stage4Done, attioCache, stage4Slug, observabilityToolCacheGate, observabilityToolCacheRejectionReason);
  await writeRejectionReasons([...stage4TodoRejected, ...stage4DoneRejected]);
  const survivorsAfterStage4 = [...stage4TodoSurvivors, ...stage4DoneSurvivors];

  // Stage 5 — Communication Tool
  const stage5Slug = FIELD_SLUGS['Communication Tool']!;
  const { todo: stage5Todo, done: stage5Done } = splitByCache(survivorsAfterStage4, attioCache, stage5Slug);
  console.log(`[communicationTool] todo=${stage5Todo.length} skipped=${stage5Done.length}`);

  const stage5Results = await runStage<CommunicationToolRaw, CommunicationToolData>({
    name: 'communicationTool',
    companies: stage5Todo,
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
            [stage5Slug]: formatCommunicationToolForAttio(r.data),
          });
        }
      }
    },
  });

  const { survivors: stage5TodoSurvivors, rejected: stage5TodoRejected } = filterSurvivors('communicationTool', stage5Results, communicationToolGate, communicationToolRejectionReason);
  const { survivors: stage5DoneSurvivors, rejected: stage5DoneRejected } = filterCachedSurvivors('communicationTool', stage5Done, attioCache, stage5Slug, communicationToolCacheGate, communicationToolCacheRejectionReason);
  await writeRejectionReasons([...stage5TodoRejected, ...stage5DoneRejected]);
  const survivorsAfterStage5 = [...stage5TodoSurvivors, ...stage5DoneSurvivors];

  // Stage 6 — Cloud Tool
  const stage6Slug = FIELD_SLUGS['Cloud Tool']!;
  const { todo: stage6Todo, done: stage6Done } = splitByCache(survivorsAfterStage5, attioCache, stage6Slug);
  console.log(`[cloudTool] todo=${stage6Todo.length} skipped=${stage6Done.length}`);

  const stage6Results = await runStage({
    name: 'cloudTool',
    companies: stage6Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => cloudToolExaSearch(domains)),
    parse: (raw, batch) => parseCloudToolResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Cloud Tool', batchResults, formatCloudToolForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage6Slug]: formatCloudToolForAttio(r.data) });
        }
      }
    },
  });

  const { survivors: stage6TodoSurvivors, rejected: stage6TodoRejected } = filterSurvivors('cloudTool', stage6Results, cloudToolGate, cloudToolRejectionReason);
  const { survivors: stage6DoneSurvivors, rejected: stage6DoneRejected } = filterCachedSurvivors('cloudTool', stage6Done, attioCache, stage6Slug, cloudToolCacheGate, cloudToolCacheRejectionReason);
  await writeRejectionReasons([...stage6TodoRejected, ...stage6DoneRejected]);
  const survivorsAfterStage6 = [...stage6TodoSurvivors, ...stage6DoneSurvivors];

  console.log(`\n[enrich-all] survivors after all gating stages (${survivorsAfterStage6.length}):`);
  for (const c of survivorsAfterStage6) console.log(`  ${c.domain}  (${c.companyName})`);

  // Stage 7 — Funding Growth (non-gating, data collection only)
  const stage7Slug = FIELD_SLUGS['Funding Growth']!;
  const { todo: stage7Todo, done: stage7Done } = splitByCache(survivorsAfterStage6, attioCache, stage7Slug);
  console.log(`[fundingGrowth] todo=${stage7Todo.length} skipped=${stage7Done.length}`);

  await runStage({
    name: 'fundingGrowth',
    companies: stage7Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => fundingGrowthExaSearch(domains)),
    parse: (raw, batch) => parseFundingGrowthResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Funding Growth', batchResults, formatFundingGrowthForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage7Slug]: formatFundingGrowthForAttio(r.data) });
        }
      }
    },
  });

  // Stage 8 — Revenue Growth (non-gating, data collection only)
  const stage8Slug = FIELD_SLUGS['Revenue Growth']!;
  const { todo: stage8Todo, done: stage8Done } = splitByCache(survivorsAfterStage6, attioCache, stage8Slug);
  console.log(`[revenueGrowth] todo=${stage8Todo.length} skipped=${stage8Done.length}`);

  await runStage({
    name: 'revenueGrowth',
    companies: stage8Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => revenueGrowthExaSearch(domains)),
    parse: (raw, batch) => parseRevenueGrowthResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Revenue Growth', batchResults, formatRevenueGrowthForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage8Slug]: formatRevenueGrowthForAttio(r.data) });
        }
      }
    },
  });

  // Stage 9 — Number of Engineers (non-gating, data collection only)
  const stage9Slug = FIELD_SLUGS['Number of Engineers']!;
  const { todo: stage9Todo, done: stage9Done } = splitByCache(survivorsAfterStage6, attioCache, stage9Slug);
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
  const { todo: stage10Todo, done: stage10Done } = splitByCache(survivorsAfterStage6, attioCache, stage10Slug);
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
  const stage11Todo = survivorsAfterStage6.filter((c) => {
    const cached = attioCache.get(c.domain) ?? {};
    return !cached[stage11EngSlug] || !cached[stage11SreSlug];
  });
  const stage11Done = survivorsAfterStage6.filter((c) => {
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
  const { todo: stage13Todo, done: stage13Done } = splitByCache(survivorsAfterStage6, attioCache, stage13Slug);
  console.log(`[customerComplaintsOnX] todo=${stage13Todo.length} skipped=${stage13Done.length}`);

  const companyNameByDomain13 = new Map(stage13Todo.map((c) => [c.domain, c.companyName]));
  const companyContextByDomain13 = new Map<string, string>(
    stage13Todo.map((c) => {
      const values = attioCache.get(c.domain) ?? {};
      const ctx = values[descriptionSlug] || values[stage2Slug] || '';
      return [c.domain, ctx];
    })
  );

  await runStage<TweetItem[], CustomerComplaintsData>({
    name: 'customerComplaintsOnX',
    companies: stage13Todo,
    batchSize: 1,
    retry: { tries: TWITTER_API_RETRY_TRIES, baseMs: TWITTER_API_RETRY_BASE_MS },
    call: (domains) => {
      const domain = domains[0]!;
      const name = companyNameByDomain13.get(domain) ?? '';
      return fetchComplaintTweets(domain, name);
    },
    parse: (raw, batch) => {
      const context = companyContextByDomain13.get(batch[0]!.domain) ?? '';
      return parseCustomerComplaintsResponse(raw, batch, context);
    },
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

  // Stage 14 — Recent incidents ( Official ) (non-gating, data collection only)
  const stage14Slug = FIELD_SLUGS['Recent incidents ( Official )']!;
  const { todo: stage14Todo, done: stage14Done } = splitByCache(survivorsAfterStage6, attioCache, stage14Slug);
  console.log(`[recentIncidents] todo=${stage14Todo.length} skipped=${stage14Done.length}`);

  const companyNameByDomain14 = new Map(stage14Todo.map((c) => [c.domain, c.companyName]));

  await runStage<StatuspageFetchOutcome, RecentIncidentsData>({
    name: 'recentIncidents',
    companies: stage14Todo,
    batchSize: 1,
    retry: { tries: STATUSPAGE_RETRY_TRIES, baseMs: STATUSPAGE_RETRY_BASE_MS },
    call: (domains) => {
      const domain = domains[0]!;
      const name = companyNameByDomain14.get(domain) ?? '';
      return fetchRecentIncidents(domain, name);
    },
    parse: (raw, batch) => parseRecentIncidentsResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Recent incidents ( Official )', batchResults, formatRecentIncidentsForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage14Slug]: formatRecentIncidentsForAttio(r.data) });
        }
      }
    },
  });

  // Stage 15 — AI Adoption Mindset (non-gating, data collection only)
  const stage15Slug = FIELD_SLUGS['AI adoption mindset']!;
  const { todo: stage15Todo, done: stage15Done } = splitByCache(survivorsAfterStage6, attioCache, stage15Slug);
  console.log(`[aiAdoptionMindset] todo=${stage15Todo.length} skipped=${stage15Done.length}`);

  const companyNameByDomain15 = new Map(stage15Todo.map((c) => [c.domain, c.companyName]));

  await runStage<ExaSearchResponse, AiAdoptionMindsetData>({
    name: 'aiAdoptionMindset',
    companies: stage15Todo,
    batchSize: 1,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => {
      const domain = domains[0]!;
      const name = companyNameByDomain15.get(domain) ?? '';
      return scheduleExa(() => aiAdoptionMindsetExaSearch(name, domain));
    },
    parse: (raw, batch) => parseAiAdoptionMindsetResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('AI adoption mindset', batchResults, formatAiAdoptionMindsetForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage15Slug]: formatAiAdoptionMindsetForAttio(r.data) });
        }
      }
    },
  });

  // Stage 16 — AI SRE Maturity (non-gating, data collection only)
  const stage16Slug = FIELD_SLUGS['AI SRE maturity']!;
  const competitorToolingSlug = FIELD_SLUGS['Competitor Tooling']!;
  const { todo: stage16Todo, done: stage16Done } = splitByCache(survivorsAfterStage6, attioCache, stage16Slug);

  // Companies already using a competitor tool: copy Competitor Tooling value directly, skip Exa
  const stage16ExaTodo: typeof stage16Todo = [];
  for (const company of stage16Todo) {
    const competitorValue = attioCache.get(company.domain)?.[competitorToolingSlug] ?? '';
    if (competitorValue && competitorValue !== 'Not using any competitor tools') {
      const newlineIdx = competitorValue.indexOf('\n');
      const toolNames = newlineIdx === -1 ? competitorValue : competitorValue.slice(0, newlineIdx);
      const rest = newlineIdx === -1 ? '' : competitorValue.slice(newlineIdx);
      const sreMaturityValue = `Working with vendor: ${toolNames}${rest}`;
      await writeStageColumn('AI SRE maturity', [{ company, data: { text: sreMaturityValue } as unknown as AiSreMaturityData }], () => sreMaturityValue);
      const existing = attioCache.get(company.domain) ?? {};
      attioCache.set(company.domain, { ...existing, [stage16Slug]: sreMaturityValue });
      console.log(`[aiSreMaturity] ${company.domain}: competitor detected, copied Competitor Tooling value`);
    } else {
      stage16ExaTodo.push(company);
    }
  }

  console.log(`[aiSreMaturity] exa=${stage16ExaTodo.length} competitor-shortcut=${stage16Todo.length - stage16ExaTodo.length} skipped=${stage16Done.length}`);

  const companyNameByDomain16 = new Map(stage16ExaTodo.map((c) => [c.domain, c.companyName]));

  await runStage<ExaSearchResponse, AiSreMaturityData>({
    name: 'aiSreMaturity',
    companies: stage16ExaTodo,
    batchSize: 1,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => {
      const domain = domains[0]!;
      const name = companyNameByDomain16.get(domain) ?? '';
      return scheduleExa(() => aiSreMaturityExaSearch(name, domain));
    },
    parse: (raw, batch) => parseAiSreMaturityResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('AI SRE maturity', batchResults, formatAiSreMaturityForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage16Slug]: formatAiSreMaturityForAttio(r.data) });
        }
      }
    },
  });

  // Stage 17 — Industry (batch-of-2, non-gating, data collection only)
  const stage17Slug = FIELD_SLUGS['Industry']!;
  const { todo: stage17Todo, done: stage17Done } = splitByCache(survivorsAfterStage6, attioCache, stage17Slug);
  console.log(`[industry] todo=${stage17Todo.length} skipped=${stage17Done.length}`);

  await runStage<ExaSearchResponse, IndustryData>({
    name: 'industry',
    companies: stage17Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => industryExaSearch(domains)),
    parse: (raw, batch) => parseIndustryResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Industry', batchResults, formatIndustryForAttio);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage17Slug]: formatIndustryForAttio(r.data) });
        }
      }
    },
  });

  // Stage 18 — Company Context Score (OpenAI synthesis, hash-gated re-run)
  // Re-scores when any of the 17 input cells changes; hash stored in Attio for durability.
  const stage18Slug = FIELD_SLUGS['Company Context Score']!;
  const hashSlug = FIELD_SLUGS['Change Detection Column for Developer']!;
  const enrichableSlugsForHash = (ENRICHABLE_COLUMNS as readonly string[])
    .filter((c) => c !== 'Company Context Score' && c !== 'Tooling Match Score' && c !== 'Intent Signal Score' && c !== 'Final Score')
    .map((c) => FIELD_SLUGS[c]!);

  const stage18Eligible = survivorsAfterStage6.filter((c) => {
    const values = attioCache.get(c.domain) ?? {};
    return enrichableSlugsForHash.every((slug) => !!values[slug]);
  });

  const stage18Todo = stage18Eligible.filter((c) => {
    const values = attioCache.get(c.domain) ?? {};
    const currentHash = computeInputHash(values, enrichableSlugsForHash);
    return values[hashSlug] !== currentHash;
  });

  console.log(`[contextScore] eligible=${stage18Eligible.length} todo=${stage18Todo.length} hash-skipped=${stage18Eligible.length - stage18Todo.length}`);

  await runStage<Record<string, string>, ContextScoreData>({
    name: 'contextScore',
    companies: stage18Todo,
    batchSize: 1,
    retry: { tries: 3, baseMs: 1000 },
    call: (domains) => Promise.resolve(attioCache.get(domains[0]!) ?? {}),
    parse: async (values, batch) => {
      const company = batch[0]!;
      const data = await scoreCompanyContext(company, values);
      return [{ company, data }];
    },
    afterBatch: async (batchResults) => {
      for (const r of batchResults) {
        if (r.error !== undefined) continue;
        const values = attioCache.get(r.company.domain) ?? {};
        const hash = computeInputHash(values, enrichableSlugsForHash);
        const cell = formatContextScoreForAttio(r.data);
        await attioWriteLimit(() =>
          upsertCompanyByDomain({
            'Company Name': r.company.companyName,
            'Domain': r.company.domain,
            'Company Context Score': cell,
            'Change Detection Column for Developer': hash,
          })
        );
        attioCache.set(r.company.domain, { ...values, [stage18Slug]: cell, [hashSlug]: hash });
      }
    },
  });

  // Stage 19 — Tooling Match Score (OpenAI scoring of 4 tooling cells, hash-gated re-run)
  // Runs at the same level as Stage 18 — neither depends on the other. Hash covers only the 4 input cells.
  const stage19Slug = FIELD_SLUGS['Tooling Match Score']!;
  const stage19HashSlug = FIELD_SLUGS['Tooling Match Change Detection for Developer']!;
  const toolingInputSlugs = (TOOLING_MATCH_INPUT_COLUMNS as readonly string[]).map((c) => FIELD_SLUGS[c]!);
  const priorSlugsForStage19 = (ENRICHABLE_COLUMNS as readonly string[])
    .filter((c) => c !== 'Company Context Score' && c !== 'Tooling Match Score' && c !== 'Intent Signal Score' && c !== 'Final Score')
    .map((c) => FIELD_SLUGS[c]!);

  const stage19Eligible = survivorsAfterStage6.filter((c) => {
    const values = attioCache.get(c.domain) ?? {};
    return priorSlugsForStage19.every((slug) => !!values[slug]);
  });

  const stage19Todo = stage19Eligible.filter((c) => {
    const values = attioCache.get(c.domain) ?? {};
    const currentHash = computeInputHash(values, toolingInputSlugs);
    return values[stage19HashSlug] !== currentHash;
  });

  console.log(`[toolingMatchScore] eligible=${stage19Eligible.length} todo=${stage19Todo.length} hash-skipped=${stage19Eligible.length - stage19Todo.length}`);

  await runStage<Record<string, string>, ToolingMatchScoreData>({
    name: 'toolingMatchScore',
    companies: stage19Todo,
    batchSize: 1,
    retry: { tries: 3, baseMs: 1000 },
    call: (domains) => Promise.resolve(attioCache.get(domains[0]!) ?? {}),
    parse: async (values, batch) => {
      const company = batch[0]!;
      const data = await scoreToolingMatch(company, values);
      return [{ company, data }];
    },
    afterBatch: async (batchResults) => {
      for (const r of batchResults) {
        if (r.error !== undefined) continue;
        const values = attioCache.get(r.company.domain) ?? {};
        const hash = computeInputHash(values, toolingInputSlugs);
        const cell = formatToolingMatchScoreForAttio(r.data);
        await attioWriteLimit(() =>
          upsertCompanyByDomain({
            'Company Name': r.company.companyName,
            'Domain': r.company.domain,
            'Tooling Match Score': cell,
            'Tooling Match Change Detection for Developer': hash,
          })
        );
        attioCache.set(r.company.domain, { ...values, [stage19Slug]: cell, [stage19HashSlug]: hash });
      }
    },
  });

  // Stage 20 — Intent Signal Score (OpenAI scoring of 8 intent-signal cells, hash-gated re-run)
  // Runs at the same level as Stages 18 and 19 — independent of both. Hash covers only the 8 input cells.
  const stage20Slug = FIELD_SLUGS['Intent Signal Score']!;
  const stage20HashSlug = FIELD_SLUGS['Intent Signal Change Detection for Developer']!;
  const intentInputSlugs = (INTENT_SIGNAL_INPUT_COLUMNS as readonly string[]).map((c) => FIELD_SLUGS[c]!);
  const priorSlugsForStage20 = (ENRICHABLE_COLUMNS as readonly string[])
    .filter((c) => c !== 'Company Context Score' && c !== 'Tooling Match Score' && c !== 'Intent Signal Score' && c !== 'Final Score')
    .map((c) => FIELD_SLUGS[c]!);

  const stage20Eligible = survivorsAfterStage6.filter((c) => {
    const values = attioCache.get(c.domain) ?? {};
    return priorSlugsForStage20.every((slug) => !!values[slug]);
  });

  const stage20Todo = stage20Eligible.filter((c) => {
    const values = attioCache.get(c.domain) ?? {};
    const currentHash = computeInputHash(values, intentInputSlugs);
    return values[stage20HashSlug] !== currentHash;
  });

  console.log(`[intentSignalScore] eligible=${stage20Eligible.length} todo=${stage20Todo.length} hash-skipped=${stage20Eligible.length - stage20Todo.length}`);

  await runStage<Record<string, string>, IntentSignalScoreData>({
    name: 'intentSignalScore',
    companies: stage20Todo,
    batchSize: 1,
    retry: { tries: 3, baseMs: 1000 },
    call: (domains) => Promise.resolve(attioCache.get(domains[0]!) ?? {}),
    parse: async (values, batch) => {
      const company = batch[0]!;
      const data = await scoreIntentSignal(company, values);
      return [{ company, data }];
    },
    afterBatch: async (batchResults) => {
      for (const r of batchResults) {
        if (r.error !== undefined) continue;
        const values = attioCache.get(r.company.domain) ?? {};
        const hash = computeInputHash(values, intentInputSlugs);
        const cell = formatIntentSignalScoreForAttio(r.data);
        await attioWriteLimit(() =>
          upsertCompanyByDomain({
            'Company Name': r.company.companyName,
            'Domain': r.company.domain,
            'Intent Signal Score': cell,
            'Intent Signal Change Detection for Developer': hash,
          })
        );
        attioCache.set(r.company.domain, { ...values, [stage20Slug]: cell, [stage20HashSlug]: hash });
      }
    },
  });

  // Stage 21 — Final Score (local weighted formula + OpenAI reasoning, hash-gated re-run)
  // Depends on Stages 18/19/20. Hash covers only the 3 upstream score cells.
  // Runs after all three upstream stages have updated attioCache in this run.
  const stage21Slug = FIELD_SLUGS['Final Score']!;
  const stage21HashSlug = FIELD_SLUGS['Final Score Change Detection for Developer']!;
  const finalInputSlugs = (FINAL_SCORE_INPUT_COLUMNS as readonly string[]).map((c) => FIELD_SLUGS[c]!);
  const priorSlugsForStage21 = (ENRICHABLE_COLUMNS as readonly string[])
    .filter((c) => c !== 'Company Context Score' && c !== 'Tooling Match Score' && c !== 'Intent Signal Score' && c !== 'Final Score')
    .map((c) => FIELD_SLUGS[c]!);

  const stage21Eligible = survivorsAfterStage6.filter((c) => {
    const values = attioCache.get(c.domain) ?? {};
    return priorSlugsForStage21.every((slug) => !!values[slug])
      && finalInputSlugs.every((slug) => !!values[slug]);
  });

  const stage21Todo = stage21Eligible.filter((c) => {
    const values = attioCache.get(c.domain) ?? {};
    const currentHash = computeInputHash(values, finalInputSlugs);
    return values[stage21HashSlug] !== currentHash;
  });

  console.log(`[finalScore] eligible=${stage21Eligible.length} todo=${stage21Todo.length} hash-skipped=${stage21Eligible.length - stage21Todo.length}`);

  await runStage<Record<string, string>, FinalScoreData>({
    name: 'finalScore',
    companies: stage21Todo,
    batchSize: 1,
    retry: { tries: 3, baseMs: 1000 },
    call: (domains) => Promise.resolve(attioCache.get(domains[0]!) ?? {}),
    parse: async (values, batch) => {
      const company = batch[0]!;
      const data = await scoreFinal(company, values);
      return [{ company, data }];
    },
    afterBatch: async (batchResults) => {
      for (const r of batchResults) {
        if (r.error !== undefined) continue;
        const values = attioCache.get(r.company.domain) ?? {};
        const hash = computeInputHash(values, finalInputSlugs);
        const cell = formatFinalScoreForAttio(r.data);
        await attioWriteLimit(() =>
          upsertCompanyByDomain({
            'Company Name': r.company.companyName,
            'Domain': r.company.domain,
            'Final Score': cell,
            'Final Score Change Detection for Developer': hash,
          })
        );
        attioCache.set(r.company.domain, { ...values, [stage21Slug]: cell, [stage21HashSlug]: hash });
      }
    },
  });

  console.log(`\n[done] total=${companies.length} survivors=${survivorsAfterStage6.length} badDomains=${skippedBadDomain}`);
}
