# Project
**Bacca.ai** is an AI SRE startup that sells software to high-scale digital-native platforms. This CLI script is part of Bacca's GTM motion: it enriches a list of potential customers (from a CSV) via Apify, Exa, TheirStack, and Azure OpenAI, then writes results to an Attio custom object (`ranked_companies`). The enrichment columns score each company against Bacca's ICP criteria — digital nativeness, scale, observability stack, cloud platform, hiring signal, and more — so the sales team can prioritise outreach.

## Stack
- TypeScript (strict, ESNext modules, `tsx` for direct execution)
- Node.js ≥18, ESM (`"type": "module"`)
- commander — CLI parsing
- axios — Attio REST API client
- exa-js — Exa neural search
- apify-client — Apify actor runs
- openai — Azure OpenAI SDK
- csv-parse / csv-stringify — CSV I/O
- bottleneck — token-bucket rate limiter (Exa QPS, TheirStack QPS)
- p-limit — concurrency limiter (Attio writes)
- dotenv — env loading
- vitest — unit tests

## Architecture
```
src/
  index.ts          — CLI entry: registers all commands via commander
  config.ts         — KEYS, PATHS, CONCURRENCY, ENRICHABLE_COLUMNS, EXA_QPS, EXA_RETRY_*, ATTIO_WRITE_CONCURRENCY, OPENAI_CONCURRENCY, THEIRSTACK_QPS, THEIRSTACK_RETRY_*, APOLLO_QPS, APOLLO_RETRY_*, APIFY_CONCURRENCY, APIFY_RETRY_*, TWITTER_API_QPS, TWITTER_API_RETRY_*, STATUSPAGE_CONCURRENCY, STATUSPAGE_RETRY_* (single source of truth)
  types.ts          — EnrichableColumn, EnrichmentResult, InputRow, EnricherFn, AttioRecord
  rateLimit.ts      — Bottleneck instances for Exa, TheirStack, Apollo, and twitterapi.io (QPS-paced) + p-limit for Attio writes, OpenAI calls, Apify runs, and Statuspage probes; exports scheduleExa, scheduleTheirstack, scheduleApollo, scheduleApify, scheduleTwitterApi, scheduleStatuspage, attioWriteLimit, openaiLimit
  pipeline.ts       — runPipeline (all columns) + runSingleEnricher (one column)
  csv.ts            — readInputCsv
  util.ts           — deriveDomain, nowIso, withRetry, normalizeLinkedInUrl
  cache.ts          — disk cache helpers
  filterSurvivors.ts — pipeline-level utility: apply gate to fresh results (filterSurvivors) + apply cacheGate to Attio-cached entries (filterCachedSurvivors); returns { survivors, rejected[] }
  runStage.ts       — pipeline-level utility: generic stage runner with batching, concurrency, and retry
  writeStageColumn.ts — pipeline-level utility: write one column to Attio for all successful stage results
  rejectionReasons.ts — one reason-string builder per gate stage (fresh-data + cached-string variants)
  writeRejectionReason.ts — crash-safe Attio writer for the Reason for Rejection column; rate-limited via attioWriteLimit
  apis/
    attio.ts        — Attio REST client: findCompanyByDomain, create/update, upsertCompanyByDomain, upsertCompanyByLinkedInUrl
    exa.ts          — Exa search calls; ExaSearchResponse type; most stage functions use structured JSON outputSchema + type:'deep-reasoning'; aiAdoptionMindsetExaSearch and aiSreMaturityExaSearch use text outputSchema (outputSchema: { type: 'text' })
    apify.ts        — Apify actor client: runHarvestLinkedInEmployees (harvestapi/linkedin-company-employees, run-sync via SDK); runCareerSiteJobListings (fantastic-jobs/career-site-job-listing-feed, run-sync via SDK)
    openai.ts       — Azure OpenAI wrapper
    theirstack.ts   — TheirStack API
    apollo.ts       — Apollo REST API client: apolloMixedPeopleApiSearch (POST /mixed_people/api_search, reads total_entries)
    twitterapi.ts   — twitterapi.io client: twitterAdvancedSearch (GET /twitter/tweet/advanced_search); fetchComplaintTweets (paginated, caps at 50 tweets, since_time=90 days ago)
    statuspage.ts   — Statuspage v2 client (no auth): slugCandidates (strips legal suffixes, returns compact + dashed), fetchRecentIncidents (probes https://status.{domain} then https://{slug}.statuspage.io, paginates 90-day window)
  commands/
    enrichAll.ts    — stage-wise bulk enrichment: Stage 1 → write → Stage 2 → filter → …
    enrichAll.e2e.test.ts — E2E integration tests for the enrichAll pipeline (13 scenarios)
    enrichAll.e2e.helpers.ts — test helpers: makeCsv, makeExaResponse, makeExaTextResponse
    enrichCompany.ts — enrich one company by domain (row-wise, uses pipeline.ts)
    enrichColumn.ts — overwrite one column for one company
    attioSmoke.ts   — smoke test: upsert Company Name + Domain only
  enrichers/
    index.ts        — ENRICHERS map (EnrichableColumn → EnricherFn) + ENRICHABLE_COLUMN_LIST
  stages/
    types.ts        — StageCompany, StageResult<T>, GateRule<T>
    competitorTool.ts   — Stage 1: local company-name match against COMPETITOR_TOOLS + TheirStack sub-call (komodor/mezmo/rootly-slack) for non-locally-matched companies; no gate; Attio formatter (comma-joined tool names + per-tool evidence, or "Not using any competitor tools"); exports COMPETITOR_THEIRSTACK_SLUGS, detectCompetitorToolsFromTheirStack
    digitalNative.ts    — Stage 2: parser (structured JSON), gate, Attio formatter
    observabilityTool.ts — Stage 4: async parser (structured JSON), LinkedIn profile verification via Azure OpenAI judge(), gate (Datadog/Grafana/Prometheus allowlist), Attio formatter
    communicationTool.ts — Stage 5: sync parser, two-step TheirStack search (Slack → Microsoft Teams), gate (reject if MS Teams), Attio formatter
    cloudTool.ts        — Stage 6: parser (structured JSON), gate (pass on AWS/GCP/Both/no-evidence; reject other clouds), Attio formatter (`<Tool>: <url>` or "No evidence found")
    fundingGrowth.ts    — Stage 7: parser (structured JSON), no gate, Attio formatter (Growth / Timeframe / Evidence multi-line)
    revenueGrowth.ts    — Stage 8: parser (structured JSON), no gate, Attio formatter (Growth / Evidence / Reasoning / Confidence multi-line)
    numberOfUsers.ts    — Stage 3: parser (structured JSON, includes user_count_bucket enum), conditional gate (B2B AND bucket NOT "100K+" AND bucket NOT "unknown"), Attio formatter (multi-line with bucket field); exports extractUserCountBucketFromCached, UserCountBucket
    numberOfEngineers.ts — Stage 9: Apollo api_search parser, no gate, Attio formatter (plain integer string e.g. "47"); exports ENGINEER_TITLES
    numberOfSres.ts      — Stage 10: Apify harvestapi parser (counts items), no gate, Attio formatter (plain integer string e.g. "3", or "N/A" when no LinkedIn URL); exports SRE_TITLES
    engineerHiring.ts    — Stage 11+12: Apify career-site-job-listing-feed parser (one call → two columns), no gate, Attio formatters for Engineer Hiring and SRE Hiring; exports ENGINEER_HIRING_TITLE_SEARCH, ENGINEER_HIRING_TITLE_EXCLUSIONS
    customerComplaintsOnX.ts — Stage 13: twitterapi.io complaint tweets + Azure OpenAI classifier (4 buckets), no gate, Attio formatter (4-line count string)
    recentIncidents.ts  — Stage 14: Statuspage v2 parser (drops dates, keeps impact + component names), no gate, Attio formatter (counts line + top components + per-incident list, or "Private status page" / "No status page found" / "0 incidents (last 90 days)")
    aiAdoptionMindset.ts — Stage 15: text parser (passes Exa text output through verbatim), no gate, Attio formatter (verbatim Classification/Confidence/Evidence/Reasoning block)
    aiSreMaturity.ts    — Stage 16: text parser (passes Exa text output through verbatim), no gate, Attio formatter (verbatim Classification/Confidence/Sales signal/Evidence/Reasoning block)
    industry.ts         — Stage 17: parser (structured JSON, enum-enforced 23-category list), no gate, Attio formatter (two-line `industry: X\nreason: Y`); off-enum values yield error (cell left blank for retry)
    companyContextScore.ts — Context Score State (Stage 18): OpenAI scorer (0–5, 0.5 increments) using all prior Attio cells; hash-gated re-run via `change_detection_column_for_developer`; exports computeInputHash, scoreCompanyContext, formatContextScoreForAttio
    toolingMatchScore.ts   — Tooling Match Score (Stage 19): OpenAI scorer over 4 tooling cells (Communication Tool, Competitor Tooling, Observability Tool, Cloud Tool); hash-gated re-run via `tooling_match_change_detection_for_developer` (hash covers only those 4 inputs); exports scoreToolingMatch, formatToolingMatchScoreForAttio, parseToolingMatchResponse, TOOLING_MATCH_INPUT_COLUMNS
    intentSignalScore.ts   — Intent Signal Score (Stage 20): OpenAI scorer over 8 buying-signal cells (Tier 1: Customer complains on X, Engineer Hiring, SRE Hiring, AI SRE maturity; Tier 2: Recent incidents, AI adoption mindset; Tier 3: Funding Growth, Revenue Growth); hash-gated re-run via `intent_signal_change_detection_for_developer`; exports scoreIntentSignal, formatIntentSignalScoreForAttio, parseIntentSignalResponse, INTENT_SIGNAL_INPUT_COLUMNS
    finalScore.ts          — Final Score (Stage 21): local weighted formula (0.5×Intent + 0.3×Context + 0.2×Tooling), tier bucketing, and hard override (Context=0 → 0/Tier5); OpenAI used for reasoning only (non-pro model); hash-gated via `final_score_change_detection_for_developer` (hash covers 3 upstream score cells); exports scoreFinal, formatFinalScoreForAttio, computeFinalScore, extractScoreFromContextCell, extractScoreFromToolingCell, extractScoreFromIntentCell, FINAL_SCORE_INPUT_COLUMNS
data/input.csv      — input (gitignored)
cache/              — disk cache for API responses
```

