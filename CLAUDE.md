# libro-client

Audiobook downloader and service for Libro.fm. Downloads audiobooks from the Libro.fm API, tracks local state, and supports both interactive CLI usage and automated service mode.

## Quick Start

```bash
# Install dependencies
bun install

# Type check (no emit)
bunx tsc --noEmit

# Run CLI
bun run cli.ts <command>

# Run as background service (polls every 30s)
bun run service.ts

# Build standalone binary
bun run build:cli

# Build Docker image
bun run build:docker
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

- **Libro.fm API**: `https://libro.fm` — OAuth2 password grant, REST endpoints
- **Bun**: Runtime and bundler (no Node.js required)
- **TypeScript**: Strict mode, `noEmit: true`, path alias `@/*` -> `src/*`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LIBROFM_USERNAME` | No | Libro.fm account email (fallback to interactive prompt) |
| `LIBROFM_PASSWORD` | No | Libro.fm account password (fallback to interactive prompt) |

Credentials are persisted to `data/config/config.json` after first successful login. Auth tokens are also cached there.

## Hooks

Hooks live in `.claude/hooks/` and fire at key points in Claude Code sessions.

- `session-start.sh` — Detects Claude Code Web; installs bun if missing, then runs `bun install`
- `pre-tool-use.sh` — Logs tool name; exits 0 (no blocking)
- `post-tool-use.sh` — Stub; no auto-formatter configured yet
- `stop.sh` — Runs `bunx tsc --noEmit` to type-check after every response
- `subagent-stop.sh` — Stub
- `session-end.sh` — Stub
