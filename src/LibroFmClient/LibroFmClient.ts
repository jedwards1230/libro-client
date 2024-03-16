import type Config from "@/Config";
import DownloadCLient from "@/DownloadClient";
import InputHandler from "@/InputHandler";

export interface Audiobook {
	isbn: string;
	title: string;
	authors?: string[];
	narrators?: string[];
	publication_date?: string;
	duration?: number;
}

/** Client for the Libro.fm API. */
export default class LibroFmClient {
	config: Config;
	userAgent: string = "okhttp/3.14.9";

	constructor(config: Config) {
		this.config = config;
	}

	/**
	 * Initialize the client.
	 * Requests credentials if not provided in the config.
	 * */
	init = async () => {
		if (!this.config.authToken) {
			if (!this.config.username || !this.config.password) {
				const credentials = await InputHandler.requestCredentials();
				this.config.save(credentials);

				if (!this.config.username || !this.config.password) {
					throw new Error("Username or password not provided");
				}
			}
			await this.login(this.config.username, this.config.password);
		}
	};

	/** Logs in to the Libro.fm API and saves the authToken in the config. */
	login = async (username: string, password: string) => {
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
		this.config.save({ authToken: data.access_token });
	};

	/** Fetches the library of audiobooks. */
	getLibrary = async (): Promise<Audiobook[]> => {
		let audiobooks: Audiobook[] = [];
		let page = 1;
		while (true) {
			const url = `${this.config.baseUrl}${this.config.libraryEndpoint}?page=${page}`;
			const response = await fetch(url, this.getHeaders());
			const data = (await response.json()) as any;
			audiobooks = audiobooks.concat(data.audiobooks);
			if (page >= data.total_pages) {
				break;
			}
			page += 1;
		}
		return audiobooks;
	};

	/** Fetches the download URLs for a specific book. */
	getDownloadUrls = async (isbn: string): Promise<string[]> => {
		const url = `${this.config.baseUrl}${this.config.downloadEndpoint}?isbn=${isbn}`;
		const response = await fetch(url, this.getHeaders());
		const data = (await response.json()) as any;
		return data.parts.map((part: any) => part.url);
	};

	/** Downloads a list of books. */
	downloadBooks = async (...urls: string[]) => {
		try {
			const books = await Promise.all(
				urls.map((url) =>
					DownloadCLient.download(url, this.getHeaders())
				)
			);

			const paths = await Promise.all(
				books.map((book, idx) =>
					DownloadCLient.save(book, `/book-${idx}.zip`)
				)
			);

			const unzipped = await Promise.all(
				paths.map((path) =>
					DownloadCLient.unzip(path, path.replace(".zip", ""))
				)
			);

			return paths;
		} catch (error) {
			console.error(error);
			throw new Error("Failed to download books");
		}
	};

	/** General request headers. */
	private getHeaders = () => ({
		headers: {
			Authorization: `Bearer ${this.config.authToken}`,
			"User-Agent": this.userAgent,
		},
	});
}
