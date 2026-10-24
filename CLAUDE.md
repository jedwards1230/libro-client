# libro-client

@CONTRIBUTING.md

Audiobook downloader and service for Libro.fm. Downloads audiobooks from the Libro.fm API, tracks local state, and supports both interactive CLI usage and automated service mode.

## Running locally

```bash
# Run CLI
bun run cli.ts <command>

# Run as background service (polls every 30s)
bun run service.ts
```

## Architecture

```
cli.ts              — CLI entry point (yargs commands: list, get, check)
service.ts          — Long-running service (polls for new books every 30s, serves /metrics)
src/
  LibroFmClient.ts  — Main client: login, getLibrary, downloadBook, getNewBooks
  APIHandler.ts     — HTTP layer: login, library, download-manifest endpoints
  lib/
    Config.ts       — Credentials config (env vars + JSON file in data/config/)
    Directories.ts  — Path constants (data/, downloads/, logs/, cache/, config/)
    Backoff.ts      — Exponential backoff for login attempts (1 min doubling to 30 min)
    DownloadClient.ts — File download + zip extraction
    InputHandler.ts — Interactive prompts (@inquirer/* for credentials, selection)
    LogFormat.ts    — One-JSON-line log formatting (pure; used by Logger.ts and the service)
    Logger.ts       — Winston logger + @LogMethod decorator
    Metrics.ts      — Hand-rolled Prometheus registry + /metrics server (no dependencies)
    State.ts        — Local book state (data/config/state.json)
  types.d.ts        — Global TypeScript types (Audiobook, AudiobookMap, etc.)
```

### Data Flow

1. `Config` loads credentials from env (`LIBROFM_USERNAME`, `LIBROFM_PASSWORD`) or `data/config/config.json`
2. `LibroFmClient.init()` logs in via `APIHandler` if no authToken, saves token to config
3. CLI commands call `client.getLibrary()` -> `APIHandler.fetchLibrary()` -> paginated API
4. `client.downloadBook()` -> `APIHandler.fetchDownloadMetadata()` -> `DownloadClient.downloadFiles()`
5. `State` tracks downloaded ISBNs in `data/config/state.json`

### External Dependencies

- **Libro.fm API**: `https://libro.fm` — OAuth2 password grant, REST endpoints.
  Proprietary — see "Libro.fm API gotchas" below.
- **Bun**: Runtime and bundler (no Node.js required)
- **TypeScript**: Strict mode, `noEmit: true`, path alias `@/*` -> `src/*`

## Libro.fm API gotchas

