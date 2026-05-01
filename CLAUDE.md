# Project
**Bacca.ai** is an AI SRE startup that sells software to high-scale digital-native platforms. This repo enriches potential customers (from a CSV) via Apify, Exa, TheirStack, twitterapi.io, Statuspage, Apollo, and Azure OpenAI, scoring each company against Bacca's ICP. Two surfaces share the same pipeline:
- **CLI (`./enrich`)** — the original automation entry point. Always writes results to the Attio custom object (`companies`).
- **Web UI (`npm run ui`, deployed to Railway)** — a one-page React app for CEO / GTM leads / GTM interns. Upload a CSV *or* enter a single company by hand (no Apollo Account ID on the manual path), watch rows fill in stage by stage, download a CSV. Always writes to Attio; already-populated columns are skipped.

## Stack
- TypeScript (strict, ESNext modules, `tsx` for direct execution at runtime — no compile step on the server)
- Node.js ≥18, ESM (`"type": "module"`)
- commander — CLI parsing
- axios — Attio REST API client
- exa-js — Exa neural search
- apify-client — Apify actor runs
- openai — Azure OpenAI SDK
- csv-parse / csv-stringify — CSV I/O
- bottleneck — QPS rate limiter; p-limit — concurrency limiter
- dotenv — env loading
- vitest — unit tests
- express + multer — HTTP server + multipart CSV upload (web UI)
- react + vite + @tanstack/react-table — frontend single-page app
- 1-second polling (no extra lib) — frontend `GET /api/runs/:id/state` keeps the UI in sync with the pipeline (replaced SSE for better resilience on flaky networks / corporate proxies / Railway)