## Concurrency & rate limits
All outbound Exa calls must go through `scheduleExa()` in `rateLimit.ts`. It wraps Bottleneck and enforces Exa's 5 QPS ceiling for deep search with safety headroom (default 3 QPS). All outbound TheirStack calls must go through `scheduleTheirstack()`, which enforces 300 RPM (free-plan ceiling) with safety headroom (default 4 QPS). All outbound Apollo calls must go through `scheduleApollo()`, which enforces the plan's 200/min cap with safety headroom (default 3 QPS = 180/min). Apollo also has a 6000/hour cap — 429s from the hourly cap are handled by runStage retry-with-backoff. All outbound Apify calls must go through `scheduleApify()`, which enforces a concurrency cap (default `p-limit(10)`) — Apify run-sync calls are long-running (30s–2 min), so concurrency rather than QPS is the right shape. If the actor returns `statusMessage === 'rate limited'` (LinkedIn hourly cap hit), `runHarvestLinkedInEmployees` throws so `runStage` records an error and leaves the Attio cell blank — the company will be retried on the next run. Set `APIFY_CONCURRENCY` to your Apify plan's actor concurrency ceiling to maximise throughput. Statuspage probes go through `scheduleStatuspage()`, which is concurrency-only (default `p-limit(20)`) — Statuspage has no documented rate limit and each probe hits a different host, so a local socket cap is all that's needed. Attio writes go through `attioWriteLimit` (default `p-limit(5)`). Azure OpenAI calls go through `openaiLimit` (default `p-limit(5)`).

