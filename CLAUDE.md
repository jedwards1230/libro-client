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
service.ts          — Long-running service (polls for new books every 30s)
src/
  LibroFmClient.ts  — Main client: login, getLibrary, downloadBook, getNewBooks
  APIHandler.ts     — HTTP layer: login, library, download-manifest endpoints
  lib/
    Config.ts       — Credentials config (env vars + JSON file in data/config/)
    Directories.ts  — Path constants (data/, downloads/, logs/, cache/, config/)
    DownloadClient.ts — File download + zip extraction
    InputHandler.ts — Interactive prompts (@inquirer/* for credentials, selection)
    Logger.ts       — Winston logger + @LogMethod decorator (redacts credentials)
    Security.ts     — Secret redaction, libro.fm host check, path guards, 0600 file writes
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
and versions are reverse-engineered from the Android app (`fm.libro.librofm`).
The most current reference is the weekly APK probe in
[Bookclerk/bookclerk](https://github.com/Bookclerk/bookclerk) (`scripts/librofm-apk-probe`):
it decompiles the latest Play Store build, and its "Libro.fm API drift" issues
list the app's `/api/vN/` prefix, `versionName`, OkHttp user-agent and every
request/response field. [burntcookie90/librofm-downloader](https://github.com/burntcookie90/librofm-downloader)
is a second, hand-maintained reference (`LIBRO_FM_HEADERS` in its Dockerfile).

- **Current target: API v12, app 7.39.1, `okhttp/4.12.0`** (Oct 2026). Values live in
  `src/APIHandler.ts` (`libraryEndpoint`, `downloadEndpoint`, `userAgent`, `appVer`).
  The server also answers on `v7`–`v13`; only follow the version the app actually calls.
- **`X-LibroFm-AppVer` is required.** Since late 2025, the ELB in front of `/oauth/token`
  (and other endpoints) returns blanket `HTTP 401, content-length: 0, server: awselb/2.0`
  for requests missing this header — **regardless of credential validity**. With the
  header, bad credentials get a JSON 401 from `nginx` instead. An empty `awselb` 401 is
  the signature of the gate; it is not a stale password.
- **`User-Agent` must match a real Android app version** (`okhttp/X.Y.Z`). The app also
  sends `X-LibroFm-Device` and `X-LibroFm-OsVer`; we mirror them.
- **`download-manifest`** takes `isbn` and `client_version` (= app version). The app adds
  `format=m4b` for a single packaged file; omitting it returns the multi-part ZIP
  manifest `DownloadClient` expects.
- **v12 shape changes**: manifest tracks report `length_msec` (was `length_sec`);
  `audiobook_info.pdf_extras` is a list; `trackCount` and `audio_language_display`
  replace `track_count` and `audio_language`; `user_metadata` bookmarks and tags are
  objects; the library response adds `ebooks` and `pending_preorders`.
- **ISBNs are typed as `long` in the app** and the API has sent both strings and numbers.
  `APIHandler` normalizes them to strings so they stay valid map/state keys.
- When auth breaks, first probe `/oauth/token` with `curl` and dummy credentials: an
  `awselb` empty 401 means the header gate (bump `appVer`/`userAgent`); a JSON 401
  means headers are fine.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LIBROFM_USERNAME` | No | Libro.fm account email (fallback to interactive prompt) |
| `LIBROFM_PASSWORD` | No | Libro.fm account password (fallback to interactive prompt) |

Only the username, auth token and download directory are persisted to `data/config/config.json`
(mode `0600`; `data/` is `0700`). The password is never written to disk — a fresh login takes it
from `LIBROFM_PASSWORD` or an interactive prompt, and an old config that still holds one is
rewritten without it on the next start.

## Handling secrets

- `@LogMethod` logs every argument at `silly` level, and `silly.log` is always written. All log
  output goes through `redact()`/`scrubString()` in `src/lib/Security.ts`: sensitive keys
  (`password`, `*token*`, `Authorization`, `username`, …), bearer tokens, signed-URL query
  params, and any value passed to `registerSecret()` are replaced with `[REDACTED]`.
- A new method that takes a credential positionally must declare it:
  `@LogMethod({ scope, secretArgs: [0] })`. `Config` registers the values it holds.
- The bearer token is only sent to `https://libro.fm` and its subdomains (`isLibroFmUrl`);
  CDN part URLs are fetched without it.
- Folder names built from API metadata go through `safePathSegment`, and writes are checked
  with `isWithin` (download dir, cache dir, zip entries).
- `.dockerignore` excludes `data/` — never bake `data/config` or `data/logs` into an image.
