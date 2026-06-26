@CONTRIBUTING.md

# libro-client

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
service.ts          — Long-running service (polls for new books every 30s)
src/
  LibroFmClient.ts  — Main client: login, getLibrary, downloadBook, getNewBooks
  APIHandler.ts     — HTTP layer: login, library, download-manifest endpoints
  lib/
    Config.ts       — Credentials config (env vars + JSON file in data/config/)
    Directories.ts  — Path constants (data/, downloads/, logs/, cache/, config/)
    DownloadClient.ts — File download + zip extraction
    InputHandler.ts — Interactive prompts (@inquirer/* for credentials, selection)
    Logger.ts       — Winston logger + @LogMethod decorator
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

Credentials are persisted to `data/config/config.json` after first successful login. Auth tokens are also cached there.

