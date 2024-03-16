import type { ArgumentsCamelCase } from "yargs";

import LibroFmClient, { type Audiobook } from "@/LibroFmClient/LibroFmClient";
import Config from "@/Config";
import InputHandler from "@/InputHandler";

const config = new Config();
const client = new LibroFmClient(config);

await client.init();

type HandlerFunction<T = {}> = (argv: ArgumentsCamelCase<T>) => Promise<void>;

const ListCommand: HandlerFunction = async () => {
	const audiobooks = await client.getLibrary();

	console.info(`Found ${audiobooks.length} audiobooks in library\n`);
	audiobooks.forEach((ab, idx) => {
		console.log(`${ab.title}`);
	});
};

type GetCommandArgs = {
	isbn: string;
};

const GetCommand: HandlerFunction<GetCommandArgs> = async (argv) => {
	const audiobooks = await client.getLibrary();
	let selected: Audiobook | undefined;
	if (argv.isbn) {
		console.info(`Downloading book with ISBN: ${argv.isbn}`);
		selected = audiobooks.find((ab) => ab.isbn === argv.isbn);
	} else {
		const downloadChoice = await InputHandler.requestDownloadChoice(
			audiobooks
		);
		selected = audiobooks.find((ab) => ab.isbn === downloadChoice);
	}

	if (selected) {
		const urls = await client.getDownloadUrls(selected.isbn);
		const paths = await client.downloadBooks(...urls);
		console.log({ paths });
	} else {
		console.error("Invalid selection");
	}
};

const handlers = {
	list: ListCommand,
	get: GetCommand,
} as const;

export default handlers;