`runStage` fires all batches concurrently — back-pressure comes from the relevant rate limiter, not from sequential looping. Each batch:
1. Calls `call()` (rate-limited by Bottleneck or pLimit).
2. Retries on failure with exponential backoff (configurable tries + base ms, factor 4 → 1s, 4s, 16s). Retries are per-batch and do not block other batches.
3. On terminal failure, yields `{company, error}` results for that batch and moves on.
4. `afterBatch` (usually Attio writes) fires as soon as the batch resolves, independently of other batches. afterBatch errors are logged and swallowed — they never abort the stage.

Tunables in `.env`:
- `EXA_QPS` (default 5) — Exa calls per second (matches Exa's hard limit for deep search)
- `EXA_RETRY_TRIES` (default 3)
- `EXA_RETRY_BASE_MS` (default 1000)
- `ATTIO_WRITE_CONCURRENCY` (default 5) — max in-flight Attio upserts
- `OPENAI_CONCURRENCY` (default 5) — max concurrent Azure OpenAI calls (LinkedIn profile verification)
- `THEIRSTACK_QPS` (default 4) — TheirStack calls per second (free plan = 300 RPM ≈ 5 QPS)
- `THEIRSTACK_RETRY_TRIES` (default 3)
- `THEIRSTACK_RETRY_BASE_MS` (default 1000)
- `APOLLO_QPS` (default 3) — Apollo calls per second (paid plan = 200/min = 3.33 QPS; hourly cap = 6000/hr)
- `APOLLO_RETRY_TRIES` (default 3)
- `APOLLO_RETRY_BASE_MS` (default 1000)
- `APIFY_CONCURRENCY` (default 10) — max concurrent Apify run-sync calls; set to match your Apify plan's actor concurrency limit (free=3, personal=10, team=25+)
- `APIFY_RETRY_TRIES` (default 3)
- `APIFY_RETRY_BASE_MS` (default 2000)
- `TWITTER_API_QPS` (default 10) — twitterapi.io calls per second (provider allows 1000+ RPS)
- `TWITTER_API_RETRY_TRIES` (default 3)
- `TWITTER_API_RETRY_BASE_MS` (default 1000)
- `STATUSPAGE_CONCURRENCY` (default 20) — max concurrent Statuspage probes; no QPS limit (Statuspage has no documented rate limit and probes hit different hosts)
- `STATUSPAGE_RETRY_TRIES` (default 3)
- `STATUSPAGE_RETRY_BASE_MS` (default 1000)
- `AZURE_OPENAI_DEPLOYMENT_PRO` (optional, default empty → falls back to `AZURE_OPENAI_DEPLOYMENT`) — stronger Azure deployment used by Stage 18 (Company Context Score) and Stage 19 (Tooling Match Score); set to `gpt-5.4-pro` to use the pro model

## Stage-wise pipeline (enrich-all)

`enrich-all` processes all companies stage-by-stage (not row-by-row), to preserve Exa's batch-of-2 cost efficiency.

Flow: load CSV → pre-fetch ALL Attio records (unfiltered) → merge: processing set = CSV companies ∪ any Attio record with empty `Reason for Rejection` → Stage 1 → Attio write per batch as results arrive → filter survivors → Stage 2 → … → write final results.

The processing set includes Attio records that are no longer in the current CSV, as long as they have not been rejected at any gate. Attio records whose `Reason for Rejection` column is filled are excluded (stay as-is). For Attio-only companies, the company name and LinkedIn URL come from the Attio record itself.

No on-disk progress ledger. Resume semantics come from the Attio pre-fetch: on startup, any company whose target column is already populated is skipped for that stage.

Cached Attio values must still pass the stage's gate — otherwise a company rejected on a prior run would resurface on re-run. Each gating stage exports a `<stage>CacheGate(cached: string): boolean` alongside its regular gate; `filterCachedSurvivors` (in `filterSurvivors.ts`) applies it to the `done` pool before merging into the survivor set. When editing a stage's formatter, update its cacheGate in the same change so they stay in sync.

### Stage order and gating rules

| # | Column | API | Gate (pass condition) |
|---|---|---|---|
| 1 | Competitor Tooling | local match + TheirStack | no gate — data collection only |
| 2 | Digital Native | Exa | category is NOT `NOT Digital-native` |
| 3 | Number of Users | Exa | conditional: for `Digital-native B2B` only — `user_count_bucket` must be `100K+`; non-B2B, fetch errors, and `unknown` bucket pass unconditionally (unknown = flag for human review, not rejected) |
| 4 | Observability Tool | Exa | no tool evidence OR at least one of: Datadog, Grafana, Prometheus |
| 5 | Communication Tool | TheirStack | no evidence OR uses Slack (reject if Microsoft Teams / Microsoft) |
| 6 | Cloud Tool | Exa | no evidence OR uses AWS OR GCP |
| 7 | Funding Growth | Exa | no gate — data collection only |
| 8 | Revenue Growth | Exa | no gate — data collection only |
| 9 | Number of Engineers | Apollo | no gate — data collection only |
| 10 | Number of SREs | Apify | no gate — data collection only |
| 11 | Engineer Hiring | Apify | no gate — data collection only |
| 12 | SRE Hiring | Apify (same call as Stage 11) | no gate — data collection only |
| 13 | Customer complains on X | twitterapi.io + Azure OpenAI | no gate — data collection only |
| 14 | Recent incidents ( Official ) | Statuspage v2 | no gate — data collection only |
| 15 | AI adoption mindset | Exa | no gate — data collection only |
| 16 | AI SRE maturity | Exa | no gate — data collection only |
| 17 | Industry | Exa | no gate — data collection only |
| 18 | Company Context Score | Azure OpenAI (`gpt-5.4-pro`) | no gate — synthesis over prior Attio cells |
| 19 | Tooling Match Score | Azure OpenAI (`gpt-5.4-pro`) | no gate — scores 4 tooling cells; runs at same level as Stage 18 |
| 20 | Intent Signal Score | Azure OpenAI (`gpt-5.4-pro`) | no gate — synthesis over 8 buying-signal cells; runs at same level as Stages 18 and 19 |
| 21 | Final Score | Azure OpenAI (`gpt-5.4`) | no gate — local weighted formula over 3 upstream scores (18/19/20); OpenAI for reasoning only; runs after 18/19/20 |

Stages 2–6 are gating stages. Companies rejected at any gate are written to Attio with whatever columns were filled so far, then dropped from further processing. Immediately after each gate, rejected companies receive a `Reason for Rejection` value written to Attio (crash-safe, via `writeRejectionReasons` in `src/writeRejectionReason.ts`). The reason format is `"<Stage name>: <specific reason>"` (e.g. `"Cloud Tool: uses Azure (not AWS/GCP)"`). Errored companies (fetch/parse failure) are not written — they will be retried on the next run.

Stage 1 (Competitor Tooling) is **not a gating stage**. All companies continue to Stage 2 regardless of findings. Stage 1 runs in two steps per company: (a) local exact case-insensitive match against `COMPETITOR_TOOLS` (hardcoded customer lists) — if matched, writes result and skips the API call; (b) for companies with no local match, calls TheirStack with `job_technology_slug_or: ["komodor","mezmo","rootly-slack"]` and checks both `technology_slugs` and `technology_names` for those keywords (exact case-insensitive equality); maps slug→tool: `komodor`→Komodor, `mezmo`→Mezmo, `rootly-slack`→Rootly. To update the hardcoded lists, edit `COMPETITOR_TOOLS` in `src/stages/competitorTool.ts` directly. TheirStack-based detection uses `scheduleTheirstack()` + `THEIRSTACK_RETRY_*` retry settings.

### Attio value format for Exa-based stages

Format varies by column:

**Digital Native** — multi-line string (blank lines between sections):
```
<category>

Confidence: <High | Medium | Low>

Reasoning: <Exa's reason text>

Sources:
<url1>
<url2>
...
```
The `Sources:` block is omitted when Exa returns no source links.

**Observability Tool** — per-tool lines, one per found tool (no confidence/reasoning):
```
<Tool name>: <source URL>
<Tool name>: <source URL>
```
LinkedIn profile URLs (`linkedin.com/in/*`) are verified via Azure OpenAI `judge()` against the full page text returned by Exa's `contents.text`. A tool is kept only if OpenAI returns `verdict: "yes"` (tool mentioned under the target company's experience block). All other source URLs (job postings, vendor pages, blogs) are accepted without verification. LinkedIn profiles not in `results[]` (no page text available) are dropped.
If no evidence found: literal `No evidence found`.

