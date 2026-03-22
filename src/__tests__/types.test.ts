import { describe, test, expect } from "bun:test";

describe("Type definitions", () => {
	describe("Audiobook type", () => {
		test("minimal audiobook has isbn and title", () => {
			const book: Audiobook = { isbn: "1234567890", title: "Test" };
			expect(book.isbn).toBe("1234567890");
			expect(book.title).toBe("Test");
		});

		test("full audiobook with all optional fields", () => {
			const book: Audiobook = {
				isbn: "1234567890",
				title: "Full Book",
				authors: ["Author A", "Author B"],
				cover_url: "https://example.com/cover.jpg",
				id: 42,
				subtitle: "A Subtitle",
				publisher: "Publisher Inc",
				publication_date: "2024-01-01",
				description: "A great book",
				abridged: false,
				series: "Series Name",
				series_num: 1,
				audiobook_info: {
					narrators: ["Narrator 1"],
					duration: 36000,
					size_bytes: 500000000,
					track_count: 12,
					parts_count: 2,
					audio_language: "en",
				},
				catalog_info: {
					bookseller_pick: true,
					new_release: false,
					coming_soon: false,
				},
				user_metadata: {
					finished: true,
					tags: ["fiction"],
					bookmarks: [],
				},
			};
			expect(book.audiobook_info?.narrators).toEqual(["Narrator 1"]);
			expect(book.catalog_info?.bookseller_pick).toBe(true);
			expect(book.user_metadata?.finished).toBe(true);
		});

		test("authors can be string or array", () => {
			const bookStr: Audiobook = {
				isbn: "1",
				title: "T",
				authors: "Single Author",
			};
			const bookArr: Audiobook = {
				isbn: "2",
				title: "T",
				authors: ["A", "B"],
			};
			expect(typeof bookStr.authors).toBe("string");
			expect(Array.isArray(bookArr.authors)).toBe(true);
		});
	});

	describe("AudiobookMap type", () => {
		test("maps isbn to audiobook", () => {
			const map: AudiobookMap = {
				"111": { isbn: "111", title: "Book A" },
				"222": { isbn: "222", title: "Book B" },
			};
			expect(Object.keys(map)).toHaveLength(2);
			expect(map["111"].title).toBe("Book A");
		});
	});

	describe("DownloadMetadata type", () => {
		test("contains parts and tracks", () => {
			const meta: DownloadMetadata = {
				isbn: "123",
				parts: [
					{ url: "https://example.com/p1.zip", size_bytes: 5000 },
					{ url: "https://example.com/p2.zip", size_bytes: 3000 },
				],
				tracks: [
					{
						number: 1,
						length_sec: 600,
						chapter_title: "Introduction",
						created_at: "2024-01-01",
						updated_at: "2024-01-01",
					},
				],
				expires_at: "2025-06-01",
				version: "2",
				size_bytes: 8000,
			};
			expect(meta.parts).toHaveLength(2);
			expect(meta.tracks[0].chapter_title).toBe("Introduction");
			expect(meta.size_bytes).toBe(8000);
		});
	});

	describe("TokenMetadata type", () => {
		test("has access_token and token_type", () => {
			const token: TokenMetadata = {
				access_token: "abc123",
				token_type: "bearer",
				created_at: 1700000000,
			};
			expect(token.access_token).toBe("abc123");
			expect(token.token_type).toBe("bearer");
		});
	});

	describe("StateData type", () => {
		test("contains book, meta, and path", () => {
			const state: StateData = {
				book: { isbn: "123", title: "Test" },
				meta: {
					isbn: "123",
					parts: [],
					tracks: [],
					expires_at: "",
					version: "1",
					size_bytes: 0,
				},
				path: "/downloads/Test Author",
			};
			expect(state.book.isbn).toBe("123");
			expect(state.path).toBe("/downloads/Test Author");
		});

		test("optional zippedPaths field", () => {
			const state: StateData = {
				book: { isbn: "123", title: "Test" },
				meta: {
					isbn: "123",
					parts: [],
					tracks: [],
					expires_at: "",
					version: "1",
					size_bytes: 0,
				},
				path: "/downloads/Author",
				zippedPaths: ["/cache/book-0.zip", "/cache/book-1.zip"],
			};
			expect(state.zippedPaths).toHaveLength(2);
		});
	});
});
