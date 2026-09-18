# Jev run diagnosis

Inspected on 2026-09-18. The previous in-browser run was exported before changing the app. It contains one complete batch. Earlier runs were not persisted, so their complete requests cannot be recovered.

## Evidence

| Run                    | Batches | Choices | Choices differing from the unique solution | Result                           |
| ---------------------- | ------: | ------: | -----------------------------------------: | -------------------------------- |
| Previous browser trace |       1 |      32 |                                         17 | Partial board                    |
| API validation         |       6 |     117 |                                         46 | Solved after 4 search backtracks |
| Browser validation     |       3 |      71 |                                         20 | Solved                           |

These counts describe these runs, not a model accuracy benchmark. Later questions can depend on an already incorrect partial board.

The previous trace is `logs/previous-run.json`. The API validation is `logs/validation-run.json`. Raw events for both new runs are in `logs/requests.jsonl`, grouped by run and request ID. Logs are local and Git-ignored. They exclude authorization headers.

## Findings

1. **Batch choices can conflict.** In the previous trace, Jev chose 7 for r1:c1, r1:c4 and r1:c5. Each question used the same pre-request board. Those choices cannot coexist in one row. The app applied 15 of 32 suggestions and deferred 17.
2. **Local legality does not establish a solution.** The unique solution has 3 at r1:c1. Jev chose 7 with probability 0.59. Six incorrect suggestions passed the immediate legality check and entered the previous board. Search must later undo them.
3. **A probability of 1 can be forced by the option mask.** In batch 3 of the API validation, two incorrect values had probability 1 because an earlier wrong branch left only one locally legal option. These are not proofs of correctness.
4. **Response parsing preserved the choices.** Every choice in the previous trace and API validation matched its raw response. There was no coordinate or numeric conversion mismatch.
5. **Large boards previously lacked a uniqueness check.** That was a generator defect, fixed independently of model behavior. It did not explain the captured 9×9 failures: those initial boards have exactly one solution.

The app combines model rankings with constraint checks and backtracking. A completed run is a result of that combined system. Jev does not provide a written reasoning trace, and mean/min probabilities are not a joint probability that a batch is correct. TypeSafe explicitly describes calibration across groups of predictions, without guaranteeing an individual answer: https://docs.typesafe.ai/concepts/system-one.

## Original uniqueness guarantee

The generator starts from a valid complete board. For sizes up to 16 it accepts a clue removal only if solution counting returns exactly one. Budget exhaustion rejects the removal.

Above 16, it accepts a removal only if the removed cell still has one legal value. Any completion of the new puzzle must restore that value, yielding the previously unique puzzle. Induction proves uniqueness after every removal. Reversing the removal order gives a proof using forced moves. This produces easier logical puzzles, can retain extra clues, and does not measure worst-case Sudoku difficulty.

`pnpm exec tsx scripts/verify-generation.ts` checks seeded puzzles at all three difficulty settings, including prime sizes. Small boards use solution counting; large boards are independently restored using candidate sets and forced moves. The script also checks multiple-solution and conflicting-clue cases.

`pnpm exec tsx scripts/analyze-run.mjs logs/previous-run.json` compares every recorded choice with the exact solution and raw response. It exits with status 1 when choices are incorrect. This is a diagnostic signal for model errors, not a claim that the model has been fixed.

## Follow-up: request context

A trial with full naked/hidden-single propagation solved the original board before querying Jev. That made the experiment trivial, so it was removed. `logs/assisted-validation.json` records that discarded trial and must not be counted as model solving performance.

The active request only excludes digits already present in each target's row, column or box, as before. A trial adding explicit groups did not reduce the original 17 errors and increased cost, so it was discarded too. Batch scheduling now keeps ambiguous targets in separate rows, columns and boxes. No chained deductions or answer key are sent.

The final scheduling variant completed that same board in 8 requests with no derived answers in the payload. It still needed four search backtracks; it does not guarantee correct model predictions. The trace is `logs/scheduled-validation.json`.

## Full choice range

The active protocol now offers all numbers 1–N for every question. No candidate mask or derived answer is sent. The server validates response structure and the full probability range; the application rejects illegal placements after the answer arrives. Backtracking only erases moves and never inserts an alternative. No-progress batches and repeated failed positions pause the run.

