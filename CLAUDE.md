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
- bottleneck — token-bucket rate limiter (Exa QPS)
- p-limit — concurrency limiter (Attio writes)
- dotenv — env loading
- vitest — unit tests

## Architecture
```
src/
  index.ts          — CLI entry: registers all commands via commander
  config.ts         — KEYS, PATHS, CONCURRENCY, ENRICHABLE_COLUMNS, EXA_QPS, EXA_RETRY_*, ATTIO_WRITE_CONCURRENCY (single source of truth)
  types.ts          — EnrichableColumn, EnrichmentResult, InputRow, EnricherFn, AttioRecord
  rateLimit.ts      — Bottleneck instance for Exa (QPS-paced) + p-limit for Attio writes; exports scheduleExa + attioWriteLimit
  pipeline.ts       — runPipeline (all columns) + runSingleEnricher (one column)
  csv.ts            — readInputCsv
  util.ts           — deriveDomain, nowIso, withRetry
  cache.ts          — disk cache helpers
  apis/
    attio.ts        — Attio REST client: find/create/update/upsertCompanyByDomain
    exa.ts          — Exa search calls; ExaSearchResponse type; digitalNativeExaSearch uses structured JSON output schema
    apify.ts        — Apify actor helpers
    openai.ts       — Azure OpenAI wrapper
    theirstack.ts   — TheirStack API
  commands/
    enrichAll.ts    — stage-wise bulk enrichment: Stage 1 → write → filter → Stage 2 → …
    enrichCompany.ts — enrich one company by domain (row-wise, uses pipeline.ts)
    enrichColumn.ts — overwrite one column for one company
    attioSmoke.ts   — smoke test: upsert Company Name + Domain only
  enrichers/
    index.ts        — ENRICHERS map (EnrichableColumn → EnricherFn) + ENRICHABLE_COLUMN_LIST
  stages/
    types.ts        — StageCompany, StageResult<T>, GateRule<T>
    runStage.ts     — generic stage runner: batches concurrent via Promise.all, per-batch retry with exponential backoff (1s→4s→16s), afterBatch fires as soon as each batch resolves
    writeStageColumn.ts — write one column to Attio for all successful stage results; bounded by attioWriteLimit; logs and swallows per-row failures
    filterSurvivors.ts  — apply gate, log passed/rejected/errored counts
    digitalNative.ts    — Stage 1: parser (structured JSON), gate, Attio formatter
data/input.csv      — input (gitignored)
cache/              — disk cache for API responses
```

## Concurrency & rate limits
All outbound Exa calls must go through `scheduleExa()` in `rateLimit.ts`. It wraps Bottleneck and enforces Exa's 10 QPS ceiling with safety headroom (default 8 QPS). Attio writes go through `attioWriteLimit` (default `p-limit(5)`).

`runStage` fires all batches concurrently — back-pressure comes from the Exa limiter, not from sequential looping. Each batch:
1. Calls `call()` (rate-limited by Bottleneck).
2. Retries on failure with exponential backoff (`EXA_RETRY_TRIES` attempts, base `EXA_RETRY_BASE_MS`, factor 4 → 1s, 4s, 16s). Retries are per-batch and do not block other batches.
3. On terminal failure, yields `{company, error}` results for that batch and moves on.
4. `afterBatch` (usually Attio writes) fires as soon as the batch resolves, independently of other batches. afterBatch errors are logged and swallowed — they never abort the stage.

Tunables in `.env`:
- `EXA_QPS` (default 8) — Exa calls per second
- `EXA_RETRY_TRIES` (default 3)
- `EXA_RETRY_BASE_MS` (default 1000)
- `ATTIO_WRITE_CONCURRENCY` (default 5) — max in-flight Attio upserts

## Stage-wise pipeline (enrich-all)

`enrich-all` processes all companies stage-by-stage (not row-by-row), to preserve Exa's batch-of-2 cost efficiency.

Flow: load CSV → pre-fetch Attio records (so already-filled companies can be skipped per-stage) → Stage 1 (all companies, concurrent within Exa QPS) → Attio write per batch as results arrive → filter survivors → Stage 2 (survivors only) → … → write final results.

No on-disk progress ledger. Resume semantics come from the Attio pre-fetch: on startup, any company whose target column is already populated is skipped for that stage.

### Stage order and gating rules

| # | Column | API | Gate (pass condition) |
|---|---|---|---|
| 1 | Digital Native | Exa | category is NOT `NOT Digital-native` AND NOT `Digital-native B2B` |
| 2 | Observability Tool | Exa | no tool evidence OR at least one of: Datadog, Grafana, Prometheus |
| 3 | Communication Tool | TheirStack | no evidence OR uses Slack (reject if Microsoft Teams / Microsoft) |
| 4 | Competitor Tooling | Exa | NOT using any of: Resolve.ai, Rootly, Incident.io, FireHydrant, PagerDuty, Opsgenie, xMatters, Splunk On-Call, BigPanda, Moogsoft |
| 5 | Cloud Tool | Exa | no evidence OR uses AWS OR GCP |
| 6–16 | remaining columns | various | no gate — data collection only |

Stages 1–5 are gating stages. Companies rejected at any gate are written to Attio with whatever columns were filled so far, then dropped from further processing.

### Attio value format for Exa-based stages

Multi-line string stored in the column cell (blank lines between sections):
```
<category or tool name returned by Exa>

Confidence: <High | Medium | Low>

Reasoning: <Exa's reason text>
```

### Exa output schema
Digital Native uses Exa's structured `outputSchema` (object with `companies[]`), not freeform text. Parser lives in `stages/digitalNative.ts` and reads `raw.output.content` as a parsed object. New Exa stages should follow the same pattern — prefer structured schemas over text parsing.

### API mapping
- **Exa (batch of 2)**: Digital Native, Observability Tool, Competitor Tooling, Cloud Tool, Funding Growth, Revenue Growth, Number of Users
- **TheirStack**: Communication Tool
- **TBD**: Number of Engineers, Number of SREs, Engineer Hiring, SRE Hiring, Customer complains on X, Recent incidents ( Official ), AI adoption mindset, AI SRE maturity

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
- Adding a new Attio column requires changes in 4 places: `types.ts`, `config.ts`, `enrichers/index.ts`, `apis/attio.ts:FIELD_SLUGS`
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
