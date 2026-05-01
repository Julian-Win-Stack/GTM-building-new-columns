import { PATHS, EXA_RETRY_TRIES, EXA_RETRY_BASE_MS, THEIRSTACK_RETRY_TRIES, THEIRSTACK_RETRY_BASE_MS, APOLLO_RETRY_TRIES, APOLLO_RETRY_BASE_MS, APIFY_RETRY_TRIES, APIFY_RETRY_BASE_MS, TWITTER_API_RETRY_TRIES, TWITTER_API_RETRY_BASE_MS, STATUSPAGE_RETRY_TRIES, STATUSPAGE_RETRY_BASE_MS, ENRICHABLE_COLUMNS } from '../config.js';
import { readInputCsv } from '../csv.js';
import { digitalNativeExaSearch, observabilityToolExaSearch, cloudToolExaSearch, fundingGrowthExaSearch, revenueGrowthExaSearch, numberOfUsersExaSearch, aiAdoptionMindsetExaSearch, aiSreMaturityExaSearch, industryExaSearch, type ExaSearchResponse } from '../apis/exa.js';
import { collectJobUrls, theirstackJobsByTechnology, theirstackJobsByAnySlugs } from '../apis/theirstack.js';
import { scheduleExa, scheduleTheirstack, scheduleApollo, scheduleApify } from '../rateLimit.js';
import { deriveDomain, linkedInSlugForAttio, normalizeLinkedInUrl } from '../util.js';
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
import type { RunCtx, RunEvent } from '../runTypes.js';

