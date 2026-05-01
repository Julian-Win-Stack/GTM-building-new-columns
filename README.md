# GTM Company Enrichment

Bacca.ai's GTM enrichment pipeline. Two surfaces share the same pipeline:

- **CLI (`./enrich`)** — for the operator running batch jobs from a CSV. Always writes results to Attio.
- **Web UI (`npm run ui`, deployed to Railway)** — for GTM team. Upload a CSV or enter a single company, watch rows fill in stage by stage, download the result. Always writes to Attio; already-populated columns are skipped.

Both call Apify, Exa, TheirStack, Azure OpenAI, Apollo, twitterapi.io, and Statuspage; both run the same 21-stage scoring pipeline; both write results to the Attio custom object `companies`.

---

## Quick start

### CLI

```bash
git clone <repo>
cd "GTM building new columns script"
npm install
cp .env.example .env        # fill in all API keys before running
```

Place your company list at `./data/input.csv` (see [Input CSV format](#input-csv-format) below), then:

```bash
./enrich --limit 5          # 5-row test run — safe to run repeatedly
```

### Web UI

```bash
npm install
npm run ui                  # Vite (5173) + Express (3001) running concurrently
```

Then open [http://localhost:5173](http://localhost:5173), drop a CSV onto the upload zone and hit Start.

---

## Prerequisites

- **Node.js ≥ 18** and npm (same for CLI and web UI — no extra tooling for the UI).
- **Attio workspace** with the `companies` custom object. Every column written by this tool must exist in Attio with the exact slug listed in `src/apis/attio.ts:FIELD_SLUGS`. If a column is missing, the upsert silently drops that field.
- **API keys** for all seven providers (listed in `.env.example`):
  - Attio
  - Apify
  - Exa
  - TheirStack
  - Apollo
  - twitterapi.io (`X_API_KEYS` — comma-separated for multi-key throughput)
  - Azure OpenAI — two deployments required: a standard model (Stages 1–17) and a "pro" model (Stages 18–21)

---

## Input CSV format

Path: `./data/input.csv` (CLI) or whatever the user uploads (web UI).

Column names are **case-sensitive and must match exactly**:

| Column | Notes |
|---|---|
| `Company Name` | Required. Display name written to Attio. |
| `Website` | Required. The pipeline derives the canonical domain from this. |
| `Company Linkedin Url` | Optional. Written verbatim to Attio's `LinkedIn Page` field. |
| `Short Description` | Optional. Written to Attio's `Description` field. |

Rows with no `Website` are skipped at preflight (LinkedIn-only rows fall out here). The preflight reports them before any API calls happen.

---

## Running it

### CLI

```bash
./enrich                            # full run — all rows in data/input.csv
./enrich "Q1 2026 ABM"              # same, but tag every CSV row with this Account Purpose
./enrich --limit 5                  # 5-row test run
./enrich "Q1 2026 ABM" --limit 5    # 5-row run with Account Purpose tag
```

The `./enrich` wrapper always reads from `./data/input.csv`. If you need a different CSV path or are scripting this:

```bash
npm run enrich-all -- --csv <path> [--limit N] [--account-purpose "..."]
```

**What happens when you run it:**

1. **Banner** — prints the CSV path, account-purpose tag (or "(none)"), and row limit.
2. **Preflight** — scans the CSV and lists any rows that will be skipped (no Website). If all rows are usable, it says so explicitly.
3. **3-second countdown** — hit Ctrl-C here if anything in the preflight looks wrong. No Attio writes have happened yet.
4. **Identity write** — fills empty Attio columns from CSV (Company Name, Domain, LinkedIn Page, Description, Website, Account Purpose). Never overwrites an existing non-empty value.
5. **Stages 1–21** — run in order. Each stage writes one column per company to Attio as it completes.

The CLI always writes to Attio — there is no dry-run flag.

### Web UI

```bash
npm run ui                          # dev: Vite (5173) + Express (3001) concurrently
npm run server:dev                  # server alone (tsx watch on 3001)
npm run web:dev                     # frontend alone (Vite on 5173)
```

The web UI gives non-technical users a forgiving path through the same pipeline:

- **Upload** — drag a CSV onto the upload zone (or switch to Single company mode and fill in the fields). The server saves the input and assigns a run ID.
- **Account Purpose** — a free-text field that tags every CSV-sourced row in Attio.
- **Always writes to Attio** — every enriched cell upserts into Attio in real time. Already-populated columns are skipped, so previously enriched companies pick up where they left off.
- **Activity feed** — a rolling feed of cell-update and rejection events as the pipeline runs. The polling endpoint refreshes state every second and a heartbeat indicator confirms the run is alive.
- **Download CSV** — at any point during or after the run.
- **Cancel** — stops the run; in-flight API calls race against the cancel signal so the UI doesn't block.

---

## How it works

### Input set

The processing set is **always the CSV (or single-company input) only.** The pipeline pre-fetches the matching Attio record for each CSV domain so it can skip stages whose target columns are already populated — but Attio records whose domain is *not* in the current CSV are ignored. Re-enriching an old company means re-including it in the CSV.

### 21-stage pipeline

Stages run in a fixed order. Each stage writes one column to Attio and emits a cell-update event to the UI.

**Stages 2–6 are gating.** A company that fails a gate (e.g. scored as not digital-native at Stage 2, or found to use Microsoft Teams instead of Slack at Stage 5) receives a `Reason for Rejection` entry and is dropped from all subsequent stages. Stage 1 is not gating — every company continues to Stage 2 regardless.

**Stages 18–21 are scoring.** After signal collection is complete, three score columns (Company Context Score, Tooling Match Score, Intent Signal Score) and a Final Score are computed via Azure OpenAI's "pro" deployment. These stages are hash-gated: the model is only called when upstream inputs have changed since the last run.

The full stage table, gate rules, and Exa/TheirStack API mapping are in [`CLAUDE.md`](CLAUDE.md).

### Resume semantics

Every stage skips a company whose target column is already non-empty. This makes re-runs safe and cheap — crash, fix, re-run, and only the failed companies are retried.

### Rate limiting and caching

Every outbound API call goes through a per-provider scheduler (`src/rateLimit.ts`) and an on-disk cache (`cache/`, gitignored). QPS limits and retry parameters are tunable via env vars — see [`docs/rate-limits.md`](docs/rate-limits.md).

---

## Configuration

Copy `.env.example` to `.env` and fill in all values. `.env` is gitignored and must never be committed.

| Group | Environment variables |
|---|---|
| Attio | `ATTIO_API_KEY` |
| Apify | `APIFY_TOKEN`, `APIFY_CONCURRENCY`, `APIFY_RETRY_TRIES`, `APIFY_RETRY_BASE_MS` |
| Exa | `EXA_API_KEY`, `EXA_QPS`, `EXA_RETRY_TRIES`, `EXA_RETRY_BASE_MS` |
| TheirStack | `THEIRSTACK_API_KEY`, `THEIRSTACK_QPS`, `THEIRSTACK_RETRY_TRIES`, `THEIRSTACK_RETRY_BASE_MS` |
| Apollo | `APOLLO_API_KEY`, `APOLLO_QPS`, `APOLLO_RETRY_TRIES`, `APOLLO_RETRY_BASE_MS` |
| twitterapi.io | `X_API_KEYS` (or `X_API_KEY` for a single key), `TWITTER_API_QPS`, `TWITTER_API_RETRY_TRIES`, `TWITTER_API_RETRY_BASE_MS` |
| Statuspage | `STATUSPAGE_CONCURRENCY`, `STATUSPAGE_RETRY_TRIES`, `STATUSPAGE_RETRY_BASE_MS` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`, `OPENAI_CONCURRENCY` (deployment names are hardcoded in `src/apis/openai.ts`) |
| Pipeline | `CONCURRENCY`, `ATTIO_WRITE_CONCURRENCY` |
| Server (web UI only) | `PORT`, `NODE_ENV`, `UPLOAD_DIR` |

The Attio object slug (`companies`) is hardcoded as `ATTIO_OBJECT_SLUG` in `src/apis/attio.ts` — its field slugs in `FIELD_SLUGS` are tightly coupled to that specific object's schema, so it isn't env-configurable. All rate-limit tunables are documented in [`docs/rate-limits.md`](docs/rate-limits.md).

---

## Dev commands

```bash
npm run ui              # web UI dev: Vite (5173) + Express (3001) concurrently
npm run server:dev      # server alone (tsx watch)
npm run web:dev         # frontend alone (vite)
npm run build           # vite build → web/dist/ (frontend only; server runs via tsx)
npm start               # production: tsx server/index.ts, serves web/dist/ + /api on $PORT
npm run typecheck       # tsc --noEmit (strict, no emit) on src/ + server/
npm test                # vitest run (~508 tests, ~3 seconds)
cd web && npx tsc --noEmit    # frontend typecheck
```

---

## Deployment

The web UI deploys to Railway as a single container. Express on `process.env.PORT` serves both `web/dist/` (the built frontend) and `/api/*`.

| Item | Value |
|---|---|
| Build command | `npm ci && npm run build` (Vite build only — no server compile, runtime uses `tsx`) |
| Start command | `npm start` |
| Health check | `/api/health` |
| Required env vars | All API keys, plus `UPLOAD_DIR=/data/uploads` if a persistent volume is mounted |

**Persistent volume (optional).** Mount at `/data` and set `UPLOAD_DIR=/data/uploads` so uploaded CSVs survive redeploys. Without it, uploads are wiped on every redeploy — the pipeline still works, but a mid-run redeploy loses the source CSV. The `cache/` directory is ephemeral perf cache only — losing it never affects correctness.

`railway.json` in the repo root carries the nixpacks config and start/health settings.

---

## Extending

| Task | Where to look |
|---|---|
| Add a new enrichable column (new stage) | [`docs/adding-columns.md`](docs/adding-columns.md) |
| Change how a column is formatted in Attio | [`docs/formats.md`](docs/formats.md) |
| Tune QPS limits, retry behaviour, concurrency | [`docs/rate-limits.md`](docs/rate-limits.md) |
| Write tests for a new stage | [`docs/testing.md`](docs/testing.md) |
| Repoint at a different Attio object | Edit `ATTIO_OBJECT_SLUG` + `FIELD_SLUGS` in `src/apis/attio.ts` |

---

## Troubleshooting

**Preflight reports N rows will be skipped.**
The row is missing `Website` or `Company Linkedin Url` (or both — both are required). Add the missing value to the CSV or remove the row.

**Column header names must be exact.** If the preflight reports every company as skippable, the most likely cause is a misspelled header — a wrong header makes the entire column invisible. Double-check that your CSV headers match the literals in `src/types.ts:InputRow` exactly: `Website` and `Company Linkedin Url` (capital L, capital U — not `LinkedIn` or `URL`).

**Field slugs in Attio must match exactly.** The script identifies each Attio column by a machine-readable slug (defined in `src/apis/attio.ts:FIELD_SLUGS`). If the slug doesn't match a field on the `companies` object in your Attio workspace, Attio silently ignores it — no error, the write just disappears.

**Web UI: `companies` columns are empty after the run.**
The Attio object is likely missing some columns from `FIELD_SLUGS` — those writes silently drop. Cross-check every entry in `FIELD_SLUGS` against the attributes on the target object.

**Exa, TheirStack, or Apollo 429 (rate limit).**
Lower the relevant `*_QPS` value in `.env`. See [`docs/rate-limits.md`](docs/rate-limits.md) for safe defaults.

**`data/input.csv` not found when running `./enrich`.**
The wrapper always reads from `./data/input.csv`. Create the `data/` directory and place the file there, or use the escape hatch (`npm run enrich-all -- --csv <custom-path>`) to point at a different location.

---

## Where to go next

- [`CLAUDE.md`](CLAUDE.md) — full architecture overview, stage table with gate rules, web UI ↔ pipeline contract, code style rules
- [`docs/formats.md`](docs/formats.md) — exact Attio value formats per column, hash-gating details
- [`docs/rate-limits.md`](docs/rate-limits.md) — rate limiter internals and all tunable env vars
- [`docs/adding-columns.md`](docs/adding-columns.md) — step-by-step checklist for adding new stages or columns
- [`docs/testing.md`](docs/testing.md) — test scope rules and the unit/e2e boundary