Before this change, an audit of the latest 30 unassisted 9×9 requests found 284 questions, including 271 with a single option. All option masks matched immediate row/column/box constraints, but 6 request boards had no full solution. This explains why a locally legal forced option could still be wrong.

## Candidate filtering restored

At the user's request, the active protocol again removes values already present in a target's row, column or box. It makes no further deductions and never supplies a preferred answer. Batches now allow up to 128 targets, subject to the request budget. Backtracking still only erases moves; it does not insert alternatives. The earlier full-range experiment remains in the logs as historical evidence.

## Uploaded 64 by 64 run

Audited `jevdokku-64.json` on 2026-09-18 with `node scripts/audit-confidence.mjs <export-path>`.

The file records 12 batches and 1,190 decisions. Every request question has exactly one option after immediate candidate filtering. Every raw API answer assigns that option probability 1 and confidence 1. Parsed values match the raw responses, so rounding and response conversion do not explain the result.

Independent forced restoration produces a valid complete solution. All 1,190 decisions match it. Replaying each batch through `applyBatch` reproduces every saved board. No previous placement disappears or changes between batches, all recorded backtrack counts are zero, and the final board is complete. Recorded cost is $0.008132922.

The large-board generator guarantees uniqueness through reversible single-candidate removals. The scheduler prioritizes single-candidate cells. Together with candidate filtering, this run only asks Jev questions whose option lists already determine the answer. It does not measure choice accuracy or confidence calibration when alternatives exist.

The export does not record UI timing, navigation or rendered frames, so it cannot establish why a user saw apparent rollbacks. Current forward transitions preserve previous placements in this trace; the previous batch highlight clears when the next request starts. Backward replay intentionally removes later placements from the displayed snapshot. Neither is a solver backtrack.

## Harder large boards

The generator above size 16 now removes random clues and restores clues until naked and hidden singles prove a complete solution. Independent validation solves each generated puzzle by required deductions, proving uniqueness. A separate naked-single pass must leave at least 25% of the original empty cells unresolved. Otherwise generation retries and eventually reports an error rather than accepting a trivial board. Proof deductions remain inside generation; model requests contain only immediate candidates and known failed choices.

In a seeded 64 by 64 Medium sample, 1,468 of 1,495 empty cells remained after exhausting naked singles. The next scheduled batch offered between 2 and 9 candidates per cell. Generation took 107 ms in that sample. Seeded 128 by 128 generation took roughly 1 to 2.4 seconds depending on the initial density. These are sample timings, not latency guarantees or model accuracy results.

## Uploaded 9 by 9 run and repeated failures

The second upload, `jevdokku-9.json`, contains 11 batches with no rejected-choice feedback in their request payloads. The first batch applies five values differing from the unique solution. Subsequent requests repeatedly offer forced values from an already impossible branch. For example, before batch 2, r3:c2 and r3:c3 both have only candidate 3. There are no duplicate placed digits and no empty candidate sets yet, so the previous dead-end check misses the contradiction. Repeating those forced choices returns probability 1 without correcting the earlier assumption.

Rollback now records rejected values together with the earlier speculative assignments they depend on. Applicable exclusions reach both the request criteria and a compact feedback field; response validation uses the same criteria. They remain active under additional assumptions but stop applying when a prerequisite changes. Exhausted options roll back an earlier assumption. A new dead-end check rejects competing forced copies in a row, column or box before issuing another request.

`scripts/verify-model-choices.ts` covers the actual captured contradictory board, repeated-choice exclusion, request feedback, changed assumptions and exhausted branches. It failed on the repeated-choice case before the fix. This prevents retries of known failed choices under the same assumptions; it does not make Jev a complete or efficient Sudoku solver.

Live validation resumed the uploaded 9 by 9 puzzle using its captured first response. The run completed after 32 additional API requests with 29 recorded failures and no repeated excluded choices under matching assumptions. These additional requests cost $0.001303806. The trace is `logs/rejection-validation.json`.

Three fresh seeded 9 by 9 boards completed in 4, 5 and 4 requests. Four-request smoke runs at 32 by 32 and 64 by 64 checked candidate masks and exclusions; they did not solve those full boards. These traces are in `logs/generation-validation.json`.

## Replay and placement feedback

