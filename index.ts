import fs from "fs";
import readline from "readline";

interface Config {
	baseUrl: string;
	loginEndpoint: string;
	libraryEndpoint: string;
	downloadEndpoint: string;
	username: string;
	password: string;
	authToken?: string;
}

interface Audiobook {
	isbn: string;
	title: string;
	authors?: string[];
	narrators?: string[];
	publication_date?: string;
	duration?: number;
}

const DEFAULT_CONFIG: Config = {
	baseUrl: "https://libro.fm",
	loginEndpoint: "/oauth/token",
	libraryEndpoint: "/api/v7/library",
	downloadEndpoint: "/api/v9/download-manifest",
	username: "",
	password: "",
};

class LibroFmClient {
	config: Config;
	userAgent: string = "okhttp/3.14.9";

	constructor(config: Config) {
		this.config = config;
	}

	async login(username: string, password: string) {
		const response = await fetch(
			`${this.config.baseUrl}${this.config.loginEndpoint}`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"User-Agent": this.userAgent,
				},
				body: JSON.stringify({
					grant_type: "password",
					username: username,
					password: password,
				}),
			}
		);
		const data = (await response.json()) as any;
		this.config.authToken = data.access_token;
	}

	async getLibrary(): Promise<Audiobook[]> {
		let audiobooks: Audiobook[] = [];
		let page = 1;
		while (true) {
			const response = await fetch(
				`${this.config.baseUrl}${this.config.libraryEndpoint}?page=${page}`,
				{
					headers: {
						Authorization: `Bearer ${this.config.authToken}`,
						"User-Agent": this.userAgent,
					},
				}
			);
			const data = (await response.json()) as any;
			audiobooks = audiobooks.concat(data.audiobooks);
			if (page >= data.total_pages) {
				break;
			}
			page += 1;
		}
		return audiobooks;
	}

	async getDownloadUrls(isbn: string): Promise<string[]> {
		const response = await fetch(
			`${this.config.baseUrl}${this.config.downloadEndpoint}?isbn=${isbn}`,
			{
				headers: {
					Authorization: `Bearer ${this.config.authToken}`,
					"User-Agent": this.userAgent,
				},
			}
		);
		const data = (await response.json()) as any;
		return data.parts.map((part: any) => part.url);
	}
}

async function main() {
	let config: Config = DEFAULT_CONFIG;
	if (fs.existsSync("config.json")) {
		config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
	} else {
		fs.writeFileSync("config.json", JSON.stringify(config));
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const client = new LibroFmClient(config);

	if (!config.authToken) {
		if (!config.username) {
			config.username = await new Promise((resolve) =>
				rl.question("Enter your Libro.fm username: ", resolve)
			);
		}
		if (!config.password) {
			config.password = await new Promise((resolve) =>
				rl.question("Enter your Libro.fm password: ", resolve)
			);
		}
		await client.login(config.username, config.password);
	}

	const audiobooks = await client.getLibrary();
	audiobooks.forEach((ab, idx) => {
		console.log(`${idx + 1}. ${ab.title}`);
	});

	const downloadChoice = (await new Promise((resolve) =>
		rl.question(
			"Enter the number of the book you want to download, or 'q' to quit: ",
			resolve
		)
	)) as string;
	rl.close();

	if (downloadChoice.toLowerCase() !== "q") {
		const selectedBook = audiobooks[parseInt(downloadChoice) - 1];
		const urls = await client.getDownloadUrls(selectedBook.isbn);
		urls.forEach((url) => {
			console.log(`Download URL: ${url}`);
		});
	}
}

main();