**Communication Tool** — single line with the tool found and its evidence URL:
```
Slack: <source_url>
```
or
```
Microsoft Teams: <source_url>
```
Stage 4 is per-company (batchSize: 1), not batch-of-2. The call makes two sequential TheirStack POST requests per company: first for `"slack"`, then for `"microsoft-teams"` only if Slack returned nothing. Companies with Slack evidence or no evidence continue; companies with only Microsoft Teams evidence are rejected by the gate.
If no evidence found: literal `No evidence found`.

**Cloud Tool** — single line with the cloud vendor and its evidence URL:
```
AWS: <source_url>
```
or
```
GCP: <source_url>
```
or (both detected):
```
Both: <source_url>
```
Stage 5 is batch-of-2 (like Digital Native). Exa returns the actual vendor name from source evidence; `tool` is a free-form string (no enum constraint). Gate passes AWS / GCP / Both / no-evidence; rejects any other cloud (Azure, IBM Cloud, etc.).
If no evidence found: literal `No evidence found`.

**Competitor Tooling** — comma-joined competitor tool names on the first line, blank line, then one `Evidence:` line per matched tool. Evidence format depends on detection path:
- Hardcoded customer list match → `Evidence: (<Tool>'s customer page)`
- TheirStack job-signal match → `Evidence: <source_url>` (actual URL from `collectJobUrls(job)`)

Example (hardcoded):
```
Rootly

Evidence: (Rootly's customer page)
```
Example (TheirStack):
```
Komodor

Evidence: https://jobs.example.com/123
```
Example (multiple tools, mixed sources):
```
Resolve.ai, Komodor

Evidence: (Resolve.ai's customer page)
Evidence: https://jobs.example.com/123
```
No match:
```
Not using any competitor tools
```

**Funding Growth** — multi-line string (blank lines between sections):
```
Growth: <round and amount, e.g. "Series B, $50M">

Timeframe: <date or period>

Evidence: <source URL>
```
If timeframe or evidence are empty, those lines are omitted.

**Revenue Growth** — multi-line string:
```
Growth: <revenue + trajectory, e.g. "~$15M ARR (estimated), growing ~40% YoY">

Evidence: <source URL>

Source date: <ISO date or month/quarter/year, e.g. "2024-03-15" or "Q1 2024">

Reasoning: <signals used and the math when inferred>

Confidence: <high | medium | low>
```
If evidence, source date, or reasoning are empty, those lines are omitted. Confidence is always present. Exa is required to infer a numeric revenue + growth-rate estimate from proxy signals (headcount × revenue-per-employee benchmarks, funding stage, customer count × ACV, web traffic) when exact figures are unavailable — `"Insufficient data"` is reserved for the rare case of zero usable signals.

