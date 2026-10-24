import LibroFmClient from "@/LibroFmClient";
import { createJsonLog } from "@/lib/LogFormat";
import { useJsonConsole } from "@/lib/Logger";
import { metrics, startMetricsServer } from "@/lib/Metrics";

// Daemon output is one JSON object per line for the log shipper.
useJsonConsole();
const log = createJsonLog("service");

startMetricsServer();

const client = new LibroFmClient();
await client.init();

const scanLibrary = async () => {
	log.info("Checking for new books...");
	// A failure is logged once, by runService, which carries the error and stack.
	const newBooks = await metrics.trackScan(() => client.getNewBooks());

	if (newBooks.length > 0) {
		log.info(`Found ${newBooks.length} new books`, {
			count: newBooks.length,
		});
		newBooks.forEach((book) => {
			log.info(`New book: ${book.title}`, { isbn: book.isbn });
		});
	} else {
		log.info("No new books found.");
	}

	return newBooks;
};

let overwrite = false;
let keepZip = false;
const downloadBooks = async (newBooks: Audiobook[]) => {
	const isbns = newBooks.map((book) => book.isbn);
	log.info("Downloading new books...");

	const audiobookLibrary = await client.getLibrary();

	const promisedBooks = isbns.map(async (isbn) => {
		log.info(`Searching library for ISBN: ${isbn}`, { isbn });
		const book = audiobookLibrary[isbn];
		if (book) {
			log.info(`Downloading: ${book.title}`, { isbn });
			try {
				const filepath = await client.downloadBook(
					book,
					overwrite,
					keepZip
				);
				if (filepath) {
					log.info(`Downloaded ${book.title}`, { isbn });
					metrics.recordDownload();
					return book;
				} else {
					log.info("No new books downloaded", { isbn });
				}
			} catch (error) {
				metrics.recordDownloadError();
				log.error("Download failed", { error, isbn });
			}
		} else {
			log.warn(`No book found with ISBN: ${isbn}`, { isbn });
		}
	});

	const books = await Promise.all(promisedBooks);
	const count = books.filter((book) => book).length;

	log.info(`Downloaded ${count} new books.`, { count });
};

let isRunning = false;
const runService = async () => {
	if (isRunning) {
		//console.debug("Service is already running. Skipping this iteration.");
		return;
	}

	isRunning = true;

	try {
		const newBooks = await scanLibrary();
		if (newBooks.length > 0) {
			try {
				await downloadBooks(newBooks);
			} catch (error) {
				metrics.recordDownloadError();
				throw error;
			}
		}
	} catch (error) {
		log.error("Sync run failed", { error });
	} finally {
		isRunning = false;
	}
};

runService();
setInterval(runService, 30000);

process.on("SIGINT", () => {
	log.info("Exiting...");
	process.exit(0);
});

process.on("unhandledRejection", (error) => {
	log.error("An unhandled rejection occurred", { error });
	process.exit(1);
});
