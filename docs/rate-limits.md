# Rate Limits & Concurrency

## Scheduler wrappers

Every outbound API call must go through its scheduler — never call the underlying client directly:

| Scheduler | Mechanism | Default | Hard limit |
|---|---|---|---|
| `scheduleExa()` | Bottleneck QPS | 5 QPS | Exa deep-search ceiling |
| `scheduleTheirstack()` | Bottleneck QPS | 3.5 QPS | 300 RPM free plan |
| `scheduleApollo()` | Bottleneck QPS | 3 QPS | 200/min + 6000/hr; 429s on hourly cap handled by runStage retry |
| `scheduleApify()` | p-limit concurrency | 10 concurrent | Long-running run-sync calls (30s–2 min) — concurrency, not QPS, is the right shape |
| `scheduleTwitterApi()` | per-key mutex+minTime | `TWITTER_API_QPS` × N keys | Caller receives `(apiKey, keyIndex, keyCount)` — round-robins across `X_API_KEYS` |
| `scheduleStatuspage()` | p-limit concurrency | 20 concurrent | No documented rate limit; probes hit different hosts so only local socket cap needed |
| `attioWriteLimit` | p-limit concurrency | 5 concurrent | — |
| `openaiLimit` | p-limit concurrency | 5 concurrent | — |

If Apify returns `statusMessage === 'rate limited'` (LinkedIn hourly cap), `runHarvestLinkedInEmployees` throws → `runStage` records an error, leaves cell blank, company retried next run.

## runStage mechanics

`runStage` fires all batches concurrently — back-pressure comes from the rate limiter, not sequential looping. Per batch:

1. Calls `call()` (rate-limited by the relevant scheduler).
2. Retries on failure with exponential backoff (configurable tries + base ms, factor 4 → 1s, 4s, 16s). Retries are per-batch and don't block other batches.
3. On terminal failure, yields `{company, error}` and moves on.
4. `afterBatch` (usually Attio writes) fires as soon as the batch resolves, independently of other batches. `afterBatch` errors are logged and swallowed — never abort the stage.

## Tunables in `.env`

| Variable | Default | Notes |
|---|---|---|
| `EXA_QPS` | 5 | Exa calls/sec |
| `EXA_RETRY_TRIES` | 3 | |
| `EXA_RETRY_BASE_MS` | 1000 | |
| `ATTIO_WRITE_CONCURRENCY` | 5 | max in-flight Attio upserts |
| `OPENAI_CONCURRENCY` | 5 | max concurrent Azure OpenAI calls |
| `THEIRSTACK_QPS` | 3.5 | calls/sec (free plan ≈ 5 QPS ceiling) |
| `THEIRSTACK_RETRY_TRIES` | 3 | |
| `THEIRSTACK_RETRY_BASE_MS` | 1000 | |
| `APOLLO_QPS` | 3 | calls/sec (paid plan = 3.33 QPS; 6000/hr cap) |
| `APOLLO_RETRY_TRIES` | 3 | |
| `APOLLO_RETRY_BASE_MS` | 1000 | |
| `APIFY_CONCURRENCY` | 10 | match your Apify plan: free=3, personal=10, team=25+ |
| `APIFY_RETRY_TRIES` | 3 | |
| `APIFY_RETRY_BASE_MS` | 2000 | |
| `X_API_KEYS` | (required) | Comma-separated twitterapi.io keys; fallback: `X_API_KEY` for a single key |
| `TWITTER_API_QPS` | 10 | calls/sec **per key** |
| `TWITTER_API_RETRY_TRIES` | 3 | |
| `TWITTER_API_RETRY_BASE_MS` | 1000 | |
| `STATUSPAGE_CONCURRENCY` | 20 | max concurrent probes |
| `STATUSPAGE_RETRY_TRIES` | 3 | |
| `STATUSPAGE_RETRY_BASE_MS` | 1000 | |
| `AZURE_OPENAI_DEPLOYMENT_PRO` | (empty → falls back to `AZURE_OPENAI_DEPLOYMENT`) | Stronger model used by Stages 18/19/20; set to `gpt-5.4-pro` |
