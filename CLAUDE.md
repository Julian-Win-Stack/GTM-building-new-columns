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
- p-limit — concurrency control
- dotenv — env loading

## Architecture
```
src/
  index.ts          — CLI entry: registers all commands via commander
  config.ts         — KEYS, PATHS, CONCURRENCY, ENRICHABLE_COLUMNS (single source of truth)
  types.ts          — EnrichableColumn, EnrichmentResult, InputRow, EnricherFn, AttioRecord
  pipeline.ts       — runPipeline (all columns) + runSingleEnricher (one column)
  csv.ts            — readInputCsv
  util.ts           — deriveDomain, nowIso, withRetry
  cache.ts          — disk cache helpers
  apis/
    attio.ts        — Attio REST client: find/create/update/upsertCompanyByDomain
    exa.ts          — Exa search calls; ExaSearchResponse type
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
    runStage.ts     — generic batched stage runner (sequential, per-batch error isolation)
    writeStageColumn.ts — write one column to Attio for all successful stage results
    filterSurvivors.ts  — apply gate, log passed/rejected/errored counts
    digitalNative.ts    — Stage 1: parser, gate, Attio formatter
data/input.csv      — input (gitignored)
cache/              — disk cache for API responses
```

## Stage-wise pipeline (enrich-all)

`enrich-all` processes all companies stage-by-stage (not row-by-row), to preserve Exa's batch-of-2 cost efficiency.

Flow: load CSV → Stage 1 (all companies) → write results → filter survivors → Stage 2 (survivors only) → … → write final results.

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

Multi-line string stored in the column cell:
```
<category or tool name returned by Exa>
Confidence: <High | Medium | Low>
Reasoning: <Exa's reason text>
```

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
```

## Code Style
- Strict TypeScript: `strict: true`, `noUncheckedIndexedAccess: true`
- All imports use `.js` extension (ESM, `moduleResolution: Bundler`)
- Column names are string literals used as object keys throughout — must match Attio exactly
- Attio field slugs live in `attio.ts:FIELD_SLUGS` (code constant, not env)
- All env values read through `KEYS` in `config.ts` — never access `process.env` directly elsewhere
- Enrichers all have signature `(input: EnricherInput) => Promise<string>` — return `''` if unavailable
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

## Compaction
When compacting, always preserve: list of modified files, any failing typecheck errors, which enricher columns have real implementations vs stubs, and which stages are wired into enrich-all vs still pending.
