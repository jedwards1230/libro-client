import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import LibroFmClient from "@/LibroFmClient";
import InputHandler from "@/lib/InputHandler";
import logger from "./lib/Logger";

const SCRIPT_NAME = "libro";

const client = new LibroFmClient();
await client.init();

const Command = yargs(hideBin(process.argv))
	.scriptName(SCRIPT_NAME)
	.command({
		command: "list",
		aliases: ["ls"],
		describe: "Fetch list of books in library",
		handler: async () => {
			const audiobooks = await client.getLibrary();

			logger.info(
				`Found ${
					Object.values(audiobooks).length
				} audiobooks in library\n`
			);
			const booklist = Object.values(audiobooks);
			booklist.forEach((ab, i) => {
				logger.info(`Title: ${ab.title}`);
				logger.info(`ISBN: ${ab.isbn}`);
				logger.info(`Duration: ${ab.audiobook_info?.duration}`);
				logger.info(
					`Narrators: ${ab.audiobook_info?.narrators?.join(", ")}`
				);
				logger.info("");
			});
		},
	})
	.command(
		"get [isbns...]",
		"Download a book. Optionally provide ISBNs to download specific books.",
		(yargs) => {
			return yargs
				.positional("isbns", {
					describe: "ISBN of the book to download",
					type: "string",
				})
				.array("isbns")
				.options({
					overwrite: {
						describe: "Should overwrite existing files",
						type: "boolean",
						default: false,
					},
					keepZip: {
						describe: "Keep the downloaded zip file",
						type: "boolean",
						default: false,
					},
				});
		},
		async (argv) => {
			const audiobookLibrary = await client.getLibrary();
			const selected: Audiobook[] = [];

			// If ISBNs are provided, download those books
			// Otherwise, prompt the user to select a book
			if (argv.isbns && argv.isbns.length > 0) {
				for (const isbn of argv.isbns) {
					logger.info(`Searching library for ISBN: ${argv.isbn}`);
					const book = audiobookLibrary[isbn];
					if (book) {
						selected.push(book);
					} else {
						logger.error(`No book found with ISBN: ${isbn}`, {
							fn: "Command.get",
						});
					}
				}
			} else {
				const downloadChoice = await InputHandler.requestDownloadChoice(
					Object.values(audiobookLibrary)
				);
				if (downloadChoice) {
					selected.push(audiobookLibrary[downloadChoice]);
				} else {
					logger.error("Invalid selection", {
						fn: "Command.get",
					});
				}
			}

			if (selected.length === 0) throw new Error("No books selected");

			for (const book of selected) {
				logger.info(`Downloading: ${book.title}`);
				const [path, zippedPaths] = await client.downloadBook(
					book,
					argv.overwrite,
					argv.keepZip
				);
				if (path) {
					logger.info(`Downloaded ${book.title}`);
				} else {
					logger.info("No new books downloaded");
				}
			}
		}
	)
	.demandCommand(1)
	.parse();

export default Command;
