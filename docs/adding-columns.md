# Adding New Columns

## Adding an enrichable column (stage-backed, in ENRICHERS map)

Changes required in 4 places:
1. `src/types.ts` — add to `EnrichableColumn` union
2. `src/config.ts` — add to `ENRICHABLE_COLUMNS`
3. `src/enrichers/index.ts` — add to `ENRICHERS` map
4. `src/apis/attio.ts:FIELD_SLUGS` — add the Attio field slug

For a **gating-stage** column, also add reason builders to `src/rejectionReasons.ts` (fresh + cached variants).

**Note on hash invalidation:** adding any new upstream enrichable column automatically invalidates all Stage 18 hashes → full re-score on the next run. This is intentional (new signal → refreshed score).

## Adding a non-enrichable identity column (CSV-sourced, like Description)

Changes required in 2 places:
1. `src/types.ts` — add to `InputRow` and `EnrichmentResult`
2. `src/apis/attio.ts:FIELD_SLUGS` — add the Attio field slug

Also update `pipeline.ts:EnrichmentResult` literal. The column stays out of `EnrichableColumn` / `ENRICHERS`.

## Adding a CLI-flag identity column (like Account Purpose)

Same as non-enrichable plus:
- Wire the flag in `src/index.ts`
- Add to `EnrichAllOptions` in `enrichAll.ts`
- Add to the identity-write block in `enrichAll.ts`

## Adding a score column (Stages 18/19/20/21 style)

In addition to the standard 4-place enrichable change:
1. Update all `.filter()` exclusion clauses in `enrichAll.ts` that exclude score columns from eligibility hash checks — all score columns must be excluded from each other's prior-column checks to avoid circular dependency. There are currently four exclusion filters (one per score stage).
2. Add a new hash-detection column slug to `FIELD_SLUGS`.
3. Implement hash-gating in the stage file using `computeInputHash` (exported from `companyContextScore.ts`).

## Wiring a new stage into enrich-all

1. Add the stage call in `enrichAll.ts` at the correct position.
2. For gating stages (post-filter): call `filterSurvivors` + `filterCachedSurvivors` + `writeRejectionReasons`.
3. For non-gating stages: pass `survivorsAfterStage6` through unchanged.
4. Stages 18/19/20 require all 17 prior enrichable columns non-empty (eligibility filter). Stage 21 additionally requires the 3 upstream score columns non-empty.
5. Update `enrichAll.e2e.test.ts` only if the new stage adds inline orchestration logic — don't add E2E tests for per-stage behavior covered by unit tests.
