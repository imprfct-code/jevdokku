# jevdokku

Watch Jev solve Sudoku, one batch at a time. Inspect its choices, compare probabilities, and replay the moves that worked—or led to a dead end.

[**Open the app → jev.imprfct.dev**](https://jev.imprfct.dev)

An experiment built with React, TypeScript, Vite+, and [Jev 1.13](https://openrouter.ai/typesafe/jev-1.13) through OpenRouter.

## Features

- Generate puzzles with a unique solution, from 2×2 to 64×64.
- Request up to 128 cell choices per batch, with probabilities for every possible value.
- Inspect accepted moves, rejected choices, and backtracking on a zoomable board.
- Replay recorded batches without making new model requests.
- View request payloads, token usage, and reported costs; export runs as JSON.
- Use a personal OpenRouter key or an optional shared server key.

## Quick start

Requires Node.js 24.11 or later in the 24.x series and pnpm 10.30.1.

```sh
git clone https://github.com/imprfct-code/jevdokku.git
cd jevdokku
pnpm install --frozen-lockfile
pnpm dev
```

Open [localhost:4444](http://localhost:4444), connect an OpenRouter key in **Settings**, and start a run. Model requests require OpenRouter access and credits. Generating and exploring a board does not require a key.

To enable shared access, copy `.env.example` to `.env`, fill in the server key, and restart the development server:

```sh
cp .env.example .env
```

Use `pnpm dev` or `vp run dev` to start both the interface and API. `vp dev` alone starts only the frontend.

## Configuration

| Variable                         | Default                                             | Purpose                                                                         |
| -------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`             | Unset                                               | Server key for shared access. Local Express also accepts `OPEN-ROUTER-API-KEY`. |
| `PUBLIC_DAILY_BUDGET_USD`        | `5`                                                 | Daily reported spending threshold in USD. `0` disables shared access.           |
| `PUBLIC_REQUESTS_PER_MINUTE`     | `600`                                               | Shared request limit: site-wide in Convex, per IP in local Express.             |
| `PUBLIC_MAX_CONCURRENT_REQUESTS` | `20`                                                | Simultaneous shared requests, configurable from 1 to 100.                       |
| `ALLOWED_ORIGINS`                | Unset                                               | Comma-separated allowed website origins for the Convex API.                     |
| `PORT`                           | `4444`                                              | Local Express HTTP port.                                                        |
| `HOST`                           | `localhost` in development; `0.0.0.0` in production | Local Express listening interface.                                              |

Personal keys stay in the current tab's memory and are sent directly to OpenRouter. Reloading or disconnecting clears them; failed personal requests never fall back to the shared key. The shared key is used only by the server. Keep credentials in `.env` locally and in secret environment variables on the host; never use a `VITE_` prefix for secrets.

The daily budget uses provider-reported costs, so concurrent or interrupted requests can exceed it. Set a spending limit on the OpenRouter key as well.

## How it works

A browser worker generates the puzzle and verifies uniqueness. Jev receives the puzzle context and chooses values for a batch of empty cells. The application validates every returned choice, applies legal moves, and backtracks when it detects a dead end. The generator's solution is never sent to the model, and every new placement during solving comes from a model choice.

This is an experiment, not a guaranteed solver or a model benchmark. Larger boards can be slow or remain unfinished. Difficulty changes clue density rather than assigning a human difficulty rating. Reported probabilities describe individual choices, not the probability that the entire board is correct.

Select a cell to pin its probabilities. Drag to pan, scroll or pinch to zoom, and double-click to fit the board. Arrow keys step through recorded batches; Space starts or pauses playback, or starts solving when no history exists.

## Development

```sh
pnpm check       # Formatting, lint, and type checks
pnpm test        # Cloud API and accounting tests
pnpm build       # TypeScript checks and production client build
pnpm start       # Serve the built client and API
```

Focused verification scripts live in [`scripts/`](scripts/). For example:

```sh
pnpm exec tsx scripts/verify-batches.ts
pnpm exec tsx scripts/verify-model-choices.ts
pnpm exec tsx scripts/verify-replay.ts
```

| Location                                                | Responsibility                                           |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `src/App.tsx`, `src/BoardCanvas.tsx`                    | Run controls, playback, and board rendering.             |
| `src/sudoku.ts`, `src/generateLarge.ts`                 | Puzzle generation, validation, and backtracking.         |
| `src/protocol.ts`, `src/jev.ts`                         | Model payloads, response parsing, and request transport. |
| `server.ts`, `server/usage.ts`                          | Shared API access, limits, and usage accounting.         |
| `convex/http.ts`, `convex/usage.ts`, `convex/schema.ts` | Production API and persistent accounting.                |

## Deployment

Production uses **Vercel** for the frontend and **Convex** for the API and database. Vercel forwards `/api/*` to Convex; the shared OpenRouter key stays in Convex. Usage counters, daily spending, and request limits persist across deployments. The cloud database stores accounting metadata, not raw puzzle payloads or model responses.

Deployments are **manual**. Pushing a commit does not publish it.

1. Push your branch to this repository.
2. Open [Actions → Deploy production](https://github.com/imprfct-code/jevdokku/actions/workflows/deploy.yml).
3. Click **Run workflow**, select the branch, and confirm.

The workflow checks and tests the selected revision, builds the frontend, deploys Convex, and publishes Vercel. Runs share a production concurrency group. Every branch targets the same website and database; keep backend/schema changes compatible with the currently live frontend. The selected branch must contain the workflow. The Vercel Git integration is disconnected, and auto-deployment is also disabled in `vercel.json`.

GitHub Actions uses repository secrets `VERCEL_TOKEN` and `CONVEX_DEPLOY_KEY`, plus variables `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. Application secrets and limits belong in the Convex production environment. Keep production keys out of `.env.example`, source code, and client build variables.

For local backend development, `pnpm dev:convex` selects a separate development deployment. `pnpm dev` continues to run the standalone Express backend with local accounting in the Git-ignored `logs/` directory. Production logs are not copied into local development or vice versa.

## Credits

Model: [Jev](https://openrouter.ai/typesafe/jev-1.13) and [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice). Visual inspiration: [Pixel](https://pixel.imprfct.dev/) and [Imperfect Log](https://log.imprfct.dev/feed). Typography: Geist Mono and Geist Pixel.
