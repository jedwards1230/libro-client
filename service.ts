import LibroFmClient from "@/LibroFmClient";
import { pollIntervalMs } from "@/lib/Config";

// Read before logging in, so a bad LIBROFM_POLL_MINUTES fails right away.
const pollInterval = pollIntervalMs();
const client = new LibroFmClient();
await client.init();

const scanLibrary = async () => {
	console.log("Checking for new books...");
	try {
		const newBooks = await client.getNewBooks();

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
		console.error("An error occurred:", error);
		throw error;
	}
};

let overwrite = false;
let keepZip = false;
// The scan already holds each new book from the library; no second fetch.
const downloadBooks = async (newBooks: Audiobook[]) => {
	console.log("Downloading new books...");

	const promisedBooks = newBooks.map(async (book) => {
		console.log(`Downloading: ${book.title}`);
		try {
			const filepath = await client.downloadBook(book, overwrite, keepZip);
			if (filepath) {
				console.log(`Downloaded ${book.title}`);
				return book;
			} else {
				console.log("No new books downloaded");
			}
		} catch (error) {
			console.error("An error occurred:", error);
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
		if (newBooks.length > 0) await downloadBooks(newBooks);
	} catch (error) {
		console.error("An error occurred:", error);
	} finally {
		isRunning = false;
	}
};

console.log(`Checking for new books every ${pollInterval / 60_000} minutes.`);
runService();
setInterval(runService, pollInterval);

process.on("SIGINT", () => {
	console.log("Exiting...");
	process.exit(0);
});

process.on("unhandledRejection", (error) => {
	console.error("An unhandled rejection occurred:", error);
	process.exit(1);
});
