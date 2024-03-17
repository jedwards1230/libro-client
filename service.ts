import LibroFmClient from "@/LibroFmClient";

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
const downloadBooks = async (newBooks: Audiobook[]) => {
	const isbns = newBooks.map((book: any) => book.isbn);
	console.log("Downloading new books...");

	const audiobookLibrary = await client.getLibrary();

	let count = 0;
	for (const isbn of isbns) {
		console.log(`Searching library for ISBN: ${isbn}`);
		const book = audiobookLibrary[isbn];
		if (book) {
			console.log(`Downloading: ${book.title}`);
			const [path, zippedPaths] = await client.downloadBook(
				book,
				overwrite,
				keepZip
			);
			if (path) {
				console.log(`Downloaded ${book.title}`);
				count++;
			} else {
				console.log("No new books downloaded");
			}
		} else {
			console.log(`No book found with ISBN: ${isbn}`);
		}
	}

	console.log(`Downloaded ${count} new books.`);
};

let isRunning = false;
const runService = async () => {
	if (isRunning) {
		console.log("Service is already running. Skipping this iteration.");
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

runService();
setInterval(runService, 30000);
