

## Phase 3 — Review by risk, not uniformly (~2 hours total)

**Rule:** the more code is *modifying existing behavior*, the more you read. Brand-new code can lean on tests + agents.

### Read deeply yourself

These are the high-risk parts. Your eyes, your judgment.

- **Story 1 — shared types** (~70 lines). Contract for everything else. Open both `src/runTypes.ts` and `web/src/lib/runTypes.ts` and verify `RunStateSnapshot` matches field-for-field.
- **Story 2 — pipeline refactor** (~600 lines). Only place modifying battle-tested code. Walk through `REVIEW.md` Story 2 line by line. Run the grep gates:
  ```bash
  grep -c "ctx.cancelSignal\|opts.cancelSignal" src/commands/enrichAll.ts
  # expect ≥ 25

  grep -n "if (writeToAttio)\|if (ctx.writeToAttio)\|attioUpsertWithCancel\|attioWriteLimit" src/commands/enrichAll.ts | head
  # every Attio-touching site should match one of these forms
  ```
- **Story 5 — frontend state machine** (`useRunStream.ts` + `App.tsx`, ~290 lines). State bugs hide from review agents because they need runtime context.

### Skim, then agent-review

Brand-new code, contained blast radius. Skim the structure, then let an agent catch what you missed.

- **Story 3 — Express server** (`server/index.ts`, `runRegistry.ts`, `snapshotStore.ts`). Skim route handlers and registry methods. Check `csvOutput.ts` and `columns.ts` only for shape.
- **Story 6 — UI components**. Skim each component for "renders what its props imply, no hidden fetches." Skip CSS unless something looks broken in the browser.
- **Story 7 — config**. Glance at `package.json` (new scripts + deps), `railway.json`, `.gitignore`. Skip `package-lock.json` entirely.

### Run the review agent

After your own reads are done, run `/ultrareview` on the branch. It launches multiple review agents in parallel.

Use it to check:
- Cross-file consistency (every Attio call site gated, type mirrors aligned)
- Subtle bugs in the boilerplate-heavy parts (server, UI components)
- Anything you skimmed

**Don't** use the agent's "looks good" as a substitute for understanding Story 2. If you didn't read the pipeline refactor and the agent approved it, no human understands what changed there — and that's exactly the thing you wanted to avoid.

---

## Phase 4 — Spot-checks before merging (~20 min)

Final pass on the actual product behavior:

- [ ] CLI: `npm run enrich-all -- --csv data/input.csv --limit 1` writes to Attio identically to before.
- [ ] Cancel: during a 100-row run, clicking Cancel returns control within ~1 second.
- [ ] Resume: kill the server mid-run → restart → re-upload same CSV → ResumeBanner appears → click Resume → table rehydrates with already-cached cells.
- [ ] CSV-only mode: Attio toggle off → run completes → Download CSV produces a 33-column file matching what the live UI showed.
- [ ] Live rehydration: on resume, the activity feed shows recent events for already-cached cells (not just new ones).

---

## If something is broken

Fix forward, don't blame the diff. The split-commit structure means a fix is one commit on top, not a giant revert.

If a bug spans multiple commits (e.g., types in commit 1 are wrong, which broke commit 2), amend the relevant commit before pushing. Once pushed, only fix forward.

---

## Lessons for next time (do not skip)

- **Plan first, in writing.** A 200-line plan you read carefully beats a 4,000-line diff you skim.
- **Commit at every natural seam.** Stop, commit, review *that* seam, continue. Same total work, much less cognitive load.
- **Decide reading depth in advance.** "Deep read", "skim", "agent only" — pick before you start, not after you're tired.
- **Manual happy-path testing isn't enough.** It misses both wrong-design bugs (a plan catches those) and subtle correctness bugs (tests + careful reading catch those).