**Number of Users** — multi-line string:
```
User count: <human-readable description, e.g. "~500K MAU per 2024 blog post" or "unknown">

User count bucket: <<100 | 100–1K | 1K–10K | 10K–100K | 100K+ | unknown>

Reasoning: <what evidence was found, or why it is unknown>

Source link: <source URL>

Source date: <ISO date or month/quarter/year, e.g. "2024-03-15" or "Q1 2024">

Confidence: <high | medium | low>
```
If reasoning, source_link, or source_date are empty, those lines are omitted. Confidence is always present. Exa uses only directly disclosed evidence (press releases, official claims, ARR÷ACV when both values are explicitly stated, third-party estimates from Sacra/Growjo/Latka); funding stage benchmarks and headcount ratios are not used.
Stage 3 gate: Exa returns `user_count_bucket`. For `Digital-native B2B` companies, the gate passes only if `user_count_bucket === '100K+'`. Non-B2B categories pass unconditionally. Fetch errors pass (transient). `user_count_bucket === 'unknown'` → **pass** — the company continues but is flagged for human review. Only B2B companies with a known bucket below 100K are rejected.

**Number of Engineers** — plain integer as string (e.g. `47` or `0`). `0` is written when Apollo returns no matches — do not leave blank.

**Number of SREs** — count on the first line, blank line, then one LinkedIn profile URL per line:
```
3

https://linkedin.com/in/person1
https://linkedin.com/in/person2
https://linkedin.com/in/person3
```
Written as `N/A` when the company has no `Company Linkedin Url` in the CSV. Written as a plain integer (e.g. `0`) when Apify returns items with no `linkedinUrl` field. Cap is 20 (actor `maxItems: 20`). Titles searched: `["SRE", "Site Reliability", "Site Reliability Engineer"]`. Excluded seniority level IDs: `["310", "320"]`.

**Engineer Hiring** — count on the first line, blank line, then one `title: url` per line:
```
5

Senior Engineer: https://acme.com/jobs/1
SRE: https://acme.com/jobs/2
...
```
Written as `0` when the actor returns no matching jobs. Titles are filtered by the actor via `titleSearch`/`titleExclusionSearch` constants in `engineerHiring.ts`; all returned items are counted.

**SRE Hiring** — same format as Engineer Hiring, but only items whose title contains "SRE" or "Site Reliability" (case-insensitive substring):
```
2

Site Reliability Engineer: https://acme.com/jobs/2
Sr. SRE: https://acme.com/jobs/3
```
Written as `0` when no items match the SRE keywords. Derived from the same Apify response as Engineer Hiring — no second API call.

**Customer complains on X** — four lines, always present (even for zeros):
```
Full outage: X
Partial outage: X
Performance degradation: X
Unclear: X
```
Tweets fetched via twitterapi.io GET `/twitter/tweet/advanced_search` (query: `@<domain-sld> OR <domain> OR "<Company Name>")` + complaint keywords + `since_time=90 days ago`). Paginated until 50 tweets accumulated or `has_next_page=false`. Truncated to 50 before the single OpenAI classification call. Zero counts written when no tweets found.

**Recent incidents ( Official )** — multi-line summary from Statuspage v2 native fields (no dates, no OpenAI):
```
Critical: 1  |  Major: 3  |  Minor: 7  |  None: 2

Top affected components: Dashboard (4), API (3), Edge Network (2)

Incidents (last 90 days):
- [major] Dashboard slowness — Dashboard
- [critical] API outage — API, Edge Network
- ...
```
Per-incident line omits the em-dash + component list when no components are attached. Full list (no cap). Top components sorted by count desc, tie-broken alphabetically.
Three sentinel strings replace the full summary:
- `Private status page` — first probe returned HTTP 401.
- `No status page found` — all probes returned non-200 or non-JSON (or JSON without `incidents` array).
- `0 incidents (last 90 days)` — page exists and responds correctly but has no incidents in the last 90 days.

Probe order per company (first non-`try-next` outcome wins):
1. `https://status.{domain}/api/v2/incidents.json?limit=100&page=1`
2. `https://{slug}.statuspage.io/...` for each candidate slug from `slugCandidates(companyName)` — strips trailing legal suffixes (Inc./LLC/Ltd./Corp./Corporation/Co./GmbH/etc.) then produces compact (`datadog`) and dashed (`new-relic`) variants, deduped.

Pagination: `?limit=100&page=N`, stops when (a) oldest `created_at` on the page is older than 90 days, (b) a page returns fewer than 100 items, or (c) the 10-page safety cap is reached. The final set is filtered to the 90-day window before being returned.

**AI adoption mindset** — verbatim text from Exa (no reformatting). Exa's `deep-reasoning` model writes this directly:
```
Classification: <Aggressive | Neutral | Conservative | Not publicly confirmed>
Confidence: <High | Medium | Low>
Evidence:
- "<paraphrase of statement or observation>" (source URL)
- "<paraphrase of statement or observation>" (source URL)
Reasoning:
- 2 to 4 bullet points tied directly to evidence
```
Stage 15 is per-company (batchSize: 1). The query, `additionalQueries`, and `systemPrompt` are all company-specific (domain + companyName substituted at runtime). No link validation.

**AI SRE maturity** — verbatim text from Exa (no reformatting). Exa's `deep-reasoning` model writes this directly:
```
Classification: <building in-house | working with vendors | ideating | not ready | unverified>
Confidence: <High | Medium | Low>
Sales signal: <Strong buy | Competitor risk | High potential | Not ready | Unknown>
Evidence:
- "<paraphrase of statement or observation>" (source URL)
- "<paraphrase of statement or observation>" (source URL)
Reasoning:
- 2 to 5 bullet points tied directly to evidence
```
Stage 16 is per-company (batchSize: 1). The query, `additionalQueries`, and `systemPrompt` are all company-specific (domain + companyName substituted at runtime). No link validation. Operates on `survivorsAfterStage6` independently of Stage 15.

