import LibroFmClient from "@/LibroFmClient";
import { metrics, startMetricsServer } from "@/lib/Metrics";

startMetricsServer();

const client = new LibroFmClient();
await client.init();

const scanLibrary = async () => {
	console.log("Checking for new books...");
	try {
		const newBooks = await client.getNewBooks();
		metrics.recordScanSuccess();

		if (newBooks.length > 0) {
			console.log(`Found ${newBooks.length} new books:`);
			newBooks.forEach((book, idx) => {
				console.log(`${idx + 1}. ${book.title}`);
			});
		} else {
			console.log("No new books found.");
		}

		return newBooks;
	} catch (error) {
		metrics.recordScanError();
		console.error("An error occurred:", error);
		throw error;
	}
};

let overwrite = false;
let keepZip = false;
const downloadBooks = async (newBooks: Audiobook[]) => {
	const isbns = newBooks.map((book) => book.isbn);
	console.log("Downloading new books...");

	const audiobookLibrary = await client.getLibrary();

	const promisedBooks = isbns.map(async (isbn) => {
		console.log(`Searching library for ISBN: ${isbn}`);
		const book = audiobookLibrary[isbn];
		if (book) {
			console.log(`Downloading: ${book.title}`);
			try {
				const filepath = await client.downloadBook(
					book,
					overwrite,
					keepZip
				);
				if (filepath) {
					console.log(`Downloaded ${book.title}`);
					metrics.recordDownload();
					return book;
				} else {
					console.log("No new books downloaded");
				}
			} catch (error) {
				metrics.recordDownloadError();
				console.error("An error occurred:", error);
			}
		} else {
			console.warn(`No book found with ISBN: ${isbn}`);
		}
	});

	const books = await Promise.all(promisedBooks);
	const count = books.filter((book) => book).length;

	console.log(`Downloaded ${count} new books.`);
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
		console.error("An error occurred:", error);
	} finally {
		isRunning = false;
	}
};

runService();
setInterval(runService, 30000);

process.on("SIGINT", () => {
	console.log("Exiting...");
	process.exit(0);
});

process.on("unhandledRejection", (error) => {
	console.error("An unhandled rejection occurred:", error);
	process.exit(1);
});
