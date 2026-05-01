# Testing Rules

## Layers

**Unit tests are the primary layer.** One `*.test.ts` alongside each module (e.g. `src/util.ts` → `src/util.test.ts`). Cover: parsers, formatters, gates, helpers, `runStage` retry/backoff, `filterSurvivors`, `writeStageColumn`, Attio HTTP shape.

**Integration / E2E tests** live in `src/commands/enrichAll.e2e.test.ts` (helpers in `enrichAll.e2e.helpers.ts`). Drive the full pipeline with module-mocked external APIs. **Scope is intentionally narrow** — cover ONLY orchestration logic inline in `enrichAll.ts` that unit tests cannot reach:
- CSV-only scope (Attio records outside the CSV are ignored; prefetch is narrowed to CSV domains)
- Identity-write no-overwrite
- Stage 3's hand-rolled conditional gate
- Stage 10 N/A branch
- Stage 11+12 union-skip filter
- Cache-gate wiring
- One representative rejection-propagation flow
- Dry-run

## Do NOT overbuild the E2E suite

Before adding a new E2E scenario, ask: *does a unit test already cover this?* If yes, don't add it. Specifically do not add E2E tests for:
- Per-stage gate correctness — each stage has its own `.test.ts`.
- `filterSurvivors` / `runStage` / `writeStageColumn` mechanics — own unit tests.
- Multi-domain batching, retry/backoff, parse-miss, errored-drop — already unit-tested.
- Parser or formatter output shape — already unit-tested.
- Attio HTTP/pagination — already unit-tested.

One representative test per orchestration flow is enough. Update an existing scenario rather than adding a new one when possible.

## Workflow after every change

1. Write or update **unit tests** for the changed logic. If no test file exists, create one alongside the module.
2. Only if the change touches inline `enrichAll.ts` orchestration → update/add an E2E scenario (keep it narrow).
3. Run `npm test` — both unit and integration must pass before considering the task complete.
4. **Before any `git commit`**, re-run `npm test`. Never commit with failing tests, never skip tests without explicit user approval.
5. Never mark a task done if any test is failing.