## Architecture
```
enrich                   — bash wrapper around npm run enrich-all (the CLI surface)
src/
  index.ts               — CLI entry; registers the enrich-all command
  config.ts              — KEYS, PATHS, CONCURRENCY, ENRICHABLE_COLUMNS, all API tunable env vars (single source of truth)
  types.ts               — EnrichableColumn, EnrichmentResult, InputRow, EnricherFn, AttioRecord
  runTypes.ts            — RunEvent + RunCtx + ActivityEntry + RunStateSnapshot (shared between pipeline emit and the polling endpoint)
  rateLimit.ts           — scheduleExa/Theirstack/Apollo/Apify/TwitterApi/Statuspage + attioWriteLimit/openaiLimit
  pipeline.ts            — runPipeline (all columns) + runSingleEnricher (one column)
  csv.ts                 — readInputCsv
  util.ts                — deriveDomain, nowIso, withRetry, normalizeLinkedInUrl, linkedInSlugForAttio
  cache.ts               — disk cache helpers
  filterSurvivors.ts     — filterSurvivors (fresh gate) + filterCachedSurvivors (cached gate)
  runStage.ts            — generic stage runner: batching, concurrency, retry
  writeStageColumn.ts    — write one column to Attio for all successful stage results
  rejectionReasons.ts    — reason-string builders per gate stage (fresh + cached variants)
  writeRejectionReason.ts — crash-safe Attio writer for Reason for Rejection column
  apis/
    attio.ts             — Attio REST client: upsertCompanyByDomain, upsertCompanyByLinkedInUrl, find*
    exa.ts               — Exa search; structured JSON outputSchema for most stages; text outputSchema for Stages 15+16
    apify.ts             — runHarvestLinkedInEmployees, runCareerSiteJobListings
    openai.ts            — Azure OpenAI wrapper
    theirstack.ts        — TheirStack API
    apollo.ts            — apolloMixedPeopleApiSearch (POST /mixed_people/api_search)
    twitterapi.ts        — fetchComplaintTweets (paginated, caps at 50, 90-day window)
    statuspage.ts        — fetchRecentIncidents (probes status.{domain} then {slug}.statuspage.io)
  commands/
    enrichAll.ts         — stage-wise bulk enrichment (the only CLI command)
    enrichAll.e2e.test.ts — E2E integration tests (narrow orchestration scope)
    enrichAll.e2e.helpers.ts — makeCsv, makeExaResponse, makeExaTextResponse
  enrichers/
    index.ts             — ENRICHERS map + ENRICHABLE_COLUMN_LIST
  stages/
    types.ts             — StageCompany, StageResult<T>, GateRule<T>
    competitorTool.ts    — Stage 1  (Competitor Tooling, local+TheirStack, no gate)
    digitalNative.ts     — Stage 2  (Digital Native, Exa, gating)
    numberOfUsers.ts     — Stage 3  (Number of Users, Exa, conditional gate)
    observabilityTool.ts — Stage 4  (Observability Tool, Exa, gating)
    communicationTool.ts — Stage 5  (Communication Tool, TheirStack, gating)
    cloudTool.ts         — Stage 6  (Cloud Tool, Exa, gating)
    fundingGrowth.ts     — Stage 7  (Funding Growth, Exa)
    revenueGrowth.ts     — Stage 8  (Revenue Growth, Exa)
    numberOfEngineers.ts — Stage 9  (Number of Engineers, Apollo)
    numberOfSres.ts      — Stage 10 (Number of SREs, Apify)
    engineerHiring.ts    — Stage 11+12 (Engineer Hiring + SRE Hiring, single Apify call)
    customerComplaintsOnX.ts — Stage 13 (Customer complains on X, twitterapi.io + OpenAI)
    recentIncidents.ts   — Stage 14 (Recent incidents, Statuspage v2)
    aiAdoptionMindset.ts — Stage 15 (AI adoption mindset, Exa text, per-company)
    aiSreMaturity.ts     — Stage 16 (AI SRE maturity, Exa text, per-company)
    industry.ts          — Stage 17 (Industry, Exa, 23-category enum)
    companyContextScore.ts  — Stage 18 (Company Context Score, OpenAI pro, hash-gated)
    toolingMatchScore.ts    — Stage 19 (Tooling Match Score, OpenAI pro, hash-gated)
    intentSignalScore.ts    — Stage 20 (Intent Signal Score, OpenAI pro, hash-gated)
    finalScore.ts           — Stage 21 (Final Score, local formula + OpenAI reasoning, hash-gated)
data/input.csv             — CLI input (gitignored)
cache/                     — disk cache for API responses
tmp/                       — uploaded CSVs from the web UI (gitignored, ephemeral)

server/
  index.ts                 — Express app: POST /api/runs (multipart upload), POST /api/runs/manual (JSON single-company; materializes a one-row CSV with empty Apollo Account Id and reuses the pipeline), GET /api/runs/:id/state (polling snapshot, no-store), POST /api/runs/:id/cancel, GET /api/runs/:id/csv, GET /api/columns, GET /api/health. Hosts the 5min finished-run sweep. Serves web/dist/ as static files in production.
  runRegistry.ts           — in-memory Map<runId, { status, totalCompanies, skippedRows, currentStage, stagesCompleted, completedStageNames, recentActivity (12-entry ring), lastEventAt, surviving/rejected/errored, cancelSignal, triggerCancel, … }> + serializeRun(run) → RunStateSnapshot (cancel-aware status mapping)
  csvOutput.ts             — renderCsv(attioCache) → string in CSV_COLUMN_ORDER
  columns.ts               — CSV_COLUMN_ORDER, CSV_COLUMNS (display+slug), STAGE_COLUMNS, IDENTITY_COLUMNS, DEVELOPER_COLUMNS

web/
  index.html, vite.config.ts, tsconfig.json
  src/
    main.tsx, App.tsx, App.css   — single-page shell
    components/
      ControlDeck.{tsx,css}      — Mode toggle (CSV upload / Single company) + per-mode field set + Account Purpose + Start button. Manual mode shows a warning that the in-house Outreach Automation tool needs an Apollo Account ID and will skip manually-entered companies.
      RunStatus.{tsx,css}        — stage indicator + progress bar + Download CSV button + Cancel button
      SkippedPanel.{tsx,css}     — collapsible list of CSV rows skipped at preflight (no website)
      ActivityFeed.{tsx,css}     — rolling feed of recent cell-update / rejection events + heartbeat indicator (proves the run is alive). Replaced the old LiveTable.
    lib/
      runTypes.ts                — frontend mirror of src/runTypes.ts (ActivityEntry + RunStateSnapshot — only the polling-consumed parts)
      useRunStream.ts            — 1-second polling hook (`GET /api/runs/:id/state`); stops on terminal status; optimistic 'cancelling' hold prevents flicker
      columns.ts                 — mirror of server/columns.ts (CSV_COLUMN_ORDER, COLUMN_WIDTHS, STAGE_COLUMNS)
    styles/
      global.css                 — CSS variables (dark theme), film-grain overlay, animations
  dist/                          — vite build output (gitignored)

railway.json                  — Railway deploy config: nixpacks build, npm start, /api/health
```

