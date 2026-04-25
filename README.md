# GTM Company Enrichment

This CLI enriches prospective customers for Bacca.ai. Given a CSV of target companies, it calls Apify, Exa, TheirStack, Azure OpenAI, Apollo, twitterapi.io, and Statuspage, runs each company through a 21-stage pipeline, and writes results to an Attio custom object (`ranked_companies`) so GTM team can prioritise outreach.

---

## Quick start

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

---

## Prerequisites

- **Node.js ≥ 18** and npm
- **Attio workspace** with the `ranked_companies` custom object. Every column written by this tool must exist in Attio with the exact slug listed in `src/apis/attio.ts:FIELD_SLUGS`. If a column is missing, the upsert silently drops that field.
- **API keys** for all seven providers (listed in `.env.example`):
  - Attio
  - Apify
  - Exa
  - TheirStack
  - Apollo
  - twitterapi.io (`X_API_KEY`)
  - Azure OpenAI — two deployments required: a standard model (Stages 1–17) and a "pro" model (Stages 18–21)

---

## Input CSV format

Path: `./data/input.csv` (gitignored — never committed).

Column names are **case-sensitive and must match exactly**:

| Column | Notes |
|---|---|
| `Company Name` | Required. Display name written to Attio. |
| `Website` | At least one of `Website` or `Company Linkedin Url` must be present. |
| `Company Linkedin Url` | At least one of `Website` or `Company Linkedin Url` must be present. |
| `Short Description` | Optional. Written to Attio's `Description` field. |

Rows with **neither** a Website nor a LinkedIn URL are skipped entirely. The preflight (see below) reports these before any API calls happen.

---

## Running it

### Primary commands

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

### What happens when you run it

1. **Banner** — prints the CSV path, account-purpose tag (or "(none)"), and row limit.
2. **Preflight** — scans the CSV and lists any rows that will be skipped (no Website AND no LinkedIn URL). If all rows are usable, it says so explicitly.
3. **3-second countdown** — hit Ctrl-C here if anything in the preflight looks wrong. No Attio writes have happened yet.
4. **Identity write** — fills empty Attio columns from CSV (Company Name, Domain, LinkedIn Page, Description, Website, Account Purpose). Never overwrites an existing non-empty value.
5. **Stages 1–21** — run in order. Each stage writes one column per company to Attio as it completes. If you kill the process and restart, any company whose column is already populated is skipped for that stage — no duplicate API calls.

---

## How it works

### Input set

The processing set is **CSV rows ∪ non-rejected Attio records**. The tool does not only process the CSV — it also picks up any company that already exists in Attio and has not been rejected. This means re-running after adding rows to the CSV will also re-process carry-over companies for any stages they haven't completed yet.

### 21-stage pipeline

Stages run in a fixed order. Each stage writes one column to Attio.

**Stages 2–6 are gating.** A company that fails a gate (e.g. scored as not digital-native at Stage 2, or found to use Microsoft Teams instead of Slack at Stage 5) receives a `Reason for Rejection` entry in Attio and is dropped from all subsequent stages. Stage 1 is not gating — every company continues to Stage 2 regardless.

**Stages 18–21 are scoring.** After signal collection is complete, three score columns (Company Context Score, Tooling Match Score, Intent Signal Score) and a Final Score are computed via Azure OpenAI's "pro" deployment. These stages are hash-gated: the model is only called when upstream inputs have changed since the last run.

The full stage table, gate rules, and Exa/TheirStack API mapping are in [`CLAUDE.md`](CLAUDE.md).

### Resume semantics

Every stage skips a company whose target column in Attio is already non-empty. This makes re-runs safe and cheap — crash, fix, re-run, and only the failed companies are retried.

### Rate limiting and caching

Every outbound API call goes through a per-provider scheduler (`src/rateLimit.ts`) and an on-disk cache (`cache/`, gitignored). QPS limits and retry parameters are tunable via env vars — see [`docs/rate-limits.md`](docs/rate-limits.md).

---

## Configuration

Copy `.env.example` to `.env` and fill in all values. `.env` is gitignored and must never be committed.

| Group | Environment variables |
|---|---|
| Attio | `ATTIO_API_KEY`, `ATTIO_OBJECT_SLUG` |
| Apify | `APIFY_TOKEN` |
| Exa | `EXA_API_KEY` |
| TheirStack | `THEIRSTACK_API_KEY`, `THEIRSTACK_QPS`, `THEIRSTACK_RETRY_TRIES`, `THEIRSTACK_RETRY_BASE_MS` |
| Apollo | `APOLLO_API_KEY`, `APOLLO_QPS`, `APOLLO_RETRY_TRIES`, `APOLLO_RETRY_BASE_MS` |
| twitterapi.io | `X_API_KEY`, `TWITTER_API_QPS`, `TWITTER_API_RETRY_TRIES`, `TWITTER_API_RETRY_BASE_MS` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_DEPLOYMENT_PRO` |
| Global | `CONCURRENCY` |

`ATTIO_OBJECT_SLUG` defaults to `ranked_companies`. All rate limit tunables are documented in [`docs/rate-limits.md`](docs/rate-limits.md).

---

## Dev commands

```bash
npm run typecheck       # tsc --noEmit (strict, no emit)
npm run build           # emit compiled output to dist/
npm test                # vitest run (~470 tests, ~3 seconds)
```

---

## Extending

| Task | Where to look |
|---|---|
| Add a new enrichable column (new stage) | [`docs/adding-columns.md`](docs/adding-columns.md) |
| Change how a column is formatted in Attio | [`docs/formats.md`](docs/formats.md) |
| Tune QPS limits, retry behaviour, concurrency | [`docs/rate-limits.md`](docs/rate-limits.md) |
| Write tests for a new stage | [`docs/testing.md`](docs/testing.md) |

---

## Troubleshooting

**Preflight reports N rows will be skipped.**
The row has no Website and no LinkedIn URL. Add one to the CSV or remove the row.

**Column header names must be exact.** If the preflight reports every company as skippable, the most likely cause is a misspelled header — a wrong header makes the entire column invisible. Double-check that your CSV headers match the literals in `src/types.ts:InputRow` exactly: `Website` and `Company Linkedin Url` (capital L, capital U — not `LinkedIn` or `URL`).

**Field slugs in Attio must match exactly.** The script identifies each Attio column by a machine-readable slug (defined in `src/apis/attio.ts:FIELD_SLUGS`). If the slug doesn't match a field on the `ranked_companies` object in your Attio workspace, Attio silently ignores it — no error, the write just disappears. 

**Exa, TheirStack, or Apollo 429 (rate limit).**
Lower the relevant `*_QPS` value in `.env`. See [`docs/rate-limits.md`](docs/rate-limits.md) for safe defaults.

**`data/input.csv` not found when running `./enrich`.**
The wrapper always reads from `./data/input.csv`. Create the `data/` directory and place the file there, or use the escape hatch (`npm run enrich-all -- --csv <custom-path>`) to point at a different location.

---

## Where to go next

- [`CLAUDE.md`](CLAUDE.md) — full architecture overview, stage table with gate rules, code style rules
- [`docs/formats.md`](docs/formats.md) — exact Attio value formats per column, hash-gating details
- [`docs/rate-limits.md`](docs/rate-limits.md) — rate limiter internals and all tunable env vars
- [`docs/adding-columns.md`](docs/adding-columns.md) — step-by-step checklist for adding new stages or columns
- [`docs/testing.md`](docs/testing.md) — test scope rules and the unit/e2e boundary
