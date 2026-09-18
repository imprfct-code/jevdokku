# Deployment audit

Checked on 2026-09-18. No deployment or application changes made. Tests used a separate production process on 127.0.0.1:4445 with shared access disabled and no copy of the project credentials or logs.

## Before public launch

### Production dependencies do not support the start command

`package.json:11` starts `tsx server.ts`, but `tsx` is a dev dependency. `server.ts:4` also imports `vite-plus` at runtime, including in production; it is another dev dependency.

Reproduced in a clean temporary directory: `pnpm install --prod --offline --frozen-lockfile` succeeds, then `pnpm start` fails with `tsx: command not found`. Production starts with the full dependency tree.

Build a standalone server artifact with production runtime dependencies, or explicitly include the required runtime packages. Pin a supported Node version. Vite+ currently declares Node `^20.19.0 || ^22.18.0 || >=24.11.0`; the local checks ran on Node 26.5.0, macOS. Linux hosting has not been tested.

### Shared usage needs persistent storage and a single-instance policy

`server.ts:11` and `server/usage.ts:6` reconstruct counters and daily spending from `logs/requests.jsonl`. An ephemeral deployment can lose both historical statistics and the application budget ledger. Read-only storage prevents startup. A write failure after startup prints a console error but allows paid requests to continue; those charges can disappear from the ledger after restart.

The file has no rotation, and per-request identifiers accumulate in memory. The current log is about 6 MB. Rate limits, concurrency and budget state are per process, so multiple replicas do not enforce a shared global limit.

For a small first release, a single process with a private persistent volume and backups is enough. Multiple replicas need shared, atomic accounting. Do not copy local experiment logs accidentally if public statistics should start at zero.

Set a spending limit on the provider key before enabling shared access. The application's default $1/day threshold only uses reported cost. In-flight requests and requests aborted before usage arrives can exceed it. No reconciliation with provider charges is implemented.

### Reverse-proxy behavior must match the chosen host

The app does not configure Express `trust proxy`. Behind a proxy, the IP limiter may group every visitor under the proxy's IP. `server.ts:34` compares Origin to the incoming Host. If the proxy uses the backend hostname, legitimate browser requests fail with 403.

Reproduced by sending a public Origin and forwarded host with a backend Host. Configure an explicit public origin and trust only the deployment's known proxy path, or preserve Host appropriately. Do not blindly trust arbitrary forwarded headers. Configure HTTPS at the host/proxy.

### Deployment configuration is still absent

No deployment manifest, container setup, pinned Node version, health endpoint, process restart policy or CI workflow is present. The workspace is not a Git repository. `/api/health` returns 404. There is no graceful shutdown handler to drain outstanding provider requests.

Choose the deployment target and document the exact build/start commands, secrets, writable data path, domain, health check and rollback procedure. The current layout assumes a dedicated origin root: API, assets and icon URLs are absolute. Hosting under a path prefix needs changes.

## Follow-up before wider traffic

- Rate limiting runs after board validation and candidate calculation, so it does not protect that work. A blank 64×64 request took about 23 ms locally before returning 401. Move cheap access and request-rate checks ahead of expensive work; bound rejected-choice input separately. Origin checks are not authentication and cannot prevent external callers spending the intentionally shared budget.
- Normal production responses have no CSP or `X-Content-Type-Options`. Add suitable browser security headers, keeping direct OpenRouter requests and the generation worker functional.
- Malformed JSON returns Express's HTML error page. The client always parses API responses as JSON, so proxy errors or HTML responses produce a parsing error instead of a useful message. Add consistent API errors and client handling for non-JSON failures.
- Final UI changes and real browser requests with a personal key still need browser QA. The preview automation host was unavailable. The direct transport is covered by a fetch-level check, and the OpenRouter decisions endpoint previously passed a CORS preflight check; that is not a full browser end-to-end test.
- Personal requests intentionally bypass the server. Their spending appears in the current browser run and export, not the public shared-access counters. Reloading clears the personal key and unsaved run.

## Checks completed

- `pnpm run check` and `pnpm run build` pass.
- Generation checks pass at all three densities for sizes 2, 3, 4, 6, 7, 9, 12, 16, 17, 25, 31, 32 and 64. Small-board uniqueness and large-board propagation checks pass.
- Batch selection, full candidate distributions, rejected-choice handling and replay checks pass.
- Server checks pass for direct personal-key routing, no shared fallback, absence of server key sessions, origin rejection, credential isolation and usage replay.
- Both production-only and full dependency audits report zero known advisories at audit time.
- A production process using the full dependency tree serves the page, JavaScript, CSS and SVG successfully. Config and statistics respond without secrets. Requests for `.env`, `server.ts` and `logs/requests.jsonl` return 404.
- No new paid inference requests were needed for this audit. The only authenticated provider request read the existing key limit.
