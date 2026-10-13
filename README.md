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

### Listening history

To see your listening history for each title, run:

```bash
libro history                                  # whole library, most recently played first
libro history 9780593135204                    # one or more ISBNs
libro history --format csv -o history.csv      # spreadsheet export
libro history --format json -o history.json    # full detail, including every bookmark
```

For each title it shows:

| Field | Meaning |
| --- | --- |
| `added_at` | When the title was added to your library |
| `last_played_at` | When the app last synced a listening position (Libro.fm's `last_touched_at`) |
| `finished` | Whether the app marked the title finished |
| `track`, `track_seconds` | Current position: track number (from 1) and seconds into it |
| `position_seconds`, `progress_percent` | Position from the start of the book; only for titles downloaded with this tool, since it needs the track lengths |
| `duration_seconds` | Length of the book |
| bookmarks | Count in text and CSV; the JSON has each bookmark's track, time, note and creation date |
| `tags` | Your library tags |

Libro.fm's API has no endpoint that returns individual listening sessions (the app uploads them but never reads them back), so the history is the latest state for each title, not a log of every session. Files written with `-o` are readable only by you. Use `-o` rather than `>` the first time you log in, so the login prompt doesn't end up in the file.

## Background service

The tool can also be run as a background service. This is useful if you want to automatically download new audiobooks as they become available in your library. It downloads up to 4 new books at a time (`LIBROFM_PARALLEL_DOWNLOADS`), so the first run on a large library takes a while; checks that come due meanwhile are skipped.

To run the service, you can use Docker or another process manager.

Give the service `LIBROFM_USERNAME` and `LIBROFM_PASSWORD` (for Docker, in `.env`). When a request fails, the saved session token is dropped and the service logs in again with these before the next check. Without them it can't log in again and keeps reporting "Not logged in" until you restart it.

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


## Configuration

You can set the following environment variables:

```bash
DEBUG=true                          # enable debug-level logging (default: off)
LIBROFM_USERNAME=<your_username>    # Libro.fm account email
LIBROFM_PASSWORD=<your_password>    # Libro.fm account password
LIBROFM_POLL_MINUTES=15             # background service: minutes between library checks (default: 15)
LIBROFM_PARALLEL_DOWNLOADS=4        # background service: new books downloaded at the same time (default: 4)
```

### Where your credentials go

- Your password is only sent to `https://libro.fm/oauth/token`. It is never written to disk: after
  the first login, only your username and the session token are kept in `data/config/config.json`,
  readable by your user only.
- Logs in `data/logs/` redact passwords, tokens and signed download links.
- The Docker image never includes `data/`; mount it as a volume (see `docker-compose.yml`).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, build/test commands, and the PR workflow.

## Disclaimer

This tool is not affiliated with Libro.fm in any way. Use it at your own risk.
