# Project
CLI script that enriches the companies data (from a CSV) via Apify, Exa, TheirStack, and Azure OpenAI, then writes results to an Attio custom object (`ranked_companies`).

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
    enrichAll.ts    — stage-wise bulk enrichment: Stage 1 → write → filter → Stage 2 → …
    enrichCompany.ts — enrich one company by domain (row-wise, uses pipeline.ts)
    enrichColumn.ts — overwrite one column for one company
    attioSmoke.ts   — smoke test: upsert Company Name + Domain only
  enrichers/
    index.ts        — ENRICHERS map (EnrichableColumn → EnricherFn) + ENRICHABLE_COLUMN_LIST
  stages/
    types.ts        — StageCompany, StageResult<T>, GateRule<T>
    competitorTool.ts   — Stage 1: local company-name match against known customer lists, gate (reject if any match), Attio formatter (comma-joined tool names or "Not using any competitor tools")
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

## Stage-wise pipeline (enrich-all)

`enrich-all` processes all companies stage-by-stage (not row-by-row), to preserve Exa's batch-of-2 cost efficiency.

Flow: load CSV → pre-fetch ALL Attio records (unfiltered) → merge: processing set = CSV companies ∪ any Attio record with empty `Reason for Rejection` → Stage 1 → Attio write per batch as results arrive → filter survivors → Stage 2 → … → write final results.

The processing set includes Attio records that are no longer in the current CSV, as long as they have not been rejected at any gate. Attio records whose `Reason for Rejection` column is filled are excluded (stay as-is). For Attio-only companies, the company name and LinkedIn URL come from the Attio record itself.

No on-disk progress ledger. Resume semantics come from the Attio pre-fetch: on startup, any company whose target column is already populated is skipped for that stage.

Cached Attio values must still pass the stage's gate — otherwise a company rejected on a prior run would resurface on re-run. Each gating stage exports a `<stage>CacheGate(cached: string): boolean` alongside its regular gate; `filterCachedSurvivors` (in `filterSurvivors.ts`) applies it to the `done` pool before merging into the survivor set. When editing a stage's formatter, update its cacheGate in the same change so they stay in sync.

### Stage order and gating rules

| # | Column | API | Gate (pass condition) |
|---|---|---|---|
| 1 | Competitor Tooling | *local match* | company name NOT in any competitor-tool customer list (Resolve.ai, Rootly, Incident.io, FireHydrant, PagerDuty, Opsgenie, xMatters, Splunk On-Call, BigPanda, Moogsoft) |
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

Stages 1–6 are gating stages. Companies rejected at any gate are written to Attio with whatever columns were filled so far, then dropped from further processing. Immediately after each gate, rejected companies receive a `Reason for Rejection` value written to Attio (crash-safe, via `writeRejectionReasons` in `src/writeRejectionReason.ts`). The reason format is `"<Stage name>: <specific reason>"` (e.g. `"Cloud Tool: uses Azure (not AWS/GCP)"`). Errored companies (fetch/parse failure) are not written — they will be retried on the next run.

Stage 1 (Competitor Tooling) is purely local — no API call, no rate limit. Matching is case-insensitive exact match on the trimmed CSV company name against the per-tool customer lists in `src/stages/competitorTool.ts:COMPETITOR_TOOLS`. To update the list, edit that constant directly.

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

**Competitor Tooling** — comma-joined competitor tool names when the CSV company matches a known customer list, or a literal string otherwise:
```
Rootly
```
or (multiple matches):
```
Splunk On-Call, BigPanda
```
or (no match, passed):
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

**Identity columns (Company Name, Domain, LinkedIn Page, Description)** — written once at pipeline start (before Stage 1) for every CSV row, via an "identity-write" step. Rules:
- For each CSV row, fill any of the four columns that are currently **empty** in Attio using the CSV value. Never overwrite a non-empty Attio value (preserves human edits).
- Match the Attio record by `Domain` when the CSV row has a Website, otherwise by `LinkedIn Page` (`upsertCompanyByLinkedInUrl`). Never by Company Name — name-based lookups were removed.
- `Description` comes from the CSV column `Short Description`.
- If a CSV row has **neither** a Domain nor a LinkedIn URL, skip the row entirely (no write, not added to the stage processing set).
- CSV rows with only a LinkedIn URL (no Website) are resolved against the Attio cache via LinkedIn URL lookup to obtain a domain for subsequent stages. If the Attio record doesn't exist yet, the identity-write upserts by `linkedin_page`, but the row will not participate in stages keyed by domain until a future run after Attio assigns a domain.

Stages 7–17 run on `survivorsAfterStage6` (non-gating). No `filterSurvivors` is called — the company set passes through unchanged.

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
- Outbound Statuspage calls must be wrapped in `scheduleStatuspage(...)` — never call the Statuspage axios client directly
- No comments unless the WHY is non-obvious

## Testing
After every build or code change:
1. Write unit tests (or update existing ones) that directly cover the changed logic.
2. Run the full test suite and ensure all tests pass before considering the task complete.
3. Use `npm test` to run all tests. If no test file exists for the changed module, create one alongside it (e.g. `src/util.ts` → `src/util.test.ts`).
4. Never mark a task done if any test is failing.

## Rules
- Never commit `.env` — only `.env.example`
- `ATTIO_API_KEY` and all other secrets only in `.env`, read via `KEYS` in `config.ts`
- `ATTIO_OBJECT_SLUG` defaults to `ranked_companies` in code; overridable via `.env`
- Adding a new **enrichable** Attio column requires changes in 4 places: `types.ts`, `config.ts`, `enrichers/index.ts`, `apis/attio.ts:FIELD_SLUGS`; for a gating-stage column, also add reason builders to `src/rejectionReasons.ts`. For a **non-enrichable** identity column (CSV-sourced, like `Description`), only `types.ts` (`InputRow` + `EnrichmentResult`) and `apis/attio.ts:FIELD_SLUGS` are needed — it stays out of `EnrichableColumn` / `ENRICHERS`.
- Never add business logic decisions (what counts as Digital Native, confidence thresholds, etc.) without asking the user first
- `toAttioValues` skips empty strings — enrichers must return `''` not `null`/`undefined` to avoid writing blanks to Attio
- Never call `exa.search` directly — always go through `scheduleExa()`; never call `upsertCompanyByDomain` in a tight loop without the `attioWriteLimit` gate

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
