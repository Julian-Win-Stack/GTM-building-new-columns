# Review checklist

Walk through the changes in this order. Each item is a single thing to verify. Tick boxes as you go.

Total scope: ~1,800 new TS/TSX lines + ~515 lines of pipeline refactor across 7 logical "stories".

## Architectural decision worth knowing up front

**Frontend ↔ server transport: 1-second polling, NOT Server-Sent Events.** An earlier draft used SSE; we switched to polling for two reasons:
1. **Network resilience.** Internal users may be on café WiFi, mobile tethering, corporate proxies, or VPNs — all of which can interrupt long-lived SSE connections in ways that don't always recover. Each poll is an independent short-lived HTTP request, so a brief network blip just costs one missed tick.
2. **Simplicity.** No reducer, no event-cursor handling, no replay buffer, no subscriber fan-out. The frontend just renders whatever the server's last `GET /api/runs/:id/state` returned.

Cost: ~3,600 requests per hour per active tab (1 user × 1 tab × 1/sec × 60min). The state payload is a few KB. Trivial at our scale.

---

## Story 1 — Shared types (READ FIRST)

Two type files define the contract everything else consumes. Frontend and backend must agree.

### `src/runEvents.ts` — new (~70 lines)
- [ ] `RunEvent` union covers every kind of event the pipeline emits: `run-started`, `stage-started`, `stage-completed`, `cell-updated`, `company-rejected`, `run-completed`, `run-cancelled`, `run-failed`. Used INTERNALLY by the pipeline + server (the server consumes events to update the run record); not sent to the browser anymore.
- [ ] `RunCtx` has `writeToAttio`, `emit`, `isCancelled?`, `cancelSignal?` — these flow through every Attio write site and every API call.
- [ ] `NOOP_RUN_CTX` exists for CLI usage (writeToAttio: true, emit: noop). Verifies the CLI keeps working unchanged.
- [ ] `raceCancel` helper — used at API await sites.
- [ ] `ActivityEntry` — one row in the rolling activity feed (ts, domain, companyName, column, kind).
- [ ] `RunStateSnapshot` — the JSON shape the frontend polls. This is the public API contract between server and browser.

### `web/src/lib/runEvents.ts` — modified (~28 lines)
- [ ] Type-only mirror, but now ONLY mirrors `ActivityEntry` and `RunStateSnapshot`. The `RunEvent` union is not exported here anymore — the frontend doesn't see individual events, only state snapshots.
- [ ] No runtime code. Pure types.

**Verify:** `RunStateSnapshot` shape matches between `src/runEvents.ts` and `web/src/lib/runEvents.ts` field-for-field.

---

## Story 2 — Pipeline refactor (the biggest concern in existing code)

The CLI must keep working byte-identically. The web UI consumes the same pipeline via new options.

### `src/runStage.ts` — modified (~46 line diff)
- [ ] `RunStageOptions<TRaw, TData>` gains `isCancelled?` and `cancelSignal?`.
- [ ] `runOneBatch` checks `isCancelled?.()` at start of batch AND at top of each retry attempt.
- [ ] `Promise.race([call(domains), cancelSignal])` wraps the API call.
- [ ] `Promise.race([Promise.resolve(parse(raw, batch)), cancelSignal])` wraps parse — this is the fix that made cancel actually work for score stages 18–21 and Stage 13 (where API work lives in `parse`, not `call`).
- [ ] Retry-wait `setTimeout` is also raced against `cancelSignal` so cancel doesn't have to wait out a 30s 429 backoff.
- [ ] `afterBatch` is skipped when `opts.isCancelled?.()` is true after `runOneBatch` returns.

### `src/writeStageColumn.ts` — modified (~47 line diff)
- [ ] Signature now takes `ctx: RunCtx` (4 args, was 3).
- [ ] Inner `attioWriteLimit` callback bails immediately if `ctx.isCancelled?.()` (no Attio call).
- [ ] `upsertCompanyByDomain` is gated by `ctx.writeToAttio` — when off, no network.
- [ ] When Attio write IS attempted, it's raced against `ctx.cancelSignal`.
- [ ] `cell-updated` event is emitted **regardless** of `writeToAttio` (so the UI updates either way).

