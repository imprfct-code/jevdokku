# jevdokku

A Vite+ / React experiment with Jev 1.13. Visual styles follow Pixel and Imperfect Log: near-black surfaces, rose accents, Geist Mono and Geist Pixel.

## Run

```sh
pnpm install
pnpm run dev
```

Open http://localhost:4444. Use `PORT` for another port.

The server accepts either `OPEN-ROUTER-API-KEY` or `OPENROUTER_API_KEY` in `.env`. It connects automatically. The shared key stays on the server and only leaves it in the server-to-OpenRouter authorization header. It never enters browser requests, public API responses, run exports or the client bundle. Visitors can connect a personal key in Settings. It stays only in the current tab's memory. Personal requests go directly from the browser to OpenRouter with no cookies, server proxy, localStorage or sessionStorage. Disconnect or reload clears the key. Errors never fall back to shared funds. Request and response previews and exports omit credentials.

```sh
pnpm run check
pnpm run build
pnpm start
```

Use `vp run dev`, not `vp dev`, to start both the app and local API with the global Vite+ CLI.

## Boards

Enter any integer side length from 2 to 64. A valid edit immediately regenerates the board. The app chooses the nearest factor pair for rectangular boxes: 12 uses 3×4, 25 uses 5×5, 32 uses 4×8. Prime sizes use 1×N boxes, which gives Latin-square constraints. Values display as decimal numbers.

Generation runs in a worker. Every generated board has exactly one solution. Up to size 16, a clue is removed only when exhaustive search proves uniqueness; a search budget cutoff rejects the removal. Above 16, the generator removes random clues, then restores clues until naked and hidden singles prove a complete solution. Each such deduction is required in every completion, which proves uniqueness. A separate check rejects a puzzle unless at least a quarter of its empty cells remain unresolved after exhausting naked singles. This prevents simple candidate filtering from solving the whole board. A hidden single requires comparing candidate locations across a row, column or box even though its cell has multiple candidates.

Large size does not imply high logical difficulty. These puzzles require hidden singles but do not require search or advanced solving techniques. Difficulty controls the initial removal density, not a rated human solving technique or a guaranteed final clue count. The completed board and uniqueness deductions stay inside generation and are never sent to Jev.

The canvas fits the board and zooms up to 16×. Hold the middle mouse button and drag to pan. Left-button and touch dragging also work. The wheel or pinch zooms around the pointer; double-click or the percentage button fits the board. Hovering previews a cell until a click pins its probabilities. Clicking another cell replaces the selection. Dense boards use marks at low zoom and show numbers when enlarged.

## Batches

Settings allow up to 128 cells per request. Targets are the first empty cells in board order, without preferring forced cells or excluding cells that share a row, column or box. A limit of 64 covers every empty cell on a 9 by 9 puzzle with at most 64 blanks. Each question offers every number from 1 to the board size, including locally invalid and previously rejected values, so Jev returns a complete distribution. Large requests may reduce the cell count to fit the context budget; the request heading marks that reduction.

The app checks every returned answer, applies legal placements and records rejection reasons for invalid or conflicting choices. It never stops processing the response at the first contradiction. The export also preserves the complete proposed board before validation. A correct complete guess can finish the puzzle in one request.

Empty candidate lists and two forced copies of a digit in one unit trigger rollback before another request. A failed branch removes moves back to the last speculative placement; it never fills an alternative itself. Failed choices cannot be applied again while their earlier assumptions hold, but remain in Jev's probability distribution. The request includes feedback asking Jev to avoid those choices. Changing the assumptions releases the restriction. Exhausting all legal candidates rolls back an earlier assumption. Every new value comes from a model choice. A batch with no valid placements pauses the run.

Space starts recorded playback from the beginning or pauses it. Arrow keys move between recorded batches. Playback stops at the last saved batch without issuing new requests, including for unfinished runs. With no saved batches, Space starts solving. Shortcuts ignore text inputs and the settings dialog.

