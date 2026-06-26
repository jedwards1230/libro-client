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


## Configuration

You can set the following environment variables:

```bash
DEBUG=true                          # enable debug-level logging (default: off)
LIBROFM_USERNAME=<your_username>    # Libro.fm account email
LIBROFM_PASSWORD=<your_password>    # Libro.fm account password
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, build/test commands, and the PR workflow.

## Disclaimer

This tool is not affiliated with Libro.fm in any way. Use it at your own risk.