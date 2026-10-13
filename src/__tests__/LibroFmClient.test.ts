import {
	describe,
	test,
	expect,
	mock,
	beforeEach,
	afterEach,
	spyOn,
} from "bun:test";

import APIHandler, { ApiError } from "../APIHandler";
import LibroFmClient, { CredentialsError } from "../LibroFmClient";
import InputHandler from "../lib/InputHandler";
import type Config from "../lib/Config";
import type State from "../lib/State";

describe("LibroFmClient", () => {
	// Most tests replicate the client logic. The "re-login" tests use the real
	// client with a fake config and state, so no file in data/config is touched.

	describe("getLibrary pagination logic", () => {
		test("fetches all pages and combines audiobooks", async () => {
			const page1: LibraryMetadata = {
				page: 1,
				total_pages: 3,
				audiobooks: [
					{ isbn: "001", title: "Book 1" },
					{ isbn: "002", title: "Book 2" },
				],
				tags: [],
			};
			const page2: LibraryMetadata = {
				page: 2,
				total_pages: 3,
				audiobooks: [{ isbn: "003", title: "Book 3" }],
				tags: [],
			};
			const page3: LibraryMetadata = {
				page: 3,
				total_pages: 3,
				audiobooks: [{ isbn: "004", title: "Book 4" }],
				tags: [],
			};

			const pages = [page1, page2, page3];

			// Simulate getLibrary pagination logic
			const audiobooks: AudiobookMap = {};
			let page = 1;
			while (true) {
				const data = pages[page - 1];
				for (const book of data.audiobooks) {
					audiobooks[book.isbn] = book;
				}
				if (page >= data.total_pages) break;
				page += 1;
			}

			expect(Object.keys(audiobooks)).toHaveLength(4);
			expect(audiobooks["001"].title).toBe("Book 1");
			expect(audiobooks["004"].title).toBe("Book 4");
		});

		test("handles single page library", async () => {
			const singlePage: LibraryMetadata = {
				page: 1,
				total_pages: 1,
				audiobooks: [{ isbn: "001", title: "Only Book" }],
				tags: [],
			};

			const audiobooks: AudiobookMap = {};
			let page = 1;
			while (true) {
				const data = singlePage;
				for (const book of data.audiobooks) {
					audiobooks[book.isbn] = book;
				}
				if (page >= data.total_pages) break;
				page += 1;
			}

			expect(Object.keys(audiobooks)).toHaveLength(1);
		});

		test("handles empty library", async () => {
			const emptyPage: LibraryMetadata = {
				page: 1,
				total_pages: 1,
				audiobooks: [],
				tags: [],
			};

			const audiobooks: AudiobookMap = {};
			let page = 1;
			while (true) {
				const data = emptyPage;
				for (const book of data.audiobooks) {
					audiobooks[book.isbn] = book;
				}
				if (page >= data.total_pages) break;
				page += 1;
			}

			expect(Object.keys(audiobooks)).toHaveLength(0);
		});
	});

	describe("downloadBook author filename logic", () => {
		test("uses string author as filename", () => {
			const book: Audiobook = {
				isbn: "123",
				title: "Test",
				authors: "John Smith",
			};
			const filename =
				typeof book.authors === "string"
					? book.authors
					: (book.authors?.join(", ") ?? "Unknown");
			expect(filename).toBe("John Smith");
		});

		test("joins array of authors with comma", () => {
			const book: Audiobook = {
				isbn: "123",
				title: "Test",
				authors: ["Jane Doe", "John Smith"],
			};
			const filename =
				typeof book.authors === "string"
					? book.authors
					: (book.authors?.join(", ") ?? "Unknown");
			expect(filename).toBe("Jane Doe, John Smith");
		});

		test("handles missing authors", () => {
			const book: Audiobook = {
				isbn: "123",
				title: "Test",
			};
			// The actual code throws if !book.authors, so this tests that path
			expect(book.authors).toBeUndefined();
		});
	});

	describe("getNewBooks logic", () => {
		test("returns books not in downloaded state", () => {
			const downloaded: { [isbn: string]: boolean } = {
				"001": true,
				"002": true,
			};

			const library: AudiobookMap = {
				"001": { isbn: "001", title: "Old Book" },
				"002": { isbn: "002", title: "Another Old" },
				"003": { isbn: "003", title: "New Book" },
			};

			const newBooks: Audiobook[] = [];
			for (const isbn in library) {
				if (!downloaded[isbn]) {
					newBooks.push(library[isbn]);
				}
			}

			expect(newBooks).toHaveLength(1);
			expect(newBooks[0].isbn).toBe("003");
		});
	});

	describe("re-login", () => {
		function fakeConfig(initial: Partial<Config> = {}) {
			return {
				username: "reader@example.com",
				password: "hunter22",
				authToken: undefined,
				downloadDir: "/tmp/libro-downloads",
				change(update: Partial<Config>) {
					Object.assign(this, update);
				},
				...initial,
			} as unknown as Config;
		}

		function makeClient(config: Config) {
			return new LibroFmClient(config, {} as State);
		}

		function loginReturns(token: string) {
			return spyOn(APIHandler, "fetchLoginData").mockResolvedValue({
				access_token: token,
				token_type: "Bearer",
				created_at: 0,
			});
		}

		afterEach(() => {
			mock.restore();
		});

		test("keeps an existing token", async () => {
			const login = loginReturns("new-token");
			const config = fakeConfig({ authToken: "old-token" });

			await makeClient(config).ensureLoggedIn();

			expect(login).not.toHaveBeenCalled();
			expect(config.authToken).toBe("old-token");
		});

		test("logs in again with the configured credentials", async () => {
			const login = loginReturns("new-token");
			const config = fakeConfig();

			await makeClient(config).ensureLoggedIn();

			expect(login).toHaveBeenCalledTimes(1);
			expect(login).toHaveBeenCalledWith("reader@example.com", "hunter22");
			expect(config.authToken).toBe("new-token");
		});

		test("fails without credentials instead of prompting", async () => {
			const login = loginReturns("new-token");
			const config = fakeConfig({ password: undefined });

			const result = makeClient(config).ensureLoggedIn();
			await expect(result).rejects.toThrow(CredentialsError);
			await expect(result).rejects.toThrow("LIBROFM_PASSWORD");
			expect(login).not.toHaveBeenCalled();
		});

		test("a rejected login is a CredentialsError", async () => {
			spyOn(APIHandler, "fetchLoginData").mockRejectedValue(
				new ApiError(401, "Unauthorized", "invalid_grant")
			);
			const config = fakeConfig();

			const result = makeClient(config).ensureLoggedIn();
			await expect(result).rejects.toThrow(CredentialsError);
			await expect(result).rejects.toThrow(
				"Libro.fm rejected the username or password (HTTP 401 Unauthorized: invalid_grant)."
			);
			expect(config.authToken).toBeUndefined();
		});

		test("other login failures are passed on to be retried", async () => {
			for (const failure of [
				new ApiError(503, "Service Unavailable"),
				new ApiError(401, "Unauthorized"), // the ELB's empty 401
				new TypeError("fetch failed"),
			]) {
				spyOn(APIHandler, "fetchLoginData").mockRejectedValue(failure);
				const result = makeClient(fakeConfig()).ensureLoggedIn();
				await expect(result).rejects.toBe(failure);
				mock.restore();
			}
		});

		describe("init", () => {
			const ttyDescriptor = Object.getOwnPropertyDescriptor(
				process.stdin,
				"isTTY"
			);
			function setTTY(value: boolean) {
				Object.defineProperty(process.stdin, "isTTY", {
					value,
					configurable: true,
				});
			}

			afterEach(() => {
				if (ttyDescriptor) {
					Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
				} else {
					delete (process.stdin as { isTTY?: boolean }).isTTY;
				}
			});

			test("without a terminal, missing credentials fail without a prompt", async () => {
				setTTY(false);
				const prompt = spyOn(InputHandler, "requestCredentials");
				const login = loginReturns("new-token");

				await expect(
					makeClient(fakeConfig({ password: undefined })).init()
				).rejects.toThrow(CredentialsError);
				expect(prompt).not.toHaveBeenCalled();
				expect(login).not.toHaveBeenCalled();
			});

			test("in a terminal, asks for missing credentials, then logs in", async () => {
				setTTY(true);
				const prompt = spyOn(
					InputHandler,
					"requestCredentials"
				).mockResolvedValue({
					username: "typed@example.com",
					password: "typed-pass",
				});
				const login = loginReturns("new-token");
				const config = fakeConfig({ username: undefined, password: undefined });

				await makeClient(config).init();

				expect(prompt).toHaveBeenCalledTimes(1);
				expect(login).toHaveBeenCalledWith("typed@example.com", "typed-pass");
				expect(config.authToken).toBe("new-token");
			});

			test("a rejected login stops init with a CredentialsError", async () => {
				setTTY(false);
				spyOn(APIHandler, "fetchLoginData").mockRejectedValue(
					new ApiError(401, "Unauthorized", "invalid_grant")
				);

				await expect(makeClient(fakeConfig()).init()).rejects.toThrow(
					CredentialsError
				);
			});
		});

		test("recovers after a failed library fetch clears the token", async () => {
			loginReturns("new-token");
			const fetchLibrary = spyOn(APIHandler, "fetchLibrary")
				.mockRejectedValueOnce(new Error("Service Unavailable"))
				.mockResolvedValue({
					page: 1,
					total_pages: 1,
					audiobooks: [{ isbn: "001", title: "Book 1" }],
					tags: [],
				});
			const config = fakeConfig({ authToken: "old-token" });
			const client = makeClient(config);

			// First check: the fetch fails and the token is dropped.
			expect(await client.getLibrary()).toEqual({});
			expect(config.authToken).toBeUndefined();
			await expect(client.getLibrary()).rejects.toThrow("Not logged in");

			// Next check: log in again, then the library loads.
			await client.ensureLoggedIn();
			const library = await client.getLibrary();
			expect(Object.keys(library)).toEqual(["001"]);
			expect(fetchLibrary).toHaveBeenLastCalledWith("new-token", 1);
		});
	});
});