### `src/writeRejectionReason.ts` — modified (~29 line diff)
- [ ] Same pattern as `writeStageColumn`: ctx threaded, writeToAttio gates the upsert, cancelSignal races it.
- [ ] Both `cell-updated` (column: "Reason for Rejection") AND `company-rejected` events are emitted.

### `src/commands/enrichAll.ts` — modified (~534 line diff — biggest)
- [ ] New options on `EnrichAllOptions`: `writeToAttio?`, `onEvent?`, `isCancelled?`, `cancelSignal?`, `resumeCache?`, `onCacheReady?`. CLI defaults make `writeToAttio: true` so existing CLI behavior is unchanged.
- [ ] `bailIfCancelled()` is called between every stage — grep `bailIfCancelled` should return ~21 hits.
- [ ] Cache-init branch order: `resumeCache` → Attio prefetch (if writeToAttio) → empty Map.
- [ ] After cache seeding, the rehydration loop (line ~388–397) emits `cell-updated` for every non-empty slug in `attioCache`. Applies to both Attio resumes and snapshot resumes.
- [ ] `attioUpsertWithCancel` helper used by all 4 score stages (18, 19, 20, 21) and the identity-write block.
- [ ] `fetchAllRecords()` prefetch is raced against `cancelSignal`; on cancel it returns an empty cache and the run bails.
- [ ] `onCacheReady?.(attioCache)` is called once, right after the cache is initialized — the server uses this to wire the snapshot flusher.

**Verify cancel coverage:**
```bash
grep -c "ctx.cancelSignal\|opts.cancelSignal" src/commands/enrichAll.ts
```
Should be ≥ 25 (20 runStage call sites + 4 score-stage upserts + identity-write + prefetch + helpers).

**Verify writeToAttio coverage:**
```bash
grep -n "if (writeToAttio)\|if (ctx.writeToAttio)\|attioUpsertWithCancel\|attioWriteLimit" src/commands/enrichAll.ts | head
```
Every Attio-touching call site should be one of these forms.

---

## Story 3 — Express server (entirely new — read in this order)

### `server/columns.ts` — new (91 lines)
- [ ] Single source of truth for CSV column display→slug mapping.
- [ ] `CSV_COLUMN_ORDER` matches the order documented in `CLAUDE.md` (33 columns).
- [ ] Skim only — pure data.

### `server/csvOutput.ts` — new (30 lines)
- [ ] `renderCsv(cache)` sorts entries by Final Score descending.
- [ ] Uses `csv-stringify` (existing dep).
- [ ] Empty cells stringify as `""`.

### `server/runRegistry.ts` — new (~225 lines) — READ CAREFULLY
- [ ] `RunRecord` holds **everything** the polling endpoint exposes (totalCompanies, skippedRows, currentStage, recentActivity, lastEventAt, surviving/rejected/errored, etc.) plus internal-only fields (cancelSignal, triggerCancel, liveCache, dirty, companyNames, etc.).
- [ ] No `subscribers` Set, no `eventBuffer` — the SSE fan-out infrastructure is gone since the frontend polls.
- [ ] `createRun` constructs `cancelSignal` as a `Promise<never>` whose reject is captured into `triggerCancel`. The `.catch(() => {})` after creation prevents unhandled-rejection warnings on normal completion. Status starts as `'starting'` (not `'running'`) — the run only becomes `'running'` after the `run-started` event fires from the pipeline.
- [ ] `requestCancel` flips `cancelRequested = true` BEFORE calling `triggerCancel()` — order matters because `isCancelled` checks `cancelRequested`. Returns `false` if status isn't `running` or `starting`.
- [ ] `appendEvent` is now the heart of the registry. For each event kind it updates the relevant run-record fields:
  - `run-started`: status → 'running', totalCompanies, skippedRows, domains, companyNames; dirty=true.
  - `stage-started`: currentStage.
  - `stage-completed`: stagesCompleted, completedStageNames; dirty=true.
  - `cell-updated`: pushes to recentActivity (max 12), updates lastEventAt; dirty=true.
  - `company-rejected`: similar to cell-updated, kind='reject'.
  - `run-completed`: stores surviving/rejected/errored counts (status finalized in `completeRun`).
  - `run-failed`: stores error (status finalized in `failRun`).
