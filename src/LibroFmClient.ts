import DownloadCLient from "@/lib/DownloadClient";
import InputHandler from "@/lib/InputHandler";
import APIHandler, { isAuthError } from "@/APIHandler";
import { Backoff } from "@/lib/Backoff";
import logger, { LogMethod } from "@/lib/Logger";
import Config from "@/lib/Config";
import { metrics } from "@/lib/Metrics";
import State from "@/lib/State";
import { DOWNLOAD_DIR } from "@/lib/Directories";

const scope = "LibroFmClient";

export interface LibroFmClientOptions {
	/**
	 * Long-running service mode: log in again with the stored credentials when
	 * the auth token is missing or rejected, instead of failing every scan until
	 * the process restarts. The interactive CLI leaves this off.
	 */
	autoRelogin?: boolean;
	config?: Config;
	state?: State;
	loginBackoff?: Backoff;
}

/** Client for the Libro.fm API. */
export default class LibroFmClient {
	config: Config;
	state: State;
	private readonly autoRelogin: boolean;
	private readonly loginBackoff: Backoff;

	constructor(options: LibroFmClientOptions = {}) {
		this.config = options.config ?? new Config();
		this.state = options.state ?? new State();
		this.autoRelogin = options.autoRelogin ?? false;
		this.loginBackoff = options.loginBackoff ?? new Backoff();
	}

	/**
	 * Initialize the client.
	 * Requests credentials if not provided in the config.
	 * */
	@LogMethod({ scope, message: "Initializing client..." })
	async init() {
		if (!this.config.authToken) {
			if (!this.config.username || !this.config.password) {
				const credentials = await InputHandler.requestCredentials();
				this.config.change(credentials);

				if (!this.config.username || !this.config.password) {
					throw new Error("Username or password not provided");
				}
			}
			await this.login(this.config.username, this.config.password);
		}
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
	@LogMethod({ scope, message: "Logging in..." })
	async login(username: string, password: string) {
		try {
			const data = await APIHandler.fetchLoginData(username, password);
			logger.verbose("Got new authToken", { fn: "LibroFmClient.login" });
			this.config.change({ authToken: data.access_token });
		} catch (error) {
			metrics.recordLogin("error");
			throw error;
		}
		metrics.recordLogin("success");
	}

	/**
	 * Service mode only. Logs in with the stored credentials if there is no
	 * token. Honours the login backoff, so a persistent failure (bad password,
	 * an API gate) makes the scan fail without touching the login endpoint
	 * again until the backoff has elapsed.
	 */
	private async ensureLoggedIn() {
		if (this.config.authToken) return;
		const { username, password } = this.config;
		if (!username || !password) {
			throw new Error(
				"Not logged in and no stored credentials to log in with"
			);
		}
		const wait = this.loginBackoff.remainingMs();
		if (wait > 0) {
			throw new Error(
				`Not logged in; next login attempt in ${Math.ceil(wait / 1000)}s ` +
					`(${this.loginBackoff.failures} recent failure(s))`
			);
		}
		try {
			await this.login(username, password);
		} catch (error) {
			this.loginBackoff.recordFailure();
			throw error;
		}
	}

	/** Fetches the library of audiobooks. */
	@LogMethod({ scope, message: "Fetching library..." })
	async getLibrary(): Promise<AudiobookMap> {
		// At most one login per call: either the token was missing or it was rejected.
		let loggedInThisCall = false;
		if (this.autoRelogin && !this.config.authToken) {
			await this.ensureLoggedIn();
			loggedInThisCall = true;
		}
		if (!this.config.authToken) throw new Error("Not logged in");
		let audiobooks: AudiobookMap = {};
		let page = 1;
		let failed = false;
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
				if (this.autoRelogin) {
					if (isAuthError(error) && !loggedInThisCall) {
						// The token was rejected: drop it, log in once and retry this page.
						loggedInThisCall = true;
						logger.warn("Library fetch was rejected; logging in again", {
							fn: "LibroFmClient.getLibrary",
						});
						this.config.change({ authToken: undefined });
						await this.ensureLoggedIn();
						continue;
					}
					// The fetch failed even with a fresh token, or for another reason:
					// the next scan logs in again, so back off first.
					this.loginBackoff.recordFailure();
				}
				failed = true;
				metrics.recordLibraryFetchError();
				logger.error(`Failed to fetch library: ${error.message}`, {
					fn: "LibroFmClient.getLibrary",
				});
				this.config.change({ authToken: undefined });
				break;
			}
		}

		if (this.autoRelogin && !failed) this.loginBackoff.reset();
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

			const filename = [authors, series, title]
				.filter(Boolean)
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
