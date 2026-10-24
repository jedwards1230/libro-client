# Libro.fm CLI Tool

This is a simple command-line tool for interacting with your Libro.fm library. It allows you to:

- List all audiobooks in your library
- Download audiobooks to your computer
- Check for new audiobooks in your library
- Run as a background service

## Command-line interface

### Installation

Build the standalone CLI binary (requires [Bun](https://bun.sh)):

```bash
bun install
bun run build:cli   # outputs bin/libro
```

Then either run `bin/libro` directly or add `bin/` to your `PATH`:

```bash
./bin/libro
```

### List audiobooks

To list all audiobooks in your library, run the following command:

```bash
libro list
```

This will print a list of audiobook titles to the console.

### Download audiobooks

To download a specific audiobook, run the following command:

```bash
libro get [...isbns]
```

To choose an audiobook from your library, run the following command:

```bash
libro get
```

Replace `[...isbns]` with the ISBN of the audiobook you want to download. You can find the ISBN by running the list command.

If you don't specify an ISBN, the tool will prompt you to select an audiobook from your library.

### Check for new audiobooks

To check for new audiobooks in your library, run the following command:

```bash
libro check
```

This will print a list of new audiobooks to the console. You can also use the --json flag to output the data as JSON.

## Background service

The tool can also be run as a background service. This is useful if you want to automatically download new audiobooks as they become available in your library.

To run the service, you can use Docker or another process manager.

### Docker

To run the service using Docker, use the following command:

```bash
docker build -t libro .
docker run -d libro
```

Or use the provided `docker-compose.yml` file:

```bash
docker-compose up -d
```

### Metrics

The service exposes Prometheus metrics at `GET /metrics` (text format 0.0.4) on `0.0.0.0:9464`. Set `METRICS_PORT` to change the port. If the port is already taken the service logs a warning and keeps syncing without it.

The endpoint is **unauthenticated** and meant to be reached only from inside the cluster or a trusted network; do not publish the port to the internet.

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `libro_last_successful_sync_timestamp_seconds` | gauge | none | Unix time a full library scan last completed with no error, whether or not it found new books. A scan that throws, or whose library fetch failed, does not count. `0` until the first success. |
| `libro_last_scan_timestamp_seconds` | gauge | none | Unix time the last scan attempt finished, successful or not. `0` until the first scan finishes. |
| `libro_scans_total` | counter | `result` = `success` or `error` | Scans finished, by result. |
| `libro_books_downloaded_total` | counter | none | Books downloaded. |
| `libro_errors_total` | counter | `stage` = `scan` or `download` | Errors, by stage. |
| `libro_library_fetch_errors_total` | counter | none | Library fetch errors. The client swallows these (it clears its auth token and returns an empty library instead of throwing), so each one also makes that scan count as an error. |

To alert on a stalled sync, use the age of the last success. It reads as a huge number (the current Unix time) if a sync has not succeeded since the process started:

```promql
time() - libro_last_successful_sync_timestamp_seconds
```

Pair it with the error counters (`libro_scans_total{result="error"}`, `libro_errors_total`, `libro_library_fetch_errors_total`) to see failures as they happen rather than once the age threshold is crossed.

### Logging

The service writes one JSON object per line to stdout, so each event is a single log entry:

```json
{"ts":"2026-10-23T21:06:00.123Z","level":"error","logger":"service","msg":"Sync run failed: Not logged in","error":"Not logged in","stack":"Error: Not logged in\n    at getLibrary (...)"}
```

`ts` is RFC3339, `level` is one of `error`, `warn`, `info`, `debug`, `logger` is a stable scope (`service`, `metrics`, `LibroFmClient`, ...), and `msg` is the message. Errors also carry `error` (the message) and `stack` (the whole stack as one string). The interactive CLI keeps its human-readable output, and the files in `data/logs/` use the same JSON lines.

## Configuration

You can set the following environment variables:

```bash
DEBUG=true                          # enable debug-level logging (default: off)
LIBROFM_USERNAME=<your_username>    # Libro.fm account email
LIBROFM_PASSWORD=<your_password>    # Libro.fm account password
METRICS_PORT=9464                   # port for the service's Prometheus /metrics endpoint (default: 9464)
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, build/test commands, and the PR workflow.

## Disclaimer

This tool is not affiliated with Libro.fm in any way. Use it at your own risk.