- [ ] `attachLiveCache` lets the server hold a reference to the live `attioCache` for the flusher.
- [ ] `clearDirty` + `listDirtyRunningRuns` — flusher API. `listDirtyRunningRuns` includes 'starting' runs too, since dirty work can happen before run-started fires.
- [ ] `deleteOldRuns` only sweeps **finished** runs (checks `finishedAt`). Long-running pipelines (>1h) are no longer evicted mid-run — important fix.
- [ ] `serializeRun(run)` returns the public `RunStateSnapshot`. Critical detail: when `cancelRequested` is true and internal status is still `running`/`starting`, it exposes status as `'cancelling'` to the UI. That's the "waiting for cancel to take effect" state.

### `server/snapshotStore.ts` — new (124 lines) — READ CAREFULLY (file I/O)
- [ ] `SNAPSHOT_DIR` resolved from env or default `tmp/runs/`.
- [ ] `writeSnapshot` writes to `<runId>.json.tmp` then renames atomically. Prevents half-written snapshots if the process dies mid-flush.
- [ ] `loadSnapshot` returns `null` on ENOENT (not throw). Schema-version checked.
- [ ] `findResumableSnapshot(domains)` does **set equality** — order doesn't matter, sizes must match. Returns the most recently saved match.
- [ ] `sweepOldSnapshots(maxAgeMs)` deletes by `savedAt`.
- [ ] `getSnapshotDir()` exposed for logging.

### `server/index.ts` — new (~340 lines) — READ LAST
Read in route order:
- [ ] `UPLOAD_DIR` env var override (default `tmp/uploads/`); multer dest set to it.
- [ ] `startRunAsync` — shared kickoff used by `/start` and `/resume`. Look at the try/catch/finally:
  - `try`: enrichAll, then `completeRun` + `deleteSnapshot(runId)` + (on resume) delete the source snapshot too.
  - `catch`: if `isRunCancelled`, soft complete with empty Map. Otherwise `failRun`. Snapshots kept on cancel/failure.
  - `finally`: delete the uploaded CSV.
- [ ] `POST /api/runs` — parses CSV, extracts domains via `deriveDomain`, calls `findResumableSnapshot`. If found, stashes upload in `pendingUploads` and returns `{ runId, resumable }`. Otherwise starts immediately.
- [ ] `POST /api/runs/:id/start` — pulls from `pendingUploads`, kicks off without resumeCache.
- [ ] `POST /api/runs/:id/resume` — pulls from `pendingUploads`, loads snapshot, kicks off with resumeCache.
- [ ] `POST /api/runs/:id/cancel` — calls `requestCancel`. Returns 404 if unknown, 409 if already finished.
- [ ] `GET /api/runs/:id/state` — **NEW polling endpoint**. Returns `serializeRun(run)` as a one-shot JSON. Sets `Cache-Control: no-store`. Returns 404 if run unknown. Replaces the old SSE stream — short-lived requests are more robust on flaky networks (cafés, hotel WiFi, mobile tethering, corporate proxies) and require no special transport handling.
- [ ] `GET /api/runs/:id/csv` — 409 if run not yet complete.
- [ ] Three intervals at the bottom: 1s flusher, 5min in-memory sweeper, 24h disk-snapshot TTL sweeper. Plus a one-shot startup TTL sweep.

**Verify lifecycle:** trace one happy path (no resume) and one resume path. The runId should be the same between `POST /api/runs` and the follow-up `/start` or `/resume`.

---

## Story 4 — Crash recovery (cross-cutting)

This concern touches multiple files. Trace one path end-to-end:

- [ ] `enrichAll` boots → `onCacheReady(attioCache)` fires (`src/commands/enrichAll.ts`).
- [ ] Server's `attachLiveCache(runId, cache)` stores the reference (`server/runRegistry.ts`).
- [ ] First `cell-updated` event arrives → `appendEvent` flips `dirty = true`.
- [ ] 1s flusher tick → `listDirtyRunningRuns()` returns this run → `clearDirty(id)` BEFORE write (so concurrent updates re-flag for next tick) → `writeSnapshot` to disk.
- [ ] Repeat throughout the run.
- [ ] On run-completed → `deleteSnapshot(runId)` in `startRunAsync`'s try block.
- [ ] On crash → snapshot stays on disk. User re-uploads same CSV → `findResumableSnapshot` matches → ResumeBanner appears.
- [ ] On click Resume → `loadSnapshot` rebuilds the Map → passed as `resumeCache` to `enrichAll` → cache initialization branch picks it up → rehydration loop emits `cell-updated` for every cached cell → UI shows full state.