Libro.fm publishes no API and ships no open-source client; endpoints, headers,
and versions are reverse-engineered from the Android app. The actively-maintained
reference is [burntcookie90/librofm-downloader](https://github.com/burntcookie90/librofm-downloader)
— check its Dockerfile (`LIBRO_FM_HEADERS=...`) for the current required header values.

- **`X-LibroFm-AppVer` is required.** Since late 2025, the ELB in front of `/oauth/token`
  (and other endpoints) returns blanket `HTTP 401, content-length: 0, server: awselb/2.0`
  for requests missing this header — **regardless of credential validity**. Identical
  401s for valid and bogus credentials is the signature of this gate; it is not a stale
  password. Current values live in `src/APIHandler.ts` (`userAgent`, `appVer`).
- **`User-Agent` must match a real Android app version** (`okhttp/X.Y.Z`).
- **API version drift**: this client uses `v7/v9`; burntcookie90 has moved to `v10`.
  Both work today — if `v7/v9` start 404/410ing, bump to `v10`.
- When auth breaks, first test `/oauth/token` with `curl` using the headers from
  burntcookie90's Dockerfile; if that succeeds, update `APIHandler.ts` to match.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LIBROFM_USERNAME` | No | Libro.fm account email (fallback to interactive prompt) |
| `LIBROFM_PASSWORD` | No | Libro.fm account password (fallback to interactive prompt) |
| `METRICS_PORT` | No | Port for the service's Prometheus `/metrics` endpoint (default `9464`; invalid values warn and fall back) |

Credentials are persisted to `data/config/config.json` after first successful login. Auth tokens are also cached there.

## Metrics

`service.ts` starts `startMetricsServer()` (`src/lib/Metrics.ts`) before anything else: `GET /metrics` on `0.0.0.0:${METRICS_PORT ?? 9464}`, Prometheus text format 0.0.4, no dependencies. `404` for other paths, `405` for non-GET. If the port is taken it logs a warning and the sync loop carries on. The endpoint is **unauthenticated and cluster-internal**; never expose it publicly.

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `libro_last_successful_sync_timestamp_seconds` | gauge | none | Unix time a scan last completed with no error: `client.getNewBooks()` returned and no library fetch error was swallowed during it. With or without new books. `0` until the first success |
| `libro_last_scan_timestamp_seconds` | gauge | none | Unix time the last scan attempt finished, success or not. `0` until the first scan finishes |
| `libro_scans_total` | counter | `result`: `success`, `error` | Scans finished (both series start at 0) |
| `libro_books_downloaded_total` | counter | none | Books actually downloaded |
| `libro_errors_total` | counter | `stage`: `scan`, `download` | Errors by stage (both series start at 0) |
| `libro_login_total` | counter | `result`: `success`, `error` | Login attempts (both series start at 0) |
| `libro_library_fetch_errors_total` | counter | none | Library fetch errors swallowed by `LibroFmClient.getLibrary()` |

These names are a contract with the alert rules that consume them; do not rename them. Event-to-series logic lives in `createLibroMetrics()` (`trackScan`, `recordLibraryFetchError`, `recordDownload`, `recordDownloadError`) so it is tested without importing `service.ts`, which starts the loop on import.

`LibroFmClient.getLibrary()` swallows a library-fetch error: it clears the auth token and returns an empty library instead of throwing. It records `libro_library_fetch_errors_total`, and `service.ts` runs each scan through `metrics.trackScan()`, which counts the scan as an error if it threw **or** if a fetch error was swallowed during it. So the last-success gauge only advances on a real sync. Alert on `time() - libro_last_successful_sync_timestamp_seconds` together with the error counters.

## Re-login (service only)

`service.ts` builds the client with `autoRelogin: true`; the CLI does not, and keeps its old behaviour exactly (login in `init()` only, `Not logged in` thereafter). In service mode `getLibrary()`:

1. If there is no token, calls `ensureLoggedIn()` first (stored credentials from env or `config.json`; no prompt).
2. If the fetch fails with HTTP 401/403 (`ApiError.status`, see `isAuthError()` in `APIHandler.ts`) and it has not logged in during this call, clears the token, logs in once and retries the page once. A recovered scan is a normal success.
3. Any other failure, or a rejection of a freshly issued token, takes the old swallow path (token cleared, empty library, counted as a failed scan) and also records a failure on the login `Backoff`.

`ensureLoggedIn()` refuses to attempt a login while the backoff is running (1 min, doubling to 30 min; reset after a fetch succeeds), so the scan fails with `Not logged in; next login attempt in Ns` and a bad password or an API gate cannot hammer the login endpoint. At most one login per scan.

## Logging

The service logs one JSON object per line on stdout (`useJsonConsole()` + `createJsonLog()`; `src/lib/LogFormat.ts`). Fields suit the log shipper (Grafana Alloy): `ts` (RFC3339), `level` and `logger` (a stable scope), which become labels, and `msg`. Errors add `error` (message) and `stack` (one string). The shipper stores only `msg`, so `msg` includes the error text (`Sync run failed: Not logged in`); the full `error`/`stack` fields are in the raw stdout line.

Credentials never reach the logs: `redactFormat` runs on the winston logger itself (so on every transport and on `data/logs/*.log`), masking values under keys named like `password`, `token`, `authorization`, `secret` or `key`, plus `Bearer` credentials and JSON-encoded bodies; `@LogMethod` also masks positional arguments by parameter name. All of it is in `src/lib/LogFormat.ts`.

The CLI stays human-readable: `Logger.ts` switches the console to JSON only when `useJsonConsole()` is called (the service does; `cli.ts` does not), because TTY detection would wrap piped output such as `libro check --json | jq`. The `data/logs/*.log` files are JSON lines for both. Do not use `console.*` in the service or `Metrics.ts`: Bun prints a source excerpt for `console.error(error)`, which splits one event over many lines.