export type EnrichAllOptions = {
  csv?: string;
  limit?: number;
  accountPurpose?: string;
  // Internal: tests set this to skip the 3-second pre-run countdown so the suite stays fast.
  // Not exposed as a CLI flag; the wrapper script and src/index.ts never set it.
  skipConfirm?: boolean;
  // Optional callback fired at every stage boundary and cell update. Used by the web UI to stream
  // a live view of the run; the CLI leaves this undefined (no events emitted).
  onEvent?: (event: RunEvent) => void;
  // Optional cancel poll. Polled at every stage boundary and at the start of every batch.
  isCancelled?: () => boolean;
  // Optional promise that *rejects* when the user cancels. Raced against every API call so
  // in-flight HTTP requests stop blocking the pipeline immediately on cancel — the run bails
  // out and returns the partial attioCache (still downloadable as CSV).
  cancelSignal?: Promise<never>;
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

function setAndEmit(
  ctx: RunCtx,
  cache: Map<string, Record<string, string>>,
  domain: string,
  patch: Record<string, string>,
  emitColumns: Array<{ slug: string; column: string }>
): void {
  const existing = cache.get(domain) ?? {};
  cache.set(domain, { ...existing, ...patch });
  for (const { slug, column } of emitColumns) {
    const value = patch[slug];
    if (value === undefined) continue;
    ctx.emit({ type: 'cell-updated', domain, column, value });
  }
}

// Attio upsert with cancel-race. Returns silently on cancel. Throws on real errors.
async function attioUpsertWithCancel(
  ctx: RunCtx,
  data: Partial<EnrichmentResult>
): Promise<void> {
  if (ctx.isCancelled?.()) return;
  const writePromise = attioWriteLimit(() => upsertCompanyByDomain(data));
  try {
    await (ctx.cancelSignal ? Promise.race([writePromise, ctx.cancelSignal]) : writePromise);
  } catch (err) {
    if (ctx.isCancelled?.()) return;
    throw err;
  }
}

export async function enrichAll(opts: EnrichAllOptions): Promise<Map<string, Record<string, string>>> {
  const csvPath = opts.csv ?? PATHS.defaultInputCsv;
  const ctx: RunCtx = {
    emit: opts.onEvent ?? (() => {}),
    isCancelled: opts.isCancelled,
    cancelSignal: opts.cancelSignal,
  };

  // Cancellation gate. Called at every stage boundary; if the user has cancelled, emit
  // run-cancelled (once) and tell the caller to bail out, returning the partial cache.
  let cancelEmitted = false;
  function bailIfCancelled(): boolean {
    if (!ctx.isCancelled?.()) return false;
    if (!cancelEmitted) {
      ctx.emit({ type: 'run-cancelled' });
      cancelEmitted = true;
      console.log('[enrich-all] cancellation requested — aborting in-flight API calls and stopping the run');
    }
    return true;
  }

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
  const skippedRows: Array<{
    name: string;
    hasWebsite: boolean;
    hasLinkedin: boolean;
    missingApolloId: boolean;
  }> = [];
  const missingApolloIdRows: Array<{ name: string; domain: string }> = [];

  for (const raw of subset) {
    const row = raw as InputRow;
    const website = row['Website'] ?? '';
    const domain = deriveDomain(website);
    const linkedinUrl = normalizeLinkedInUrl(row['Company Linkedin Url'] ?? '');
    const name = row['Company Name'] ?? '';
    const description = row['Short Description'] ?? '';
    const apolloId = (row['Apollo Account Id'] ?? '').trim();

    if (!domain || !linkedinUrl) {
      skippedRows.push({
        name: name || '(unknown)',
        hasWebsite: Boolean(domain),
        hasLinkedin: Boolean(linkedinUrl),
        missingApolloId: !apolloId,
      });
      continue;
    }

    const identity: CsvIdentity = { name, domain, linkedinUrl, description, website, apolloId };
    csvIdentities.push(identity);
    companies.push({ companyName: name, domain });
    linkedinByDomain.set(domain, linkedinUrl);
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
      for (const s of skippedRows) {
        const apolloNote = s.missingApolloId ? ' (also doesn\'t have Apollo ID)' : '';
        console.log(`  - "${s.name}" — ${skipReason(s)}${apolloNote}`);
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

  // Scope: only the input CSV's domains. Attio records for companies NOT in this CSV are
  // intentionally ignored — we do not enrich, write to, or even read them. This matches the
  // user-facing rule: "the program focuses on the input companies, not the whole Attio table".
  let attioCache: Map<string, Record<string, string>>;
  const csvDomainsForPrefetch = companies.map((c) => c.domain);
  console.log(`[enrich-all] pre-fetching Attio records for ${csvDomainsForPrefetch.length} CSV domains…`);
  try {
    const prefetch = fetchAllRecords(csvDomainsForPrefetch);
    attioCache = await (ctx.cancelSignal ? Promise.race([prefetch, ctx.cancelSignal]) : prefetch);
    console.log(`[enrich-all] attio cache loaded (${attioCache.size} records matched out of ${csvDomainsForPrefetch.length} CSV domains)`);
  } catch (err) {
    if (ctx.isCancelled?.()) {
      console.log(`[enrich-all] prefetch aborted (cancelled)`);
      return new Map<string, Record<string, string>>();
    }
    throw err;
  }

  const nameSlug = FIELD_SLUGS['Company Name']!;
  const linkedinSlug = FIELD_SLUGS['LinkedIn Page']!;
  const domainSlug = FIELD_SLUGS['Domain']!;
  const descriptionSlug = FIELD_SLUGS['Description']!;
  const websiteSlug = FIELD_SLUGS['Website']!;
  const apolloIdSlug = FIELD_SLUGS['Apollo ID']!;
  const accountPurposeSlug = FIELD_SLUGS['Account Purpose']!;

  // Processing set = CSV companies only. Attio records for companies outside the CSV are
  // never enriched, even if they are partially populated or have empty columns. To re-enrich
  // such a company, include it in the CSV.
  console.log(
    `[enrich-all] csv=${csvPath} rows=${subset.length} csvCompanies=${csvIdentities.length} badRows=${skippedBadDomain} totalCompanies=${companies.length}`
  );

  // Compute the identity-write payload for each CSV row using the ORIGINAL cache state
  // (so "fill empty Attio slots, never overwrite" remains correct).
  const identityPlans = csvIdentities.map((id) => {
    const existingValues: Record<string, string> = attioCache.get(id.domain) ?? {};
    const toWrite: Partial<EnrichmentResult> = {};
    if (id.name && !existingValues[nameSlug]) toWrite['Company Name'] = id.name;
    if (id.domain && !existingValues[domainSlug]) toWrite['Domain'] = id.domain;
    if (id.linkedinUrl && !existingValues[linkedinSlug]) {
      const slug = linkedInSlugForAttio(id.linkedinUrl);
      if (slug) toWrite['LinkedIn Page'] = slug;
    }
    if (id.description && !existingValues[descriptionSlug]) toWrite['Description'] = id.description;
    if (id.website && !existingValues[websiteSlug]) toWrite['Website'] = id.website;
    if (id.apolloId && !existingValues[apolloIdSlug]) toWrite['Apollo ID'] = id.apolloId;
    if (opts.accountPurpose) toWrite['Account Purpose'] = opts.accountPurpose;
    return { id, toWrite };
  });

  // Identity-write to Attio. Uses the pre-seed cache state so we don't overwrite values
  // that already exist in Attio.
  const writeable = identityPlans.filter(({ toWrite }) => Object.keys(toWrite).length > 0);
  if (writeable.length > 0) {
    console.log(`[enrich-all] writing identity columns for ${writeable.length} companies…`);
    await Promise.all(
      writeable.map(({ id, toWrite }) =>
        attioWriteLimit(async () => {
          if (ctx.isCancelled?.()) return;
          const upsert = upsertCompanyByDomain({ 'Domain': id.domain, ...toWrite });
          try {
            await (ctx.cancelSignal ? Promise.race([upsert, ctx.cancelSignal]) : upsert);
          } catch (err) {
            if (ctx.isCancelled?.()) return;
            console.error(`[identity-preflight] failed for ${id.domain}: ${err instanceof Error ? err.message : String(err)}`);
          }
        })
      )
    );
  }

  // Now seed the in-memory cache with identity values so the live UI + the CSV output have
  // every field we know — both what was already in Attio AND what we just wrote / will write.
  for (const { id, toWrite } of identityPlans) {
    const existing = attioCache.get(id.domain) ?? {};
    const patch: Record<string, string> = { ...existing };
    for (const [col, val] of Object.entries(toWrite)) {
      const slug = FIELD_SLUGS[col];
      if (slug && typeof val === 'string' && val) patch[slug] = val;
    }
    attioCache.set(id.domain, patch);
  }

  // Emit run-started so the UI can pre-populate the table with identity rows + show skipped panel.
  ctx.emit({
    type: 'run-started',
    totalCompanies: companies.length,
    companies: companies.map((c) => {
      const id = csvIdentities.find((i) => i.domain === c.domain);
      const cached = attioCache.get(c.domain) ?? {};
      return {
        domain: c.domain,
        companyName: c.companyName,
        website: id?.website || cached[websiteSlug] || undefined,
        description: id?.description || cached[descriptionSlug] || undefined,
        linkedinUrl: id?.linkedinUrl || cached[linkedinSlug] || undefined,
        apolloId: id?.apolloId || cached[apolloIdSlug] || undefined,
        accountPurpose: opts.accountPurpose || cached[accountPurposeSlug] || undefined,
      };
    }),
    skippedRows: skippedRows.map((s) => ({
      name: s.name,
      reason: skipReason(s),
    })),
  });

  // Rehydrate the live UI with everything already in attioCache (pre-populated by
  // fetchAllRecords). Each non-empty cell becomes a cell-updated event so the activity
  // feed renders the full state from frame one.
  const slugToColumn = new Map<string, string>();
  for (const [column, slug] of Object.entries(FIELD_SLUGS)) {
    if (slug) slugToColumn.set(slug, column);
  }
  for (const [domain, values] of attioCache) {
    for (const [slug, value] of Object.entries(values)) {
      if (!value) continue;
      const column = slugToColumn.get(slug);
      if (!column) continue;
      ctx.emit({ type: 'cell-updated', domain, column, value });
    }
  }

  if (bailIfCancelled()) return attioCache;
  // Stage 1 — Competitor Tool (local match + TheirStack sub-step, no gate)
  const stage1Slug = FIELD_SLUGS['Competitor Tooling']!;
  const { todo: stage1Todo, done: stage1Done } = splitByCache(companies, attioCache, stage1Slug);
  console.log(`[competitorTool] todo=${stage1Todo.length} skipped=${stage1Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 1, stageName: 'Competitor Tooling', todo: stage1Todo.length, skipped: stage1Done.length });

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

  await writeStageColumn('Competitor Tooling', stage1LocallyMatched, formatCompetitorToolForAttio, ctx);
  for (const r of stage1LocallyMatched) {
    if (r.error !== undefined) continue;
    setAndEmit(ctx, attioCache, r.company.domain, { [stage1Slug]: formatCompetitorToolForAttio(r.data) }, []);
  }

  await runStage<CompetitorToolData, CompetitorToolData>({
    name: 'competitorTool',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
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
      await writeStageColumn('Competitor Tooling', batchResults, formatCompetitorToolForAttio, ctx);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage1Slug]: formatCompetitorToolForAttio(r.data) });
        }
      }
    },
  });

  ctx.emit({ type: 'stage-completed', stageNumber: 1, stageName: 'Competitor Tooling' });

  // No gate — all companies continue to Stage 2
  const survivorsAfterStage1 = [...stage1Todo, ...stage1Done];

  if (bailIfCancelled()) return attioCache;
  // Stage 2 — Digital Native
  const stage2Slug = FIELD_SLUGS['Digital Native']!;
  const { todo: stage2Todo, done: stage2Done } = splitByCache(survivorsAfterStage1, attioCache, stage2Slug);
  console.log(`[digitalNative] todo=${stage2Todo.length} skipped=${stage2Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 2, stageName: 'Digital Native', todo: stage2Todo.length, skipped: stage2Done.length });

  const stage2Results = await runStage({
    name: 'digitalNative',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
    companies: stage2Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => digitalNativeExaSearch(domains)),
    parse: (raw, batch) => parseDigitalNativeResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Digital Native', batchResults, formatDigitalNativeForAttio, ctx);
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
  await writeRejectionReasons([...stage2TodoRejected, ...stage2DoneRejected], ctx);
  const survivorsAfterStage2 = [...stage2TodoSurvivors, ...stage2DoneSurvivors];
  ctx.emit({ type: 'stage-completed', stageNumber: 2, stageName: 'Digital Native' });

  if (bailIfCancelled()) return attioCache;
  // Stage 3 — Number of Users (conditional gate: Digital-native B2B and Digitally critical B2B must have >= 100k users)
  const stage3Slug = FIELD_SLUGS['Number of Users']!;
  const dnSlug = FIELD_SLUGS['Digital Native']!;
  const { todo: stage3Todo, done: stage3Done } = splitByCache(survivorsAfterStage2, attioCache, stage3Slug);
  console.log(`[numberOfUsers] todo=${stage3Todo.length} skipped=${stage3Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 3, stageName: 'Number of Users', todo: stage3Todo.length, skipped: stage3Done.length });

  const stage3Results = await runStage({
    name: 'numberOfUsers',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
    companies: stage3Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => numberOfUsersExaSearch(domains)),
    parse: (raw, batch) => parseNumberOfUsersResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Number of Users', batchResults, formatNumberOfUsersForAttio, ctx);
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
  await writeRejectionReasons([...stage3TodoRejected, ...stage3DoneRejected], ctx);
  const survivorsAfterStage3 = [...stage3TodoSurvivors, ...stage3DoneSurvivors];
  ctx.emit({ type: 'stage-completed', stageNumber: 3, stageName: 'Number of Users' });

  if (bailIfCancelled()) return attioCache;
  // Stage 4 — Observability Tool
  const stage4Slug = FIELD_SLUGS['Observability Tool']!;
  const { todo: stage4Todo, done: stage4Done } = splitByCache(survivorsAfterStage3, attioCache, stage4Slug);
  console.log(`[observabilityTool] todo=${stage4Todo.length} skipped=${stage4Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 4, stageName: 'Observability Tool', todo: stage4Todo.length, skipped: stage4Done.length });

  const stage4Results = await runStage({
    name: 'observabilityTool',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
    companies: stage4Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => observabilityToolExaSearch(domains)),
    parse: (raw, batch) => parseObservabilityToolResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Observability Tool', batchResults, formatObservabilityToolForAttio, ctx);
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
  await writeRejectionReasons([...stage4TodoRejected, ...stage4DoneRejected], ctx);
  const survivorsAfterStage4 = [...stage4TodoSurvivors, ...stage4DoneSurvivors];
  ctx.emit({ type: 'stage-completed', stageNumber: 4, stageName: 'Observability Tool' });

  if (bailIfCancelled()) return attioCache;
  // Stage 5 — Communication Tool
  const stage5Slug = FIELD_SLUGS['Communication Tool']!;
  const { todo: stage5Todo, done: stage5Done } = splitByCache(survivorsAfterStage4, attioCache, stage5Slug);
  console.log(`[communicationTool] todo=${stage5Todo.length} skipped=${stage5Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 5, stageName: 'Communication Tool', todo: stage5Todo.length, skipped: stage5Done.length });

  const stage5Results = await runStage<CommunicationToolRaw, CommunicationToolData>({
    name: 'communicationTool',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
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
      await writeStageColumn('Communication Tool', batchResults, formatCommunicationToolForAttio, ctx);
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
  await writeRejectionReasons([...stage5TodoRejected, ...stage5DoneRejected], ctx);
  const survivorsAfterStage5 = [...stage5TodoSurvivors, ...stage5DoneSurvivors];
  ctx.emit({ type: 'stage-completed', stageNumber: 5, stageName: 'Communication Tool' });

  if (bailIfCancelled()) return attioCache;
  // Stage 6 — Cloud Tool
  const stage6Slug = FIELD_SLUGS['Cloud Tool']!;
  const { todo: stage6Todo, done: stage6Done } = splitByCache(survivorsAfterStage5, attioCache, stage6Slug);
  console.log(`[cloudTool] todo=${stage6Todo.length} skipped=${stage6Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 6, stageName: 'Cloud Tool', todo: stage6Todo.length, skipped: stage6Done.length });

  const stage6Results = await runStage({
    name: 'cloudTool',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
    companies: stage6Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => cloudToolExaSearch(domains)),
    parse: (raw, batch) => parseCloudToolResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Cloud Tool', batchResults, formatCloudToolForAttio, ctx);
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
  await writeRejectionReasons([...stage6TodoRejected, ...stage6DoneRejected], ctx);
  const survivorsAfterStage6 = [...stage6TodoSurvivors, ...stage6DoneSurvivors];
  ctx.emit({ type: 'stage-completed', stageNumber: 6, stageName: 'Cloud Tool' });

  console.log(`\n[enrich-all] survivors after all gating stages (${survivorsAfterStage6.length}):`);
  for (const c of survivorsAfterStage6) console.log(`  ${c.domain}  (${c.companyName})`);

  if (bailIfCancelled()) return attioCache;
  // Stage 7 — Funding Growth (non-gating, data collection only)
  const stage7Slug = FIELD_SLUGS['Funding Growth']!;
  const { todo: stage7Todo, done: stage7Done } = splitByCache(survivorsAfterStage6, attioCache, stage7Slug);
  console.log(`[fundingGrowth] todo=${stage7Todo.length} skipped=${stage7Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 7, stageName: 'Funding Growth', todo: stage7Todo.length, skipped: stage7Done.length });

  await runStage({
    name: 'fundingGrowth',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
    companies: stage7Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => fundingGrowthExaSearch(domains)),
    parse: (raw, batch) => parseFundingGrowthResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Funding Growth', batchResults, formatFundingGrowthForAttio, ctx);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage7Slug]: formatFundingGrowthForAttio(r.data) });
        }
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 7, stageName: 'Funding Growth' });

  if (bailIfCancelled()) return attioCache;
  // Stage 8 — Revenue Growth (non-gating, data collection only)
  const stage8Slug = FIELD_SLUGS['Revenue Growth']!;
  const { todo: stage8Todo, done: stage8Done } = splitByCache(survivorsAfterStage6, attioCache, stage8Slug);
  console.log(`[revenueGrowth] todo=${stage8Todo.length} skipped=${stage8Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 8, stageName: 'Revenue Growth', todo: stage8Todo.length, skipped: stage8Done.length });

  await runStage({
    name: 'revenueGrowth',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
    companies: stage8Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => revenueGrowthExaSearch(domains)),
    parse: (raw, batch) => parseRevenueGrowthResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Revenue Growth', batchResults, formatRevenueGrowthForAttio, ctx);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage8Slug]: formatRevenueGrowthForAttio(r.data) });
        }
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 8, stageName: 'Revenue Growth' });

  if (bailIfCancelled()) return attioCache;
  // Stage 9 — Number of Engineers (non-gating, data collection only)
  const stage9Slug = FIELD_SLUGS['Number of Engineers']!;
  const { todo: stage9Todo, done: stage9Done } = splitByCache(survivorsAfterStage6, attioCache, stage9Slug);
  console.log(`[numberOfEngineers] todo=${stage9Todo.length} skipped=${stage9Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 9, stageName: 'Number of Engineers', todo: stage9Todo.length, skipped: stage9Done.length });

  await runStage({
    name: 'numberOfEngineers',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
    companies: stage9Todo,
    batchSize: 1,
    retry: { tries: APOLLO_RETRY_TRIES, baseMs: APOLLO_RETRY_BASE_MS },
    call: (domains) => {
      const domain = domains[0]!;
      return scheduleApollo(() => apolloMixedPeopleApiSearch(domain, ENGINEER_TITLES));
    },
    parse: (raw, batch) => parseNumberOfEngineersResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Number of Engineers', batchResults, formatNumberOfEngineersForAttio, ctx);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage9Slug]: formatNumberOfEngineersForAttio(r.data) });
        }
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 9, stageName: 'Number of Engineers' });

  if (bailIfCancelled()) return attioCache;
  // Stage 10 — Number of SREs (non-gating, data collection only)
  const stage10Slug = FIELD_SLUGS['Number of SREs']!;
  const { todo: stage10Todo, done: stage10Done } = splitByCache(survivorsAfterStage6, attioCache, stage10Slug);
  console.log(`[numberOfSres] todo=${stage10Todo.length} skipped=${stage10Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 10, stageName: 'Number of SREs', todo: stage10Todo.length, skipped: stage10Done.length });

  const stage10NoLinkedIn = stage10Todo.filter((c) => !linkedinByDomain.has(c.domain));
  const stage10HaveLinkedIn = stage10Todo.filter((c) => linkedinByDomain.has(c.domain));

  if (stage10NoLinkedIn.length > 0) {
    console.log(`[numberOfSres] writing N/A for ${stage10NoLinkedIn.length} companies missing LinkedIn URL`);
    const naResults: { company: StageCompany; data: NumberOfSresData }[] = stage10NoLinkedIn.map((c) => ({
      company: c,
      data: { count: 0, linkedinUrls: [], na: true as const },
    }));
    await writeStageColumn('Number of SREs', naResults, formatNumberOfSresForAttio, ctx);
    for (const r of naResults) {
      const existing = attioCache.get(r.company.domain) ?? {};
      attioCache.set(r.company.domain, { ...existing, [stage10Slug]: 'N/A' });
    }
  }

  await runStage<HarvestEmployeesResponse, NumberOfSresData>({
    name: 'numberOfSres',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
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
      await writeStageColumn('Number of SREs', batchResults, formatNumberOfSresForAttio, ctx);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage10Slug]: formatNumberOfSresForAttio(r.data) });
        }
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 10, stageName: 'Number of SREs' });

  if (bailIfCancelled()) return attioCache;
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
  ctx.emit({ type: 'stage-started', stageNumber: 11, stageName: 'Engineer Hiring', todo: stage11Todo.length, skipped: stage11Done.length });
  ctx.emit({ type: 'stage-started', stageNumber: 12, stageName: 'SRE Hiring', todo: stage11Todo.length, skipped: stage11Done.length });

  await runStage<CareerSiteJobListingsResponse, CombinedHiringData>({
    name: 'engineerHiring+sreHiring',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
    companies: stage11Todo,
    batchSize: 1,
    retry: { tries: APIFY_RETRY_TRIES, baseMs: APIFY_RETRY_BASE_MS },
    call: (domains) => scheduleApify(() => runCareerSiteJobListings(domains[0]!)),
    parse: (raw, batch) => parseHiringResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Engineer Hiring', batchResults, formatEngineerHiringForAttio, ctx);
      await writeStageColumn('SRE Hiring', batchResults, formatSreHiringForAttio, ctx);
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
  ctx.emit({ type: 'stage-completed', stageNumber: 11, stageName: 'Engineer Hiring' });
  ctx.emit({ type: 'stage-completed', stageNumber: 12, stageName: 'SRE Hiring' });

  if (bailIfCancelled()) return attioCache;
  // Stage 13 — Customer complains on X (non-gating, data collection only)
  const stage13Slug = FIELD_SLUGS['Customer complains on X']!;
  const { todo: stage13Todo, done: stage13Done } = splitByCache(survivorsAfterStage6, attioCache, stage13Slug);
  console.log(`[customerComplaintsOnX] todo=${stage13Todo.length} skipped=${stage13Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 13, stageName: 'Customer complains on X', todo: stage13Todo.length, skipped: stage13Done.length });

  const companyNameByDomain13 = new Map(stage13Todo.map((c) => [c.domain, c.companyName]));
  const companyContextByDomain13 = new Map<string, string>(
    stage13Todo.map((c) => {
      const values = attioCache.get(c.domain) ?? {};
      const ctxStr = values[descriptionSlug] || values[stage2Slug] || '';
      return [c.domain, ctxStr];
    })
  );

  await runStage<TweetItem[], CustomerComplaintsData>({
    name: 'customerComplaintsOnX',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
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
      await writeStageColumn('Customer complains on X', batchResults, formatCustomerComplaintsForAttio, ctx);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage13Slug]: formatCustomerComplaintsForAttio(r.data) });
        }
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 13, stageName: 'Customer complains on X' });

  if (bailIfCancelled()) return attioCache;
  // Stage 14 — Recent incidents ( Official ) (non-gating, data collection only)
  const stage14Slug = FIELD_SLUGS['Recent incidents ( Official )']!;
  const { todo: stage14Todo, done: stage14Done } = splitByCache(survivorsAfterStage6, attioCache, stage14Slug);
  console.log(`[recentIncidents] todo=${stage14Todo.length} skipped=${stage14Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 14, stageName: 'Recent incidents ( Official )', todo: stage14Todo.length, skipped: stage14Done.length });

  const companyNameByDomain14 = new Map(stage14Todo.map((c) => [c.domain, c.companyName]));

  await runStage<StatuspageFetchOutcome, RecentIncidentsData>({
    name: 'recentIncidents',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
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
      await writeStageColumn('Recent incidents ( Official )', batchResults, formatRecentIncidentsForAttio, ctx);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage14Slug]: formatRecentIncidentsForAttio(r.data) });
        }
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 14, stageName: 'Recent incidents ( Official )' });

  if (bailIfCancelled()) return attioCache;
  // Stage 15 — AI Adoption Mindset (non-gating, data collection only)
  const stage15Slug = FIELD_SLUGS['AI adoption mindset']!;
  const { todo: stage15Todo, done: stage15Done } = splitByCache(survivorsAfterStage6, attioCache, stage15Slug);
  console.log(`[aiAdoptionMindset] todo=${stage15Todo.length} skipped=${stage15Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 15, stageName: 'AI adoption mindset', todo: stage15Todo.length, skipped: stage15Done.length });

  const companyNameByDomain15 = new Map(stage15Todo.map((c) => [c.domain, c.companyName]));

  await runStage<ExaSearchResponse, AiAdoptionMindsetData>({
    name: 'aiAdoptionMindset',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
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
      await writeStageColumn('AI adoption mindset', batchResults, formatAiAdoptionMindsetForAttio, ctx);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage15Slug]: formatAiAdoptionMindsetForAttio(r.data) });
        }
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 15, stageName: 'AI adoption mindset' });

  if (bailIfCancelled()) return attioCache;
  // Stage 16 — AI SRE Maturity (non-gating, data collection only)
  const stage16Slug = FIELD_SLUGS['AI SRE maturity']!;
  const competitorToolingSlug = FIELD_SLUGS['Competitor Tooling']!;
  const { todo: stage16Todo, done: stage16Done } = splitByCache(survivorsAfterStage6, attioCache, stage16Slug);
  ctx.emit({ type: 'stage-started', stageNumber: 16, stageName: 'AI SRE maturity', todo: stage16Todo.length, skipped: stage16Done.length });

  // Companies already using a competitor tool: copy Competitor Tooling value directly, skip Exa
  const stage16ExaTodo: typeof stage16Todo = [];
  for (const company of stage16Todo) {
    const competitorValue = attioCache.get(company.domain)?.[competitorToolingSlug] ?? '';
    if (competitorValue && competitorValue !== 'Not using any competitor tools') {
      const newlineIdx = competitorValue.indexOf('\n');
      const toolNames = newlineIdx === -1 ? competitorValue : competitorValue.slice(0, newlineIdx);
      const rest = newlineIdx === -1 ? '' : competitorValue.slice(newlineIdx);
      const sreMaturityValue = `Working with vendor: ${toolNames}${rest}`;
      await writeStageColumn(
        'AI SRE maturity',
        [{ company, data: { text: sreMaturityValue } as unknown as AiSreMaturityData }],
        () => sreMaturityValue,
        ctx
      );
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
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
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
      await writeStageColumn('AI SRE maturity', batchResults, formatAiSreMaturityForAttio, ctx);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage16Slug]: formatAiSreMaturityForAttio(r.data) });
        }
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 16, stageName: 'AI SRE maturity' });

  if (bailIfCancelled()) return attioCache;
  // Stage 17 — Industry (batch-of-2, non-gating, data collection only)
  const stage17Slug = FIELD_SLUGS['Industry']!;
  const { todo: stage17Todo, done: stage17Done } = splitByCache(survivorsAfterStage6, attioCache, stage17Slug);
  console.log(`[industry] todo=${stage17Todo.length} skipped=${stage17Done.length}`);
  ctx.emit({ type: 'stage-started', stageNumber: 17, stageName: 'Industry', todo: stage17Todo.length, skipped: stage17Done.length });

  await runStage<ExaSearchResponse, IndustryData>({
    name: 'industry',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
    companies: stage17Todo,
    batchSize: 2,
    retry: { tries: EXA_RETRY_TRIES, baseMs: EXA_RETRY_BASE_MS },
    call: (domains) => scheduleExa(() => industryExaSearch(domains)),
    parse: (raw, batch) => parseIndustryResponse(raw, batch),
    afterBatch: async (batchResults) => {
      await writeStageColumn('Industry', batchResults, formatIndustryForAttio, ctx);
      for (const r of batchResults) {
        if (r.error === undefined) {
          const existing = attioCache.get(r.company.domain) ?? {};
          attioCache.set(r.company.domain, { ...existing, [stage17Slug]: formatIndustryForAttio(r.data) });
        }
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 17, stageName: 'Industry' });

  if (bailIfCancelled()) return attioCache;
  // Stage 18 — Company Context Score (OpenAI synthesis, hash-gated re-run)
  const stage18Slug = FIELD_SLUGS['Company Context Score']!;
  const hashSlug = FIELD_SLUGS['Company Context Score Change Detection for Developer']!;
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
  ctx.emit({ type: 'stage-started', stageNumber: 18, stageName: 'Company Context Score', todo: stage18Todo.length, skipped: stage18Eligible.length - stage18Todo.length });

  await runStage<Record<string, string>, ContextScoreData>({
    name: 'contextScore',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
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
        await attioUpsertWithCancel(ctx, {
          'Company Name': r.company.companyName,
          'Domain': r.company.domain,
          'Company Context Score': cell,
          'Company Context Score Change Detection for Developer': hash,
        });
        setAndEmit(
          ctx,
          attioCache,
          r.company.domain,
          { [stage18Slug]: cell, [hashSlug]: hash },
          [
            { slug: stage18Slug, column: 'Company Context Score' },
            { slug: hashSlug, column: 'Company Context Score Change Detection for Developer' },
          ]
        );
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 18, stageName: 'Company Context Score' });

  if (bailIfCancelled()) return attioCache;
  // Stage 19 — Tooling Match Score
  const stage19Slug = FIELD_SLUGS['Tooling Match Score']!;
  const stage19HashSlug = FIELD_SLUGS['Tooling Match Change Detection for Developer']!;
  const toolingInputSlugs = (TOOLING_MATCH_INPUT_COLUMNS as readonly string[]).map((c) => FIELD_SLUGS[c]!);
  const priorSlugsForStage19 = enrichableSlugsForHash;

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
  ctx.emit({ type: 'stage-started', stageNumber: 19, stageName: 'Tooling Match Score', todo: stage19Todo.length, skipped: stage19Eligible.length - stage19Todo.length });

  await runStage<Record<string, string>, ToolingMatchScoreData>({
    name: 'toolingMatchScore',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
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
        await attioUpsertWithCancel(ctx, {
          'Company Name': r.company.companyName,
          'Domain': r.company.domain,
          'Tooling Match Score': cell,
          'Tooling Match Change Detection for Developer': hash,
        });
        setAndEmit(
          ctx,
          attioCache,
          r.company.domain,
          { [stage19Slug]: cell, [stage19HashSlug]: hash },
          [
            { slug: stage19Slug, column: 'Tooling Match Score' },
            { slug: stage19HashSlug, column: 'Tooling Match Change Detection for Developer' },
          ]
        );
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 19, stageName: 'Tooling Match Score' });

  if (bailIfCancelled()) return attioCache;
  // Stage 20 — Intent Signal Score
  const stage20Slug = FIELD_SLUGS['Intent Signal Score']!;
  const stage20HashSlug = FIELD_SLUGS['Intent Signal Change Detection for Developer']!;
  const intentInputSlugs = (INTENT_SIGNAL_INPUT_COLUMNS as readonly string[]).map((c) => FIELD_SLUGS[c]!);
  const priorSlugsForStage20 = enrichableSlugsForHash;

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
  ctx.emit({ type: 'stage-started', stageNumber: 20, stageName: 'Intent Signal Score', todo: stage20Todo.length, skipped: stage20Eligible.length - stage20Todo.length });

  await runStage<Record<string, string>, IntentSignalScoreData>({
    name: 'intentSignalScore',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
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
        await attioUpsertWithCancel(ctx, {
          'Company Name': r.company.companyName,
          'Domain': r.company.domain,
          'Intent Signal Score': cell,
          'Intent Signal Change Detection for Developer': hash,
        });
        setAndEmit(
          ctx,
          attioCache,
          r.company.domain,
          { [stage20Slug]: cell, [stage20HashSlug]: hash },
          [
            { slug: stage20Slug, column: 'Intent Signal Score' },
            { slug: stage20HashSlug, column: 'Intent Signal Change Detection for Developer' },
          ]
        );
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 20, stageName: 'Intent Signal Score' });

  if (bailIfCancelled()) return attioCache;
  // Stage 21 — Final Score
  const stage21Slug = FIELD_SLUGS['Final Score']!;
  const stage21HashSlug = FIELD_SLUGS['Final Score Change Detection for Developer']!;
  const finalInputSlugs = (FINAL_SCORE_INPUT_COLUMNS as readonly string[]).map((c) => FIELD_SLUGS[c]!);
  const priorSlugsForStage21 = enrichableSlugsForHash;

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
  ctx.emit({ type: 'stage-started', stageNumber: 21, stageName: 'Final Score', todo: stage21Todo.length, skipped: stage21Eligible.length - stage21Todo.length });

  await runStage<Record<string, string>, FinalScoreData>({
    name: 'finalScore',
    isCancelled: ctx.isCancelled,
    cancelSignal: ctx.cancelSignal,
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
        await attioUpsertWithCancel(ctx, {
          'Company Name': r.company.companyName,
          'Domain': r.company.domain,
          'Final Score': cell,
          'Final Score Change Detection for Developer': hash,
        });
        setAndEmit(
          ctx,
          attioCache,
          r.company.domain,
          { [stage21Slug]: cell, [stage21HashSlug]: hash },
          [
            { slug: stage21Slug, column: 'Final Score' },
            { slug: stage21HashSlug, column: 'Final Score Change Detection for Developer' },
          ]
        );
      }
    },
  });
  ctx.emit({ type: 'stage-completed', stageNumber: 21, stageName: 'Final Score' });

  // Run-completed: survivors/rejected counts for the run-completed event
  const rejectedDomains = new Set<string>([
    ...stage2TodoRejected, ...stage2DoneRejected,
    ...stage3TodoRejected, ...stage3DoneRejected,
    ...stage4TodoRejected, ...stage4DoneRejected,
    ...stage5TodoRejected, ...stage5DoneRejected,
    ...stage6TodoRejected, ...stage6DoneRejected,
  ].map((r) => r.company.domain));
  ctx.emit({
    type: 'run-completed',
    surviving: survivorsAfterStage6.length,
    rejected: rejectedDomains.size,
    errored: 0,
  });

  console.log(`\n[done] total=${companies.length} survivors=${survivorsAfterStage6.length} badDomains=${skippedBadDomain}`);

  return attioCache;
}

function skipReason(s: {
  name: string;
  hasWebsite: boolean;
  hasLinkedin: boolean;
  missingApolloId: boolean;
}): string {
  const parts: string[] = [];
  if (!s.hasWebsite && !s.hasLinkedin) {
    parts.push('Missing Website and LinkedIn URL');
  } else if (!s.hasWebsite) {
    parts.push('Missing Website (no domain available)');
  } else {
    parts.push('Missing LinkedIn URL');
  }
  if (s.missingApolloId) parts.push('no Apollo ID');
  return parts.join(' · ');
}