**Edge case to mentally test:** what if the user uploads CSV-A, server crashes mid-run, then uploads CSV-B (different)? CSV-A's snapshot stays untouched (different domains, no match). CSV-B starts fresh. Re-uploading CSV-A later still finds its snapshot.

---

## Story 5 — Frontend shell + state hook

### `web/src/main.tsx` — new (10 lines)
- [ ] Skim — React bootstrap.

### `web/src/styles/global.css` — new
- [ ] Design tokens: colors, radii, ease curves, fonts. Used by every component.
- [ ] `--accent: #19E2B0` matches Bacca brand.

### `web/src/App.css` — new
- [ ] Layout grid, header/footer styling. Skim.

### `web/src/lib/useRunStream.ts` — new (~110 lines) — READ CAREFULLY (this got significantly simpler)
- [ ] No reducer, no EventSource, no event union. Just `useState<RunStateSnapshot>` + `setInterval(1000)` + `fetch`.
- [ ] On runId change: resets state, sets status='starting', kicks off the polling loop.
- [ ] Polling loop: `fetch(/api/runs/:id/state)` → `setState(json)` → `setTimeout(tick, 1000)`. Stops automatically when status becomes terminal (`completed` / `cancelled` / `failed`).
- [ ] Network errors in the fetch are silently swallowed and retried on the next tick — that's the resilience win over SSE.
- [ ] `optimisticCancellingRef` — when the user clicks Cancel, we synchronously set status='cancelling' so the UI reacts instantly. Until the server's poll confirms, any incoming `running`/`starting` snapshot is overridden to `cancelling` to prevent a flicker. Cleared once status reaches terminal.
- [ ] `cancel()` POSTs to `/api/runs/:id/cancel` and sets `optimisticCancellingRef.current = true`.
- [ ] Cleanup on unmount: sets `stopped = true` flag and clears the timeout. Critical — without it, a stale poll callback could call setState on an unmounted component.

### `web/src/App.tsx` — new (~180 lines) — READ CAREFULLY
- [ ] State: `runId`, `pending`, `resumeBusy`, `cancelledSnapshot`, `controlDeckKey`.
- [ ] `useEffect` watching `state.status === 'cancelled'` → snapshots `runId` and `state.stagesCompleted` (was `state.completedStages.size` in the SSE version) into `cancelledSnapshot`, clears `runId`, bumps `controlDeckKey`.
- [ ] `startRun`: dismisses any cancelledSnapshot, POSTs the form, branches on `body.resumable`.
- [ ] `chooseResume` / `chooseStartFresh`: both POST to the corresponding endpoint, then set `runId` (which subscribes the SSE). Both have a `resumeBusy` guard.
- [ ] `downloadCsv` / `downloadCancelledCsv`: navigate via `window.location.href` (browser handles the file download).
- [ ] Render: `ControlDeck` always visible, conditional ResumeBanner / CancelledBanner / RunStatus+SkippedPanel+ActivityFeed.
- [ ] When `state.status === 'cancelled'`, RunStatus + SkippedPanel + ActivityFeed are NOT rendered (the new behavior).

**Verify state machine:** for each transition, what gets unmounted and what stays?
- idle → starting (after upload) — RunStatus appears.
- running → cancelled — RunStatus/ActivityFeed disappear, CancelledBanner appears, ControlDeck remounts cleared.
- starting → resumable response — pending set, ResumeBanner appears, run hasn't started yet.

---

## Story 6 — UI components (mostly cosmetic, can review quickly)

Small, self-contained. For each: confirm only renders what its props imply, no fetches, no stale state.

### `web/src/components/BaccaMark.tsx` — new (26 lines)
- [ ] Inline SVG matching `bacca.ai/favicon.svg`. Accepts `size` and `className`.

### `web/src/components/ControlDeck.{tsx,css}` — new (142 + ~200 lines)
- [ ] File picker + Account Purpose input + Attio toggle + Submit.
- [ ] `key` prop trick used by App.tsx to remount-and-reset.
- [ ] When Attio is OFF, the `ctrl__hint--reassure` block appears with auto-save / 7-day messaging.

