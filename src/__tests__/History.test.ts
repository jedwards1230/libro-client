import { describe, test, expect } from "bun:test";

import {
	buildHistory,
	formatDuration,
	toCsv,
	toJson,
	toText,
	trackLengthsFromState,
} from "../lib/History";

const inProgress: Audiobook = {
	isbn: "9780000000001",
	title: "The Long Way",
	authors: ["Becky Chambers"],
	audiobook_info: { duration: 1000 },
	user_metadata: {
		added_at: "2026-01-05T10:00:00.000Z",
		last_touched_at: "2026-10-01T21:15:00.000Z",
		finished: false,
		track_index: 2,
		track_seconds: 30.5,
		bookmarks: [
			{
				uuid: "b1",
				track_index: 0,
				track_seconds: 12,
				note: "great line",
				created_at: "2026-02-01T08:00:00.000Z",
			},
		],
		tags: [{ id: 1, name: "sci-fi" }],
	},
};

const finished: Audiobook = {
	isbn: "9780000000002",
	title: "Done, Finally",
	authors: "Solo Author",
	audiobook_info: { duration: 3600 },
	user_metadata: {
		added_at: "2025-06-01T10:00:00.000Z",
		last_touched_at: "2026-03-01T10:00:00.000Z",
		finished: true,
		track_index: 9,
		track_seconds: 0,
	},
};

const neverPlayed: Audiobook = {
	isbn: "9780000000003",
	title: 'Unread "Quoted", Title',
	audiobook_info: { duration: 7200 },
	user_metadata: { added_at: "2026-09-01T10:00:00.000Z" },
};

const noMetadata: Audiobook = { isbn: "9780000000004", title: "Bare" };

describe("History", () => {
	describe("buildHistory", () => {
		test("orders by last played, then never-played by newest added", () => {
			const history = buildHistory([neverPlayed, finished, noMetadata, inProgress]);
			expect(history.map((e) => e.isbn)).toEqual([
				"9780000000001",
				"9780000000002",
				"9780000000003",
				"9780000000004",
			]);
		});

		test("maps user_metadata to a 1-based position", () => {
			const [entry] = buildHistory([inProgress]);
			expect(entry).toMatchObject({
				title: "The Long Way",
				authors: "Becky Chambers",
				added_at: "2026-01-05T10:00:00.000Z",
				last_played_at: "2026-10-01T21:15:00.000Z",
				finished: false,
				hidden: false,
				track: 3,
				track_seconds: 30.5,
				duration_seconds: 1000,
				tags: ["sci-fi"],
			});
			expect(entry.bookmarks).toEqual([
				{
					track: 1,
					seconds: 12,
					note: "great line",
					created_at: "2026-02-01T08:00:00.000Z",
				},
			]);
		});

		test("without track lengths the position and progress are unknown", () => {
			const [entry] = buildHistory([inProgress]);
			expect(entry.position_seconds).toBeNull();
			expect(entry.progress_percent).toBeNull();
		});

		test("uses local track lengths for position and progress", () => {
			const lengths = new Map([["9780000000001", [100, 200, 300, 400]]]);
			const [entry] = buildHistory([inProgress], lengths);
			// tracks 1 and 2 (300 s) + 30.5 s into track 3
			expect(entry.position_seconds).toBe(330.5);
			expect(entry.progress_percent).toBe(33.1);
		});

		test("finished titles are 100% even without track lengths", () => {
			const [entry] = buildHistory([finished]);
			expect(entry.finished).toBe(true);
			expect(entry.progress_percent).toBe(100);
		});

		test("titles without user_metadata get empty history", () => {
			const [entry] = buildHistory([noMetadata]);
			expect(entry).toMatchObject({
				added_at: null,
				last_played_at: null,
				finished: false,
				track: null,
				bookmarks: [],
				tags: [],
			});
		});

		test("ignores a track index beyond the known tracks", () => {
			const lengths = new Map([["9780000000001", [100]]]);
			const [entry] = buildHistory([inProgress], lengths);
			expect(entry.position_seconds).toBeNull();
		});
	});

	describe("trackLengthsFromState", () => {
		test("reads v12 milliseconds and legacy seconds, in track order", () => {
			const state = {
				a: {
					book: { isbn: "a", title: "A" },
					path: "/a",
					meta: {
						isbn: "a",
						parts: [],
						expires_at: "",
						version: 1,
						size_bytes: 0,
						tracks: [
							{ number: 2, length_msec: 2500, chapter_title: null, created_at: "", updated_at: "" },
							{ number: 1, length_msec: 1000, chapter_title: null, created_at: "", updated_at: "" },
						],
					},
				},
				b: {
					book: { isbn: "b", title: "B" },
					path: "/b",
					meta: {
						isbn: "b",
						parts: [],
						expires_at: "",
						version: "1",
						size_bytes: 0,
						tracks: [
							{ number: 1, length_sec: 60, chapter_title: null, created_at: "", updated_at: "" },
						],
					},
				},
			} as StateDataMap;
			const lengths = trackLengthsFromState(state);
			expect(lengths.get("a")).toEqual([1, 2.5]);
			expect(lengths.get("b")).toEqual([60]);
		});

		test("skips entries without usable tracks", () => {
			const state = {
				// The initial state file nests an empty map under this key.
				downloadedAudioBooks: {},
				c: {
					book: { isbn: "c", title: "C" },
					path: "/c",
					meta: { isbn: "c", parts: [], tracks: [{ number: 1 }], expires_at: "", version: 1, size_bytes: 0 },
				},
			} as unknown as StateDataMap;
			expect(trackLengthsFromState(state).size).toBe(0);
		});
	});

	describe("formatDuration", () => {
		test("formats seconds as h:mm:ss", () => {
			expect(formatDuration(0)).toBe("0:00:00");
			expect(formatDuration(330.5)).toBe("0:05:30");
			expect(formatDuration(36061)).toBe("10:01:01");
		});
	});

	describe("output formats", () => {
		const history = buildHistory([inProgress, neverPlayed]);

		test("CSV has a header, one row per title, and escapes quotes and commas", () => {
			const lines = toCsv(history).trimEnd().split("\n");
			expect(lines[0]).toBe(
				"isbn,title,authors,added_at,last_played_at,finished,hidden,track,track_seconds,position_seconds,duration_seconds,progress_percent,bookmark_count,tags"
			);
			expect(lines).toHaveLength(3);
			expect(lines[1]).toBe(
				"9780000000001,The Long Way,Becky Chambers,2026-01-05T10:00:00.000Z,2026-10-01T21:15:00.000Z,false,false,3,30.5,,1000,,1,sci-fi"
			);
			expect(lines[2]).toStartWith('9780000000003,"Unread ""Quoted"", Title",');
		});

		test("JSON round-trips with full bookmarks", () => {
			const parsed = JSON.parse(toJson(history));
			expect(parsed).toHaveLength(2);
			expect(parsed[0].bookmarks[0].note).toBe("great line");
		});

		test("text shows dates, position and bookmark count", () => {
			const lengths = new Map([["9780000000001", [100, 200, 300, 400]]]);
			const text = toText(buildHistory([inProgress], lengths));
			expect(text).toContain("1 titles");
			expect(text).toContain("Title: The Long Way — Becky Chambers");
			expect(text).toContain(
				"Added: 2026-01-05 · Last played: 2026-10-01 · Finished: no"
			);
			expect(text).toContain("Position: track 3, 0:00:30 (33.1% of 0:16:40)");
			expect(text).toContain("Bookmarks: 1");
			expect(text).toContain("Tags: sci-fi");
		});
	});
});
