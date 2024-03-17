import { $ } from "bun";

const scanLibrary = async () => {
	console.log("Checking for new books...");
	try {
		const newBooks: Audiobook[] =
			await $`bun run index.ts check --json=true`.json();

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

const downloadBooks = async (newBooks: Audiobook[]) => {
	const isbns = newBooks.map((book: any) => book.isbn);
	console.log("Downloading new books...");
	await $`bun run index.ts get ${isbns.join(" ")}`;
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