### `web/src/components/RunStatus.{tsx,css}` — new (118 + ~230 lines)
- [ ] Stage indicator + animated progress bar + counters + Cancel + Download.
- [ ] New `runstatus__safety` line ("Auto-saving every second · safe to close the tab and come back · drafts kept 7 days") visible only when `isLive`.
- [ ] Cancel button has the warning hover treatment (red on hover).

### `web/src/components/ResumeBanner.{tsx,css}` — new (59 + ~60 lines)
- [ ] Copy: "We picked up where the last run left off". Mentions auto-saved + relative time.
- [ ] Two buttons: Resume (primary) and Start fresh (ghost).

### `web/src/components/CancelledBanner.{tsx,css}` — new (39 + ~85 lines)
- [ ] Copy: "Run cancelled · X of 21 stages completed · saved for 7 days — re-upload the same CSV to resume".
- [ ] Download partial CSV + dismiss (×) buttons.

### `web/src/components/SkippedPanel.{tsx,css}` — new (38 + ~80 lines)
- [ ] Hidden when `skippedRows.length === 0`.
- [ ] Expanded by default for ≤ 3 rows, collapsed otherwise.

### `web/src/components/ActivityFeed.{tsx,css}` — new (86 + ~150 lines)
- [ ] Per-second `setInterval` only runs while `state.status` is `running` or `cancelling` (this is for refreshing the "X seconds ago" labels — independent of the data-polling tick).
- [ ] Heartbeat colors: fresh (green) → slow (warm) → stuck (red) by idle-secs thresholds 30 / 90.
- [ ] Empty state ("Waiting on the first result from the API…") shown when `recentActivity.length === 0`.
- [ ] `recentActivity` array now comes directly from the server's polled snapshot — frontend doesn't build it locally anymore.

### `web/src/lib/columns.ts` — new (115 lines)
- [ ] Mirror of `server/columns.ts` (different shape — frontend mirrors the parts it needs: `CSV_COLUMN_ORDER`, `COLUMN_WIDTHS`, `STAGE_COLUMNS`).

---

## Story 7 — Config & docs (last, fastest)

- [ ] `package.json` — new scripts (`ui`, `server:dev`, `web:dev`, `build`, `start`); new deps (express, multer, react, vite, etc.); `tsx` moved to dependencies for production runtime.
- [ ] `package-lock.json` — auto-generated; just confirm it's coherent (no merge markers).
- [ ] `tsconfig.json` — `include` covers both `src/` and `server/`; `web/` is excluded (it has its own tsconfig).
- [ ] `web/tsconfig.json` — frontend config, skim.
- [ ] `web/vite.config.ts` — `/api → :3001` proxy in dev; build outputs to `web/dist/`.
- [ ] `railway.json` — `npm start`, healthcheck `/api/health`, `_notes` block documenting the volume mount requirement.
- [ ] `.gitignore` — adds `dist/`, `web/dist/`, `tmp/`.
- [ ] `web/index.html` — favicon link.
- [ ] `web/public/favicon.svg` — Bacca brand mark.
- [ ] `CLAUDE.md` — read **last**. Verify the architecture tree, commands, code-style notes, Railway section, and crash-recovery section all match what's in the code.

---

## Spot-checks before you green-light

- [ ] **CLI still works:** `npm run enrich-all -- --csv data/input.csv --limit 1` writes to Attio same as before. The `writeToAttio` default is `true`.
- [ ] **Cancel works fast:** during a 100-row run, clicking Cancel returns control within ~1 second (not minutes).
- [ ] **Resume works:** crash mid-run → re-upload → ResumeBanner appears → click Resume → table rehydrates.
- [ ] **CSV-only download works:** Attio toggle off → run completes → Download CSV produces a 33-column file with the same data the live UI showed.
- [ ] **Live UI rehydrates on resume:** when resuming, the activity feed shows recent events for already-cached cells (rehydration emit pass).

## Two more meta-tips

1. **Diff existing files via `git diff HEAD -- <file>`** — review only the changed hunks. Read new files whole.
2. **Run `npm test` before merging** — 487/488 pass. The 1 failure is pre-existing on `main` (the LinkedIn-only-row test) and unrelated to this branch.
