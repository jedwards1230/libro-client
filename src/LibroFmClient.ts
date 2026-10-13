import DownloadCLient from "@/lib/DownloadClient";
import InputHandler from "@/lib/InputHandler";
import APIHandler from "@/APIHandler";
import logger, { LogMethod } from "@/lib/Logger";
import Config from "@/lib/Config";
import State from "@/lib/State";
import { DOWNLOAD_DIR } from "@/lib/Directories";
import { safePathSegment } from "@/lib/Security";
import {
	buildHistory,
	trackLengthsFromState,
	type HistoryEntry,
} from "@/lib/History";

const scope = "LibroFmClient";

/**
 * Can't log in with these credentials: Libro.fm turned them down, or there are
 * none and no terminal to ask. Retrying with the same settings won't help.
 */
export class CredentialsError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "CredentialsError";
	}
}

/** Client for the Libro.fm API. */
export default class LibroFmClient {
	/** `config` and `state` default to the files in data/config/; tests pass fakes. */
	constructor(
		public config: Config = new Config(),
		public state: State = new State()
	) {}

	/**
	 * Initialize the client.
	 * Requests credentials if not provided in the config.
	 * */
	@LogMethod({ scope, message: "Initializing client..." })
	async init() {
		const { authToken, username, password } = this.config;
		// Without a terminal there is no one to ask; ensureLoggedIn() says so.
		if (!authToken && (!username || !password) && process.stdin.isTTY) {
			this.config.change(await InputHandler.requestCredentials());
		}
		await this.ensureLoggedIn();
		if (!this.config.downloadDir) {
			// In a non-interactive (headless/service) environment there is no
			// TTY to answer a prompt — fall back to the default downloads
			// directory instead of spinning the event loop forever on an
			// @inquirer prompt that can never resolve. Interactive callers are
			// still prompted as before.
			const downloadDir = process.stdin.isTTY
				? await InputHandler.requestDownloadLocation()
				: DOWNLOAD_DIR;
			this.config.change({ downloadDir });

			if (!this.config.downloadDir) {
				throw new Error("Download directory not provided");
			}
		}
	}

	/** Logs in to the Libro.fm API and saves the authToken in the config. */
	@LogMethod({ scope, message: "Logging in...", secretArgs: [0, 1] })
	async login(username: string, password: string) {
		let data: TokenMetadata;
		try {
			data = await APIHandler.fetchLoginData(username, password);
		} catch (error) {
			if (!APIHandler.isRejectedLogin(error)) throw error;
			throw new CredentialsError(
				`Libro.fm rejected the username or password (${(error as Error).message}).`,
				{ cause: error }
			);
		}
		logger.verbose("Got new authToken", { fn: "LibroFmClient.login" });
		this.config.change({ authToken: data.access_token });
	}

	/**
	 * Log in again when the authToken is gone (a failed request clears it).
	 * Never prompts: the background service has no terminal. Throws a
	 * CredentialsError when retrying can't help.
	 */
	@LogMethod({ scope })
	async ensureLoggedIn() {
		if (this.config.authToken) return;
		const { username, password } = this.config;
		if (!username || !password) {
			throw new CredentialsError(
				"No username or password to log in with: set LIBROFM_USERNAME and LIBROFM_PASSWORD."
			);
		}
		await this.login(username, password);
	}

	/** Fetches the library of audiobooks. */
	@LogMethod({ scope, message: "Fetching library..." })
	async getLibrary(): Promise<AudiobookMap> {
		if (!this.config.authToken) throw new Error("Not logged in");
		let audiobooks: AudiobookMap = {};
		let page = 1;
		while (true) {
			try {
				const data = await APIHandler.fetchLibrary(
					this.config.authToken,
					page
				);

				for (const book of data.audiobooks) {
					audiobooks[book.isbn] = book;
				}

				if (page >= data.total_pages) {
					break;
				}
				page += 1;
			} catch (error: any) {
				logger.error(`Failed to fetch library: ${error.message}`, {
					fn: "LibroFmClient.getLibrary",
				});
				this.config.change({ authToken: undefined });
				break;
			}
		}

		return audiobooks;
	}

	/** Downloads a list of books. */
	@LogMethod({ scope, message: "Downloading books..." })
	async downloadBook(
		book: Audiobook,
		overwrite: boolean = false,
		keepZip: boolean = false
	): Promise<string> {
		if (!this.config.authToken) throw new Error("Not logged in");
		const authToken = this.config.authToken;

		// fetch download links
		const metadata = await this.getDownloadMetadata(book.isbn);

		logger.verbose(`Downloading book: ${metadata.isbn}`, {
			fn: "LibroFmClient.downloadBook",
		});
		const urls = metadata.parts.map((p) => p.url);

		// check if book is already downloaded
		if (!overwrite && this.state.hasBook(book.isbn)) {
			const shouldOverwrite = await InputHandler.requestOverwrite(book);
			if (!shouldOverwrite) {
				logger.verbose("Skipping download", {
					fn: "LibroFmClient.downloadBook",
				});
				return "";
			}
		}

		try {
			if (!book.authors) throw new Error("No authors found");
			const authors =
				typeof book.authors === "string"
					? book.authors
					: book.authors.join(", ");

			const series =
				typeof book.series === "string" ? book.series : null;

			const title = [book.series_num, book.title]
				.filter(Boolean)
				.join(" - ");

			// Each part comes from the API; keep it a single, safe path segment.
			const filename = [authors, series, title]
				.filter(Boolean)
				.map((part) => safePathSegment(String(part)))
				.join("/");

			const [path, zipped_files] = await DownloadCLient.downloadFiles(
				filename,
				urls,
				authToken,
				keepZip,
				this.config.downloadDir
			);

			await DownloadCLient.saveMetadata(book, metadata, path);

			this.state.addBook({
				book,
				path,
				meta: metadata,
				...(zipped_files && { zippedPaths: zipped_files }),
			});

			return filename;
		} catch (error) {
			logger.error({ error, fn: "LibroFmClient.downloadBook" });
			throw new Error("Failed to download books");
		}
	}

	/** Get list of books in library that are not downloaded */
	@LogMethod({ scope, message: "Checking for new books..." })
	async getNewBooks(): Promise<Audiobook[]> {
		const library = await this.getLibrary();
		const newBooks = this.state.findDiff(library);
		return newBooks;
	}

	/**
	 * Per-title listening history (added, last played, finished, position,
	 * bookmarks), most recently played first. Optionally limited to ISBNs.
	 */
	@LogMethod({ scope, message: "Building listening history..." })
	async getHistory(isbns: string[] = []): Promise<HistoryEntry[]> {
		const library = await this.getLibrary();
		const books = isbns.length
			? isbns.map((isbn) => library[isbn]).filter(Boolean)
			: Object.values(library);
		return buildHistory(
			books,
			trackLengthsFromState(this.state.downloadedAudioBooks)
		);
	}

	/** Fetches the download URLs for a specific book. */
	@LogMethod({ scope })
	private async getDownloadMetadata(isbn: string): Promise<DownloadMetadata> {
		if (!this.config.authToken) throw new Error("Not logged in");
		const data = await APIHandler.fetchDownloadMetadata(
			this.config.authToken,
			isbn
		);
		return data;
	}
}
