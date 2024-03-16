# Libro.fm CLI Tool

This is a simple command-line tool for interacting with your Libro.fm library. It allows you to:
- List all audiobooks in your library
- Download audiobooks to your computer

## Installation

To install the tool, you need to have Bun installed. Then, run the following command:

```bash
bun install
bun link
```

## Usage

To run the tool, use the following command:

```bash
libro
```

This will display a list of available commands.

### List audiobooks

To list all audiobooks in your library, run the following command:

```bash
libro list
```

This will print a list of audiobook titles to the console.

### Download audiobooks

To download a specific audiobook, run the following command:

```bash
libro get [isbn]
```

To choose an audiobook from your library, run the following command:

```bash
libro get
```

Replace `[isbn]` with the ISBN of the audiobook you want to download. You can find the ISBN by running the list command.

If you don't specify an ISBN, the tool will prompt you to select an audiobook from your library.

## Configuration

The first time you run the tool, you will be prompted to enter your Libro.fm username and password. This information will be saved to a file called `config.json` in the current directory.

## Disclaimer

This tool is not affiliated with Libro.fm in any way. Use it at your own risk.