The third upload, `jevdokku-9 (1).json`, completes correctly in six batches. Two initially applied wrong values require two backtracks. The former UI displayed intermediate rollback boards during requests, then reapplied many unchanged values after the response. It also cleared and reanimated placement cards, while newly mounted canvases started at a placeholder size.

The canvas now holds the last committed snapshot during request and response, then changes once when the batch applies. It measures its initial size before paint. Pending placement cards keep their slots, and cards no longer fade in with staggered delays. Recorded navigation still shows the destination snapshot immediately and cancels older animations.

Placement cards distinguish a proven rejected choice from an answer skipped when the batch stopped. The inspector counts all received answers, crosses out known rejected choices, and shows previous exclusions beside a new choice. Hover links the board and matching placement in both directions, scrolling only the inspector when needed.

Browser replay of the captured six-batch trace checked all request/response snapshots, constant canvas bounds, pending layout, six rapid history jumps, cancellation of stale transitions, both hover directions, rejected/skipped labels and crossed-out exclusions. All assertions passed; `logs/ui-validation.json` records them. The maximum board side is now 64; the configurable batch limit remains 128.

## Full coverage and first-attempt solving

The latest requested behavior supersedes candidate-filtered requests and independent-cell scheduling. Targets now follow board order up to the configured cell limit, including cells sharing a row, column or box. Every question contains all numbers 1–N. Known failures appear as feedback and remain in the model distribution; application still rejects them under matching assumptions.

Every returned answer is processed even after detecting a contradiction. The export keeps the complete proposed board, applied indices, rejected indices and rejection reasons. A regression test supplies a correct complete guess and confirms that one response solves the puzzle. Another confirms that an early contradiction does not leave later answers unchecked.

Browser validation received 40 answers for all 40 empty cells of a 9 by 9 board. Each answer contained nine probabilities, and the inspector rendered all 40 cards and the complete selected-cell distribution. Three additional seeded Hard runs started with all 50 empty cells in their first requests. Two solved in 11 and 7 requests; the third still had 29 empty cells at the 20-request validation cutoff. All responses were fully processed. These full-range traces are in `logs/full-range-validation.json`; the earlier filtered results are not comparable model-performance measurements.

The inspector now shows probabilities for every value of the hovered or selected cell, including conflicts and previous failures. Rejected cards keep their reported probability and show a separate status. Values absent from a historical response remain unknown rather than displaying invented zeros. The `singles` count is only a post-request board statistic and no longer implies a one-option model question.

## Shared access and interface cleanup

Shared credentials now stay behind the Express API. Personal credentials enter an isolated, expiring server session through `/api/session`; subsequent model requests carry only an opaque HttpOnly cookie and a funding mode. Expired personal sessions return 401 instead of using shared funds. Aggregate usage replays the private JSONL log on startup. Public responses contain counters only. Shared spending has a reported daily threshold plus concurrency and request-rate limits.

`verify-server.ts` checks cookie flags, session isolation and disconnect, origin rejection, expired-session behavior, public responses and built assets for secret leakage, usage deduplication and replay. These checks, model-choice/batch/replay checks, lint, types and production build pass. A browser request through the shared server returned all 40 answers for a 9×9 board; 13 applied and 27 rejected. The restored histogram and placement cards rendered with that response. Info showed counters from the historical log. A later preview-host disconnect prevented checking the final copy/icon changes and mobile layout visually.

The probability grid starts collapsed and opens for a selected cell. The histogram and placement cards remain. Small interface text now has a 12 px floor; inspector tabs use 14 px. Info copy was shortened, its date removed, and the wordmark dot removed. The favicon uses vector strokes instead of tiny text glyphs.

## Direct personal access and probabilities

Personal keys now stay only in browser memory. `askJev` calls OpenRouter directly with a personal key and calls the local API only for shared access. The server has no session store or key-connect endpoint. The transport check confirms that errors cannot fall back to shared funds and that credentials do not enter exported response data. OpenRouter's decisions endpoint returned an OPTIONS response allowing this origin, POST, Authorization and Content-Type. Browser preview remains unavailable, so the final layout has not had visual QA.

Removed placement cards and the separate top probability panel. The former placements area now contains all values for one cell, selected through arrows, a dropdown or board hover. The fill width uses the actual probability; unavailable values remain unknown. The batch histogram stays. Info remains with short informal copy and server usage counters; dates and missing-cost notices are removed. Direct personal usage stays in the current run's totals and does not reach server statistics.
