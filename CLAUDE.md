# Project
CLI script that enriches B2B company data (from a CSV) via Apify, Exa, TheirStack, and Azure OpenAI, then writes results to an Attio custom object (`ranked_companies`).

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
    exa.ts          — Exa search calls (digitalNativeExaSearch)
    apify.ts        — Apify actor helpers
    openai.ts       — Azure OpenAI wrapper
    theirstack.ts   — TheirStack API
  commands/
    enrichAll.ts    — bulk enrich all CSV rows → Attio
    enrichCompany.ts — enrich one company by domain
    enrichColumn.ts — overwrite one column for one company
    attioSmoke.ts   — smoke test: upsert Company Name + Domain only
  enrichers/
    index.ts        — ENRICHERS map (EnrichableColumn → EnricherFn) + ENRICHABLE_COLUMN_LIST
data/input.csv      — input (gitignored)
cache/              — disk cache for API responses
```

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

## Rules
- Never commit `.env` — only `.env.example`
- `ATTIO_API_KEY` and all other secrets only in `.env`, read via `KEYS` in `config.ts`
- `ATTIO_OBJECT_SLUG` defaults to `ranked_companies` in code; overridable via `.env`
- Adding a new Attio column requires changes in 4 places: `types.ts`, `config.ts`, `enrichers/index.ts`, `apis/attio.ts:FIELD_SLUGS`
- Never add business logic decisions (what counts as Digital Native, confidence thresholds, etc.) without asking the user first
- `toAttioValues` skips empty strings — enrichers must return `''` not `null`/`undefined` to avoid writing blanks to Attio

## Compaction
When compacting, always preserve: list of modified files, any failing typecheck errors, and which enricher columns have real implementations vs stubs.