**Industry** — two-line string:
```
industry: <one category from the 23-item allowed list, or Unknown>
reason: <brief justification based on the company's core business>
```
23 allowed categories: E-commerce, Marketplaces, Fintech, Payments, Crypto / Web3, Consumer social, Media / Streaming, Gaming, On-demand / Delivery, Logistics / Mobility, Travel / Booking, SaaS (B2B), SaaS (prosumer / PLG), Developer tools / APIs, Data / AI platforms, Cybersecurity, Adtech / Martech, Ride-sharing / transportation networks, Food tech, Creator economy platforms, Market data / trading platforms, Real-time communications (chat, voice, video APIs), IoT / connected devices platforms. `Unknown` is used when information is insufficient. If Exa returns a value outside this list, the cell is left blank and the company is retried next run.
Stage 17 is batch-of-2 (batchSize: 2). Uses a structured JSON outputSchema with the enum declared so Exa is constrained to one of the allowed values. Operates on `survivorsAfterStage6`.

**Company Context Score** (Context Score State) — two-line string:
```
<score>

Reasoning: <2–4 sentences covering product nature, reliability sensitivity, industry, scale, and business model>
```
Score is one of: 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5.
Stage 18 is per-company (batchSize: 1).

**Tooling Match Score** — multi-line string:
```
Final Tool Score: <average of 4 sub-scores, e.g. 4.25>
Communication Tool Score: <0 | 3 | 5>
Competitor Tooling Score: <1 | 3 | 5>
Observability Tool Score: <1 | 3 | 4 | 5>
Cloud Tool Score: <4 | 5>

Justification:
- Communication Tool: <brief explanation, or "Not publicly confirmed">
- Competitor Tooling: <brief explanation, or "Not publicly confirmed">
- Observability Tool: <brief explanation, or "Not publicly confirmed">
- Cloud Tool: <brief explanation, or "Not publicly confirmed">
```
Final Tool Score = (Communication Tool Score + Competitor Tooling Score + Observability Tool Score + Cloud Tool Score) / 4, computed locally (not trusted from the model). Sub-score rules: Communication 5=Slack, 3=no evidence, 0=Teams; Competitor 1=any 1-pt tool (Resolve.ai/Traversal/TierZero/RunLLM/Neubird/Wildmoose/Ciroos/Komodor/Mezmo), 3=Rootly/incident.io, 5=none; Observability 1=other sole tool, 5=Datadog sole, 4=Datadog+anything or Grafana/Prometheus, 3=no evidence; Cloud 5=AWS/GCP, 4=Azure or no evidence. Uses Azure OpenAI (`gpt-5.4-pro` via `AZURE_OPENAI_DEPLOYMENT_PRO`, falls back to `AZURE_OPENAI_DEPLOYMENT`). Operates on `survivorsAfterStage6` filtered to companies where all 17 prior enrichable columns are non-empty in Attio.

**Re-run gating (hash-based):** Stage 18 re-scores only when inputs change. On each run, a sha256 hash of the 17 input cell values (concatenated slug=value pairs) is compared to the stored hash in `change_detection_column_for_developer`. If equal → skip (no OpenAI call). If different or missing → re-score and overwrite both `company_context_score` and `change_detection_column_for_developer`. Because the hash is stored in Attio (not on disk), change-detection is durable across weeks and across machines. Adding a new enrichable column upstream automatically invalidates all hashes and triggers a full re-score on the next run.

Stage 19 uses independent hash-gating via `tooling_match_change_detection_for_developer`. Its hash covers only the 4 input cells (Communication Tool, Competitor Tooling, Observability Tool, Cloud Tool) — changes to other columns do not trigger a Stage 19 re-score. The two hash columns are fully independent: re-scoring one does not affect the other.

Stage 19 is per-company (batchSize: 1). Uses Azure OpenAI (`gpt-5.4-pro` via `AZURE_OPENAI_DEPLOYMENT_PRO`, falls back to `AZURE_OPENAI_DEPLOYMENT`). Operates on `survivorsAfterStage6` filtered to companies where all 17 prior enrichable columns are non-empty. `computeInputHash` (exported from `companyContextScore.ts`) is reused.

**Intent Signal Score** — two-section string:
```
Intent Signal Score: <score>

Reasoning:
<2–4 sentences covering customer complaints, hiring, SRE maturity, incidents, and AI adoption>
```
Score is one of: 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5. If any signal data is missing, the reasoning explicitly says "Not publicly confirmed".
Stage 20 is per-company (batchSize: 1). Hash covers only the 8 intent-signal inputs via `intent_signal_change_detection_for_developer` — independent of Stages 18 and 19. Uses Azure OpenAI (`gpt-5.4-pro`). Same eligibility precondition as Stages 18/19 (all 17 prior enrichable columns non-empty).

**Final Score** — three-block string:
```
Final Score: <X.X>
Tier: Tier <1|2|3|4|5>

Reasoning:
<2–4 sentences>
```
Score computed locally: `round1(0.5 × Intent + 0.3 × Context + 0.2 × Tooling)`. Two-step rounding (2dp then 1dp) prevents floating-point drift. Tier buckets: ≥4.5→T1, ≥3.5→T2, ≥2.5→T3, ≥1.5→T4, else T5. Hard override: if Company Context Score = 0, Final Score = 0, Tier 5 (no OpenAI call). OpenAI called only for the reasoning paragraph, using `AZURE_OPENAI_DEPLOYMENT` (non-pro, unlike Stages 18–20). Hash covers only the 3 score inputs via `final_score_change_detection_for_developer`. Eligibility: all 17 base columns + 3 upstream score columns must be non-empty. Runs after Stages 18/19/20 have updated `attioCache` in the same pipeline run.