## Stage-wise pipeline (enrich-all)

Flow: load CSV → pre-fetch Attio records **only for CSV domains** → Stage 1 → write → filter survivors → Stage 2 → … → write final results. Processing set = CSV companies only; Attio records for companies outside the CSV are never enriched (even partially-populated ones). Resume semantics: any CSV company whose target column is already populated in Attio is skipped for that stage.

### Stage order and gates

| # | Column | API | Gate (pass condition) |
|---|---|---|---|
| 1 | Competitor Tooling | local + TheirStack | no gate |
| 2 | Digital Native | Exa | category ≠ `NOT Digital-native or digitally critical` |
| 3 | Number of Users | Exa | Digital-native B2B + Digitally critical B2B: `user_count_bucket` must be `100K+`; other categories / unknown / errors pass |
| 4 | Observability Tool | Exa | no evidence OR Datadog / Grafana / Prometheus |
| 5 | Communication Tool | TheirStack | no evidence OR Slack (reject if MS Teams) |
| 6 | Cloud Tool | Exa | no evidence OR AWS / GCP (reject other clouds) |
| 7 | Funding Growth | Exa | no gate |
| 8 | Revenue Growth | Exa | no gate |
| 9 | Number of Engineers | Apollo | no gate |
| 10 | Number of SREs | Apify | no gate |
| 11 | Engineer Hiring | Apify | no gate |
| 12 | SRE Hiring | Apify (same call as 11) | no gate |
| 13 | Customer complains on X | twitterapi.io + OpenAI | no gate |
| 14 | Recent incidents ( Official ) | Statuspage v2 | no gate |
| 15 | AI adoption mindset | Exa | no gate |
| 16 | AI SRE maturity | Exa (shortcut: skipped when Competitor Tooling is non-empty) | no gate |
| 17 | Industry | Exa | no gate |
| 18 | Company Context Score | OpenAI pro | no gate |
| 19 | Tooling Match Score | OpenAI pro | no gate |
| 20 | Intent Signal Score | OpenAI pro | no gate |
| 21 | Final Score | local formula + OpenAI | no gate |

### Key orchestration rules
- **Stages 2–6 are gating.** Rejected companies are written to Attio then dropped. Reason for Rejection format: `"<Stage name>: <specific reason>"`. Errored companies are retried on the next run.
- **Stage 1 is not a gating stage** — all companies continue to Stage 2 regardless.
- **cacheGate:** cached Attio values must also pass the gate. When editing a formatter, update its `cacheGate` in the same change.
- **Stages 7–17** run on `survivorsAfterStage6` with no filtering.
- **Stage 16 shortcut:** when Competitor Tooling is non-empty and not `"Not using any competitor tools"`, AI SRE maturity is set to `"Working with vendor: <tools>\n\n<evidence>"` without calling Exa. Blank Competitor Tooling → falls through to Exa as normal.
- **Stages 11+12** share one Apify call; cache-skip requires both slugs non-empty.
- **Stages 18/19/20** all operate on `survivorsAfterStage6` filtered to companies where all 17 prior enrichable columns are non-empty. Independent of each other.
- **Stage 21** additionally requires all 3 upstream score columns non-empty; runs after 18/19/20.
- **Identity-write** runs before Stage 1: fills empty Attio columns from CSV (never overwrites). Match by Domain only.
- **Preflight** runs before identity-write: scans the CSV (after `--limit` is applied), reports rows that will be skipped — a row needs **both** `Website` and `Company Linkedin Url` to be processed; rows missing either (or both) are dropped with a reason ("Missing Website (no domain available)", "Missing LinkedIn URL", or "Missing Website and LinkedIn URL"). Skip reasons are emitted on the `run-started` event so the web UI can show them in the SkippedPanel. Then waits 3 seconds for Ctrl-C before any Attio writes happen. Tests bypass via the internal `skipConfirm` option.