Recorded navigation shows the selected board immediately. Pink marks additions; crossed-out amber digits mark removals or replacements. During a live request, the canvas keeps the last committed snapshot and updates once when the response applies. Only the background tint animates, with a short cancellable transition. Model suggestions that were not applied never appear as placed digits. The probabilities section replaces placement cards. Click a board cell to pin its probabilities. Hovering other cells does not replace a pinned selection. Dragging, zooming and pinch gestures do not select cells. Each number has its reported probability and a proportional fill; the model's choice has a rose border. Conflicting and rejected values stay visible with a strike through the number. Animation speed includes an instant option. History replays saved batches without new model calls. Payload shows the exact OpenRouter JSON request and response. Export includes all board states, placements, metadata, tokens and reported costs. The bottom bar totals the entire run, even while replaying an earlier batch. The probabilities section has no separate token or cost footer. Raw requests, responses and failures are appended to `logs/requests.jsonl`, with request and run IDs and no authorization headers. These logs stay local and are ignored by Git. Totals use provider-reported usage; an aborted request can incur an unreported charge.

Mean p is the arithmetic mean of selected-value probabilities; min p is the lowest. The histogram groups those probabilities into ten bins. None is a joint probability that the whole batch is correct. The probabilities section shows all 1–N values for the selected cell, including conflicting values. Crossed-out digits identify local conflicts or known failed choices without changing their reported probabilities. Cells outside the selected batch show no response, never invented zero probabilities.

For boards whose serialized state exceeds 16,000 characters, requests use the target cells' rows, columns and boxes instead of the full board. These batches are marked `local context`. Large boards also reduce target count automatically. A 48,000-character request budget adds a conservative context guard; it is an estimate, not a tokenizer. Provider limits can still reject a request.

The 64-cell side limit bounds browser memory. Jev also limits each Choice to 255 options. Large puzzles can still be slow or fail; a valid partial board does not prove that its current branch is solvable.

Settings contain the OpenRouter key and batch size. Rate limits during auto-run wait before retrying, respecting Retry-After with increasing delays and at most five consecutive retries. Other errors stop the run. Pause aborts the client request, though the provider may already have billed it.

Jev supplies choices and probabilities, not written reasoning.

## Server and shared access

`pnpm run build && pnpm start` serves the client and API from the same Express process. Production binds to `0.0.0.0`; set `HOST` and `PORT` as needed. Serve the public site over HTTPS. This change prepares local hosting; it does not publish the app.

`PUBLIC_DAILY_BUDGET_USD` defaults to 1. Set it to 0 to disable shared access. The server stops starting shared requests after reported daily spending reaches that amount. In-flight requests and unreported provider charges can exceed it, so use the provider's key spending limit for a billing cap. Personal requests do not consume the shared budget. Shared access allows at most two simultaneous upstream requests and defaults to 60 requests per minute per IP with `PUBLIC_REQUESTS_PER_MINUTE`. Behind a reverse proxy, Express sees the proxy IP unless a trusted proxy is configured for that deployment; the default rate limit then applies across its visitors. These limits bound casual use, not all automated abuse.

`/api/stats` exposes aggregate server request counts, tokens and reported costs. Info shows those counters below a short note about the experiment. Direct personal-key requests appear in the current run totals and exports, but never reach the server ledger. The server rebuilds them from `logs/requests.jsonl` on startup; retain that directory on a persistent volume. Run counts include partial runs and historical local checks, not just solved boards. Statistics currently support one server process. The server never receives personal keys or personal request payloads. Shared request payloads and model responses enter its log, so keep the log directory private.

## Validation

Generation, box constraints, request sizing and batch application were checked at sizes 2, 4, 6, 7, 9, 12, 16, 25, 36, 64, 100, 128 and 256. Authenticated Jev runs solved 4×4 and 9×9 test boards. Individual live batches were checked at 25×25 and 128×128; those entire large boards were not solved during validation.

References: [Pixel](https://pixel.imprfct.dev/), [Imperfect Log](https://log.imprfct.dev/feed), [Jev](https://openrouter.ai/typesafe/jev-1.13), [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice).