**Identity columns (Company Name, Domain, LinkedIn Page, Description)** — written once at pipeline start (before Stage 1) for every CSV row, via an "identity-write" step. Rules:
- For each CSV row, fill any of the four columns that are currently **empty** in Attio using the CSV value. Never overwrite a non-empty Attio value (preserves human edits).
- Match the Attio record by `Domain` when the CSV row has a Website, otherwise by `LinkedIn Page` (`upsertCompanyByLinkedInUrl`). Never by Company Name — name-based lookups were removed.
- `Description` comes from the CSV column `Short Description`.
- If a CSV row has **neither** a Domain nor a LinkedIn URL, skip the row entirely (no write, not added to the stage processing set).
- CSV rows with only a LinkedIn URL (no Website) are resolved against the Attio cache via LinkedIn URL lookup to obtain a domain for subsequent stages. If the Attio record doesn't exist yet, the identity-write upserts by `linkedin_page`, but the row will not participate in stages keyed by domain until a future run after Attio assigns a domain.

Stages 7–17 run on `survivorsAfterStage6` (non-gating). No `filterSurvivors` is called — the company set passes through unchanged. Stages 18, 19, and 20 all operate on `survivorsAfterStage6` with the same precondition (all 17 prior enrichable columns must be non-empty) but are independent of each other — none requires the others to have run first. Stage 21 runs after all three and additionally requires all 3 upstream score columns to be non-empty in `attioCache`.

Stages 11 and 12 share a single `runStage` invocation (one Apify call per company) whose `afterBatch` writes both Engineer Hiring and SRE Hiring columns. Cache-skip requires both slugs to be non-empty; either blank triggers a fresh call.

### Exa output schema
All structured Exa stages (Digital Native, Cloud Tool, Funding Growth, Revenue Growth, Number of Users, Industry) use Exa's `outputSchema` (object with `companies[]`), not freeform text. Parsers read `raw.output.content` as a parsed object. AI Adoption Mindset and AI SRE Maturity are the exceptions — they use `outputSchema: { type: 'text' }` and read `raw.output.content` as a string passed through verbatim.

### API mapping
- **Local match (no API)**: Competitor Tooling
- **Exa (batch of 2)**: Digital Native, Number of Users, Observability Tool, Cloud Tool, Funding Growth, Revenue Growth, Industry
- **Exa (batch of 1, per-company)**: AI adoption mindset, AI SRE maturity — uses `outputSchema: { type: 'text' }` + `additionalQueries` + `contents.highlights`; query and systemPrompt are company-specific
- **TheirStack**: Communication Tool
- **Apollo**: Number of Engineers
- **Apify (harvestapi/linkedin-company-employees)**: Number of SREs
- **Apify (fantastic-jobs/career-site-job-listing-feed)**: Engineer Hiring, SRE Hiring (single call per company feeds both columns)
- **twitterapi.io + Azure OpenAI**: Customer complains on X (paginated tweet fetch → OpenAI 4-bucket classifier)
- **Statuspage v2 (no auth)**: Recent incidents ( Official ) — probes `status.{domain}` then `{slug}.statuspage.io`, paginates 90-day window, no OpenAI
- **Azure OpenAI (gpt-5.4-pro)**: Company Context Score (Stage 18) — feeds all 17 prior Attio cell values into a single structured-JSON judge() call; hash-gated re-run; Tooling Match Score (Stage 19) — scores 4 tooling cells (Communication Tool, Competitor Tooling, Observability Tool, Cloud Tool); hash covers only those 4 inputs via `tooling_match_change_detection_for_developer`; Intent Signal Score (Stage 20) — scores 8 buying-signal cells across 3 tiers; hash covers only those 8 inputs via `intent_signal_change_detection_for_developer`
- **Azure OpenAI (gpt-5.4, non-pro)**: Final Score (Stage 21) — uses `AZURE_OPENAI_DEPLOYMENT` (not pro); formula and tier are computed locally; model called only for the reasoning paragraph; hash covers the 3 upstream score cells via `final_score_change_detection_for_developer`

## Commands
```
npm run enrich-all -- --csv ./data/input.csv --limit 10 --dry-run
npm run enrich-company -- --domain acme.com --dry-run
npm run enrich-column -- --column "Digital Native" --domain acme.com
npm run attio-smoke -- --domain kobie.com
npm run typecheck
npm run build
npm test
```

## Code Style
- Strict TypeScript: `strict: true`, `noUncheckedIndexedAccess: true`
- All imports use `.js` extension (ESM, `moduleResolution: Bundler`)
- Column names are string literals used as object keys throughout — must match Attio exactly
- Attio field slugs live in `attio.ts:FIELD_SLUGS` (code constant, not env)
- All env values read through `KEYS` (or the named exports) in `config.ts` — never access `process.env` directly elsewhere
- Enrichers all have signature `(input: EnricherInput) => Promise<string>` — return `''` if unavailable
- Outbound Exa calls must be wrapped in `scheduleExa(...)`; Attio upserts must go through `attioWriteLimit` (handled by `writeStageColumn`)
- Outbound TheirStack calls must be wrapped in `scheduleTheirstack(...)` — never call `theirstackJobsByTechnology` directly
- Outbound Apollo calls must be wrapped in `scheduleApollo(...)` — never call `apolloMixedPeopleApiSearch` directly
- Outbound Apify calls must be wrapped in `scheduleApify(...)` — never call `runHarvestLinkedInEmployees` or `runCareerSiteJobListings` directly
- Outbound twitterapi.io calls must be wrapped in `scheduleTwitterApi(...)` — never call `twitterAdvancedSearch` or `fetchComplaintTweets` directly
- Stage 18 OpenAI model lives in `KEYS.azureOpenAIDeploymentPro` (env `AZURE_OPENAI_DEPLOYMENT_PRO`); never hardcode deployment names in stage files
- Outbound Statuspage calls must be wrapped in `scheduleStatuspage(...)` — never call the Statuspage axios client directly
- TheirStack response parsing must check both `technology_slugs` and `technology_names` (exact case-insensitive equality) when filtering by technology keyword
- No comments unless the WHY is non-obvious