See `docs/formats.md` for per-column Attio value formats, hash-gating details, and API mapping.

## Commands

CLI (always writes to Attio):
```
./enrich                                # process every row in ./data/input.csv
./enrich "Q1 2026 ABM"                  # tag every CSV-sourced row with this Account Purpose
./enrich --limit 5                      # 5-row test run

# Underlying npm command (escape hatch — custom CSV path, scripted invocation, etc.):
npm run enrich-all -- --csv <path> [--limit N] [--account-purpose "..."]
```

Web UI (always writes to Attio):
```
npm run ui                              # dev: Vite (5173) + Express (3001) concurrently; open http://localhost:5173
npm run server:dev                      # server alone (tsx watch)
npm run web:dev                         # frontend alone
npm run build                           # vite build → web/dist/ (frontend only; server runs via tsx)
npm start                               # production: tsx server/index.ts, serves web/dist/ + /api on $PORT
```

Dev:
```
npm run typecheck                       # tsc --noEmit on src/ + server/
cd web && npx tsc --noEmit              # frontend typecheck
npm test                                # vitest
```

## Web UI ↔ pipeline contract
- POST /api/runs takes a multipart CSV plus `accountPurpose` (string, optional). The server saves the CSV to `UPLOAD_DIR/<uuid>`, returns `{ runId }`, and kicks off `enrichAll` immediately. Every run always writes to Attio.
- POST /api/runs/manual takes JSON `{ companyName, website, linkedinUrl, description?, accountPurpose? }`. Required fields are companyName/website/linkedinUrl; description is optional but recommended for scoring accuracy. The server materializes a one-row CSV (with `Apollo Account Id` empty) at `UPLOAD_DIR/manual-<uuid>.csv` and reuses `startRunAsync` — same pipeline, same events, same download.
- `enrichAll` accepts a `RunCtx { emit, isCancelled, cancelSignal }`. The pipeline always prefetches existing Attio records for the CSV's domains, so columns already populated in Attio are skipped (resume semantics). The prefetch is narrowed to the CSV's domains so Attio records outside the CSV never enter the cache. Cancel races every API await against `cancelSignal` so in-flight HTTP calls stop blocking the pipeline.
- After Attio prefetch, `enrichAll` walks `attioCache` and emits a `cell-updated` event for every non-empty cell so the activity feed fully rehydrates from frame one.
- Pipeline events are consumed server-side: each `RunEvent` updates the run's `RunRecord` (current stage, ring buffer of recent activity, terminal counts). The frontend polls `GET /api/runs/:id/state` every second; the server returns a `RunStateSnapshot` with `Cache-Control: no-store`. The polling hook stops on terminal status (`completed` / `cancelled` / `failed`).
- The downloadable CSV (`GET /api/runs/:id/csv`) is served from the in-memory `attioCache`, ordered by `CSV_COLUMN_ORDER` (see `server/columns.ts`).

## Deployment (Railway)
- One container: Express on `process.env.PORT` serves `web/dist/` AND `/api/*`.
- Build: `npm ci && npm run build` (vite build only — no server compile, runtime uses tsx).
- Start: `npm start` (tsx server/index.ts).
- Health: `/api/health`.
- All existing pipeline env vars must be set in Railway (ATTIO_API_KEY, EXA_API_KEY, …). The `cache/` directory is ephemeral (perf cache only).
- **Persistent volume (optional):** mount at `/data` and set `UPLOAD_DIR=/data/uploads` so uploaded CSVs survive redeploys. Without it, uploads are wiped on every redeploy — the pipeline still works, but a mid-run redeploy loses the source CSV.

