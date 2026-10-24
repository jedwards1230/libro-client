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
| `LIBRO_VERSION` | No | Reported as the `version` label of `libro_info`. The Docker build sets it from the release version; otherwise `unknown` |

Credentials are persisted to `data/config/config.json` after first successful login. Auth tokens are also cached there.

## Metrics

`service.ts` starts `startMetricsServer()` (`src/lib/Metrics.ts`) before anything else: `GET /metrics` on `0.0.0.0:${METRICS_PORT ?? 9464}`, Prometheus text format 0.0.4, no dependencies. `404` for other paths, `405` for non-GET. If the port is taken it logs a warning and the sync loop carries on. The endpoint is **unauthenticated and cluster-internal**; never expose it publicly.

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `libro_last_successful_sync_timestamp_seconds` | gauge | none | Unix time `client.getNewBooks()` last returned without throwing, with or without new books. `0` until the first success |
| `libro_last_scan_timestamp_seconds` | gauge | none | Unix time the last scan attempt finished, success or not. `0` until the first scan finishes |
| `libro_scans_total` | counter | `result`: `success`, `error` | Scans finished (both series start at 0) |
| `libro_books_downloaded_total` | counter | none | Books actually downloaded |
| `libro_errors_total` | counter | `stage`: `scan`, `download` | Errors by stage (both series start at 0) |
| `libro_info` | gauge | `version` | Always 1 |

These names are a contract with the alert rules that consume them; do not rename them. Event-to-series logic lives in `createLibroMetrics()` (`recordScanSuccess`, `recordScanError`, `recordDownload`, `recordDownloadError`) so it is tested without importing `service.ts`, which starts the loop on import.

Known limitation: "successful" means `getNewBooks()` did not throw. `LibroFmClient.getLibrary()` swallows library-fetch errors (it clears the auth token and returns an empty library), so the first scan after such a failure counts as a success; the scans after it throw `Not logged in` and count as errors.

## Logging

The service logs one JSON object per line on stdout (`useJsonConsole()` + `createJsonLog()`; `src/lib/LogFormat.ts`). Fields follow the Grafana Alloy `json_processor` the log shipper uses: `ts` (RFC3339), `level` (becomes a Loki label), `logger` (stable scope, also a label), `msg`. Errors add `error` (message) and `stack` (one string). Alloy stores only `msg` in Loki, so `msg` includes the error text (`Scan failed: Not logged in`); the full `error`/`stack` fields are in the raw line (`kubectl logs`).

The CLI stays human-readable: `Logger.ts` switches the console to JSON only when `useJsonConsole()` is called (the service does; `cli.ts` does not), because TTY detection would wrap piped output such as `libro check --json | jq`. The `data/logs/*.log` files are JSON lines for both. Do not use `console.*` in the service or `Metrics.ts`: Bun prints a source excerpt for `console.error(error)`, which splits one event over many lines.