## Testing

**Unit tests are the primary test layer.** Integration tests are a narrow safety net covering only what unit tests cannot reach.

- **Unit tests** — one `*.test.ts` alongside each module (e.g. `src/util.ts` → `src/util.test.ts`). Cover parsers, formatters, gates, helpers, `runStage` retry/backoff, `filterSurvivors`, `writeStageColumn`, Attio HTTP shape. This is where most test coverage lives.
- **Integration / E2E tests** — `src/commands/enrichAll.e2e.test.ts` (+ helpers in `src/commands/enrichAll.e2e.helpers.ts`). Drive the full `enrichAll` pipeline with module-mocked external APIs. **Scope is intentionally narrow**: cover ONLY orchestration logic that lives inline in `enrichAll.ts` and cannot be tested by a unit test — CSV ∪ Attio merge, identity-write no-overwrite, Stage 3's hand-rolled conditional gate, Stage 10 N/A branch, Stage 11+12 union-skip filter, cache-gate wiring, one representative rejection-propagation flow, dry-run.

**Do NOT overbuild the integration suite.** Before adding a new E2E scenario, ask: *does a unit test already cover this logic in isolation?* If yes, do not add an E2E test for it. Specifically, do not add E2E tests for:
- Per-stage gate correctness (each stage has its own `.test.ts`).
- `filterSurvivors` / `runStage` / `writeStageColumn` mechanics (own unit tests).
- Multi-domain batching, retry/backoff, parse-miss, errored-drop (already unit-tested).
- Parser or formatter output shape (already unit-tested).
- Attio HTTP/pagination (already unit-tested).
One representative test for a given orchestration flow is enough — duplicating coverage across every stage is churn, not safety.

After every build or code change:
1. Write or update **unit tests** that directly cover the changed logic. This is the default. If no test file exists for the changed module, create one alongside it.
2. Only if the change touches orchestration logic inline in `enrichAll.ts` (merge, identity-write, the Stage 3 hand-rolled gate, Stage 10 N/A branch, Stage 11+12 union-skip, dry-run, or a new stage insertion) should you update or add an **E2E scenario** in `src/commands/enrichAll.e2e.test.ts`. Keep the suite narrow — update an existing scenario rather than adding a new one when possible.
3. Run the full test suite (`npm test`) — both unit tests and integration tests must pass before considering the task complete.
4. **Before any `git commit`**, re-run `npm test`. Both unit and integration tests must be green. Never commit with failing tests, and never skip tests (`--no-verify`, test exclusions) without explicit user approval.
5. Never mark a task done if any test is failing.

## Rules
- Never commit `.env` — only `.env.example`
- `ATTIO_API_KEY` and all other secrets only in `.env`, read via `KEYS` in `config.ts`
- `ATTIO_OBJECT_SLUG` defaults to `ranked_companies` in code; overridable via `.env`
- Adding a new **enrichable** Attio column requires changes in 4 places: `types.ts`, `config.ts`, `enrichers/index.ts`, `apis/attio.ts:FIELD_SLUGS`; for a gating-stage column, also add reason builders to `src/rejectionReasons.ts`. For a **non-enrichable** identity column (CSV-sourced, like `Description`), only `types.ts` (`InputRow` + `EnrichmentResult`) and `apis/attio.ts:FIELD_SLUGS` are needed — it stays out of `EnrichableColumn` / `ENRICHERS`. Also update `pipeline.ts:EnrichmentResult` literal. Note: adding any new upstream enrichable column automatically changes the hash for all companies and triggers a Stage 18 re-score on the next run — this is intentional (new signal → refreshed score). When adding a new score column (Stages 18/19/20/21 style), also update all `.filter()` exclusion clauses in `enrichAll.ts` that exclude score columns from the eligibility hash — all score columns must be excluded from each other's prior-column checks to avoid circular dependency (currently four exclusion filters: one per score stage).
- Never add business logic decisions (what counts as Digital Native, confidence thresholds, etc.) without asking the user first
- `toAttioValues` skips empty strings — enrichers must return `''` not `null`/`undefined` to avoid writing blanks to Attio
- Never call `exa.search` directly — always go through `scheduleExa()`; never call `upsertCompanyByDomain` in a tight loop without the `attioWriteLimit` gate
- Integration tests live in `src/commands/enrichAll.e2e.test.ts` — treat them as first-class alongside unit tests for running (both must pass before commit), but keep their scope narrow: orchestration-only behavior that unit tests cannot reach.
- Do not add E2E scenarios that duplicate unit-test coverage. Before adding one, confirm the logic is not already tested by a stage `.test.ts`, `filterSurvivors.test.ts`, `runStage.test.ts`, or `writeStageColumn.test.ts`.

## Keep this CLAUDE.md current
Update this file in the same change that introduces a new pattern, module, dependency, command, env var, or rule. Do not defer it. Specifically, when you:
- add a file under `src/` or a new subdirectory → update the Architecture tree
- add a dependency → update the Stack list
- add/rename/remove an `npm run` script → update the Commands block
- introduce a new concurrency/rate-limit pattern, retry policy, or external service → update the relevant section
- establish a new convention or hard rule → add it to Code Style or Rules

Keep entries terse. Remove stale entries rather than leaving them. Do not add changelog-style dated entries — this file describes current state; git log is for history.

## Compaction
When compacting, always preserve: list of modified files, any failing typecheck errors, which enricher columns have real implementations vs stubs, and which stages are wired into enrich-all vs still pending.