## Code Style
- Strict TypeScript: `strict: true`, `noUncheckedIndexedAccess: true`
- All imports use `.js` extension (ESM, `moduleResolution: Bundler`)
- Column names are string literals — must match Attio exactly
- Attio field slugs live in `attio.ts:FIELD_SLUGS` (never hardcode elsewhere)
- All env values read through `KEYS` in `config.ts` (server reads `process.env.PORT` and `NODE_ENV` directly — those are server-runtime, not pipeline config)
- Enrichers: `(input: EnricherInput) => Promise<string>` — return `''` if unavailable
- All outbound API calls must use their scheduler wrapper: `scheduleExa()`, `scheduleTheirstack()`, `scheduleApollo()`, `scheduleApify()`, `scheduleTwitterApi()`, `scheduleStatuspage()` — never call the underlying client directly
- Attio upserts must go through `attioWriteLimit` (handled by `writeStageColumn`)
- Azure OpenAI deployment for Stages 18/19/20 lives in `KEYS.azureOpenAIDeploymentPro` — never hardcode deployment names in stage files
- TheirStack response parsing must check both `technology_slugs` and `technology_names` against machine-readable slug strings — both fields return slugs, never human-readable display names
- No comments unless the WHY is non-obvious
- The CSV column order in `server/columns.ts` is mirrored verbatim in `web/src/lib/columns.ts`. When changing one, update the other in the same commit.

## Testing
Unit tests are the primary layer — one `*.test.ts` alongside each module. E2E tests in `enrichAll.e2e.test.ts` cover orchestration-only logic. Keep the E2E suite narrow: don't duplicate what unit tests already cover.

See `docs/testing.md` for full rules, scope boundaries, and the commit workflow.

## Clarifying Questions
When the prompt is vague and you are unsure, ask before building. Wrong work in this repo costs API credits, Attio writes against real customer data, and review cycles — a clarifying question is always cheaper. Always ask when: scope is unclear (which stage, which column, which API), the user references something ambiguously ("the score thing", "fix the gate"), key inputs are missing (column name, gate condition, target value format), or a business-logic decision is required (gate thresholds, scoring weights, what counts as a survivor, column semantics). Do not ask for trivial implementation choices that the existing code style already answers. Bundle multiple questions into one message; offer 2–3 likely interpretations as multiple choice when you can. If you realize mid-execution that you are unsure, stop and ask — do not pick a "reasonable default" for anything that touches enrichment behavior, gating, scoring, or Attio writes.

## Rules
- Never commit `.env` — only `.env.example`
- All secrets in `.env`, read via `KEYS` in `config.ts`
- The Attio object slug (`companies`) is hardcoded as `ATTIO_OBJECT_SLUG` in `src/apis/attio.ts` — not env-driven, since the slug names in `FIELD_SLUGS` are tightly coupled to that specific object's schema
- Adding a new enrichable column requires changes in 4 places: `types.ts`, `config.ts`, `enrichers/index.ts`, `attio.ts:FIELD_SLUGS` — see `docs/adding-columns.md` for full checklist including score columns and circular dependency exclusions
- Never make business logic decisions without asking the user first
- When the prompt is vague or you are unsure what the user wants, ask before building (see Clarifying Questions section above)
- `toAttioValues` skips empty strings — enrichers must return `''` not `null`/`undefined`

## Detailed docs
- Attio column output formats, hash-gating, API mapping → `docs/formats.md`
- Rate limiter wrappers, runStage mechanics, env var tunables → `docs/rate-limits.md`
- Testing scope rules and commit workflow → `docs/testing.md`
- Adding columns checklist (enrichable, identity, score, stage wiring) → `docs/adding-columns.md`

## Keep this CLAUDE.md current
Update in the same change that introduces a new pattern, module, dependency, command, env var, or rule. Keep entries terse; remove stale ones; no changelog entries.

When a change affects content that lives in a `docs/` file (column formats, rate-limit tunables, testing rules, adding-columns checklist), edit that `docs/` file — do NOT duplicate or re-describe it in CLAUDE.md. CLAUDE.md only holds a pointer to the doc.

## Compaction
When compacting, always preserve: list of modified files, any failing typecheck errors, which enricher columns have real implementations vs stubs, and which stages are wired into enrich-all vs still pending.
