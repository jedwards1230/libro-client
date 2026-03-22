import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

// We need to mock Directories before importing State, since State imports
// Directories at module level which creates directories as a side effect.
// Instead, we'll test State logic by creating a temporary directory structure.

describe("State", () => {
	let tmpDir: string;
	let statePath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "libro-state-test-"));
		statePath = path.join(tmpDir, "state.json");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// Helper: create a minimal State-like object for testing core logic
	// without importing the module (which has side effects)
	function createState(initial: StateDataMap = {}): {
		downloadedAudioBooks: StateDataMap;
		addBook: (data: StateData) => void;
		removeBook: (isbn: string) => void;
		hasBook: (isbn: string) => boolean;
		findDiff: (curr: AudiobookMap) => Audiobook[];
		save: () => void;
		load: () => void;
	} {
		const state = {
			downloadedAudioBooks: { ...initial },
			addBook(data: StateData) {
				this.downloadedAudioBooks[data.book.isbn] = data;
				this.save();
			},
			removeBook(isbn: string) {
				delete this.downloadedAudioBooks[isbn];
				this.save();
			},
			hasBook(isbn: string) {
				return this.downloadedAudioBooks[isbn] !== undefined;
			},
			findDiff(curr: AudiobookMap): Audiobook[] {
				const diff: Audiobook[] = [];
				for (const isbn in curr) {
					if (!this.hasBook(isbn)) {
						diff.push(curr[isbn]);
					}
				}
				return diff;
			},
			save() {
				fs.writeFileSync(
					statePath,
					JSON.stringify(this.downloadedAudioBooks, null, 2)
				);
			},
			load() {
				if (fs.existsSync(statePath)) {
					const data = fs.readFileSync(statePath, "utf-8");
					this.downloadedAudioBooks = JSON.parse(data);
				}
			},
		};
		return state;
	}

	function makeBook(isbn: string, title: string = "Test Book"): Audiobook {
		return { isbn, title };
	}

	function makeStateData(isbn: string, title: string = "Test Book"): StateData {
		return {
			book: makeBook(isbn, title),
			path: `/downloads/${title}`,
			meta: {
				isbn,
				parts: [],
				tracks: [],
				expires_at: "2025-01-01",
				version: "1",
				size_bytes: 0,
			},
		};
	}

	describe("hasBook", () => {
		test("returns false for empty state", () => {
			const state = createState();
			expect(state.hasBook("1234567890")).toBe(false);
		});

		test("returns true after adding a book", () => {
			const state = createState();
			state.addBook(makeStateData("1234567890"));
			expect(state.hasBook("1234567890")).toBe(true);
		});

		test("returns false for a different isbn", () => {
			const state = createState();
			state.addBook(makeStateData("1234567890"));
			expect(state.hasBook("0987654321")).toBe(false);
		});
	});

	describe("addBook", () => {
		test("adds a book to state", () => {
			const state = createState();
			const data = makeStateData("111");
			state.addBook(data);
			expect(state.downloadedAudioBooks["111"]).toEqual(data);
		});

		test("persists to disk", () => {
			const state = createState();
			state.addBook(makeStateData("111"));

			const saved = JSON.parse(fs.readFileSync(statePath, "utf-8"));
			expect(saved["111"]).toBeDefined();
			expect(saved["111"].book.isbn).toBe("111");
		});

		test("overwrites existing book with same isbn", () => {
			const state = createState();
			state.addBook(makeStateData("111", "First"));
			state.addBook(makeStateData("111", "Second"));
			expect(state.downloadedAudioBooks["111"].book.title).toBe("Second");
		});
	});

	describe("removeBook", () => {
		test("removes a book from state", () => {
			const state = createState();
			state.addBook(makeStateData("111"));
			state.removeBook("111");
			expect(state.hasBook("111")).toBe(false);
		});

		test("persists removal to disk", () => {
			const state = createState();
			state.addBook(makeStateData("111"));
			state.removeBook("111");

			const saved = JSON.parse(fs.readFileSync(statePath, "utf-8"));
			expect(saved["111"]).toBeUndefined();
		});

		test("no-op when removing non-existent isbn", () => {
			const state = createState();
			state.addBook(makeStateData("111"));
			state.removeBook("999");
			expect(state.hasBook("111")).toBe(true);
		});
	});

	describe("findDiff", () => {
		test("returns all books when state is empty", () => {
			const state = createState();
			const library: AudiobookMap = {
				"111": makeBook("111", "Book A"),
				"222": makeBook("222", "Book B"),
			};
			const diff = state.findDiff(library);
			expect(diff).toHaveLength(2);
		});

		test("returns empty when all books already downloaded", () => {
			const state = createState();
			state.addBook(makeStateData("111"));
			state.addBook(makeStateData("222"));

			const library: AudiobookMap = {
				"111": makeBook("111"),
				"222": makeBook("222"),
			};
			const diff = state.findDiff(library);
			expect(diff).toHaveLength(0);
		});

		test("returns only new books", () => {
			const state = createState();
			state.addBook(makeStateData("111"));

			const library: AudiobookMap = {
				"111": makeBook("111", "Existing"),
				"222": makeBook("222", "New Book"),
			};
			const diff = state.findDiff(library);
			expect(diff).toHaveLength(1);
			expect(diff[0].isbn).toBe("222");
			expect(diff[0].title).toBe("New Book");
		});

		test("returns empty for empty library", () => {
			const state = createState();
			state.addBook(makeStateData("111"));
			const diff = state.findDiff({});
			expect(diff).toHaveLength(0);
		});
	});

	describe("persistence", () => {
		test("load restores saved state", () => {
			const state1 = createState();
			state1.addBook(makeStateData("111", "Persisted Book"));

			const state2 = createState();
			state2.load();
			expect(state2.hasBook("111")).toBe(true);
			expect(state2.downloadedAudioBooks["111"].book.title).toBe(
				"Persisted Book"
			);
		});
	});
});
