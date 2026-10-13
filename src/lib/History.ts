// Per-title listening history, built from the library's `user_metadata`.
//
// Libro.fm's API has no read endpoint for individual listening sessions — the
// app uploads them (`POST listen`) but never reads them back. What the library
// does return per title is the current position, when it was added and last
// played, whether it is finished, and its bookmarks. Side-effect free so the
// tests can import it directly.

export interface HistoryBookmark {
	/** 1-based track number. */
	track: number;
	seconds: number;
	note: string | null;
	created_at: string | null;
}

export interface HistoryEntry {
	isbn: string;
	title: string;
	authors: string;
	added_at: string | null;
	/** Libro.fm's `last_touched_at`: when a position was last synced. */
	last_played_at: string | null;
	finished: boolean;
	hidden: boolean;
	/** 1-based track number of the current position. */
	track: number | null;
	/** Seconds into the current track. */
	track_seconds: number | null;
	/** Seconds from the start of the book; needs local track lengths. */
	position_seconds: number | null;
	duration_seconds: number | null;
	progress_percent: number | null;
	bookmarks: HistoryBookmark[];
	tags: string[];
}

/** Track lengths in seconds per ISBN, in track order. */
export type TrackLengths = Map<string, number[]>;

/**
 * Track lengths from the download state. Only books downloaded with this tool
 * have them; the manifest is not fetched just for history.
 */
export function trackLengthsFromState(state: StateDataMap): TrackLengths {
	const lengths: TrackLengths = new Map();
	for (const [isbn, data] of Object.entries(state ?? {})) {
		const tracks = data?.meta?.tracks;
		if (!Array.isArray(tracks) || tracks.length === 0) continue;
		const seconds = [...tracks]
			.sort((a, b) => a.number - b.number)
			.map((t) =>
				typeof t.length_msec === "number"
					? t.length_msec / 1000
					: (t.length_sec ?? NaN)
			);
		if (seconds.every(Number.isFinite)) lengths.set(isbn, seconds);
	}
	return lengths;
}

/** Build one history entry per title, most recently played first. */
export function buildHistory(
	books: Audiobook[],
	trackLengths: TrackLengths = new Map()
): HistoryEntry[] {
	return books.map((book) => toEntry(book, trackLengths)).sort(byRecency);
}

function toEntry(book: Audiobook, trackLengths: TrackLengths): HistoryEntry {
	const meta = book.user_metadata ?? {};
	const isbn = String(book.isbn);
	// The API's track_index is 0-based; people count tracks from 1.
	const trackIndex =
		typeof meta.track_index === "number" ? meta.track_index : null;
	const trackSeconds =
		typeof meta.track_seconds === "number" ? meta.track_seconds : null;
	const duration =
		typeof book.audiobook_info?.duration === "number"
			? book.audiobook_info.duration
			: null;

	let position: number | null = null;
	const lengths = trackLengths.get(isbn);
	if (lengths && trackIndex !== null && trackIndex < lengths.length) {
		position =
			lengths.slice(0, trackIndex).reduce((sum, len) => sum + len, 0) +
			(trackSeconds ?? 0);
	}

	let progress: number | null = null;
	if (meta.finished) progress = 100;
	else if (position !== null && duration) {
		progress = Math.min(100, Math.round((position / duration) * 1000) / 10);
	}

	return {
		isbn,
		title: book.title,
		authors: Array.isArray(book.authors)
			? book.authors.join(", ")
			: (book.authors ?? ""),
		added_at: meta.added_at ?? null,
		last_played_at: meta.last_touched_at ?? null,
		finished: meta.finished === true,
		hidden: meta.hidden === true,
		track: trackIndex === null ? null : trackIndex + 1,
		track_seconds: trackSeconds,
		position_seconds: position,
		duration_seconds: duration,
		progress_percent: progress,
		bookmarks: (meta.bookmarks ?? [])
			.filter((b): b is Bookmark => typeof b === "object" && b !== null)
			.map((b) => ({
				track: b.track_index + 1,
				seconds: b.track_seconds,
				note: b.note ?? null,
				created_at: b.created_at ?? null,
			})),
		tags: (meta.tags ?? []).map((t) => (typeof t === "string" ? t : t.name)),
	};
}

/** Most recently played first; never-played titles last, newest added first. */
function byRecency(a: HistoryEntry, b: HistoryEntry): number {
	const played = compareDesc(a.last_played_at, b.last_played_at);
	return played !== 0 ? played : compareDesc(a.added_at, b.added_at);
}

function compareDesc(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return Date.parse(b) - Date.parse(a);
}

/** Seconds as h:mm:ss. */
export function formatDuration(seconds: number): string {
	const total = Math.floor(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const CSV_COLUMNS: (keyof HistoryEntry | "bookmark_count")[] = [
	"isbn",
	"title",
	"authors",
	"added_at",
	"last_played_at",
	"finished",
	"hidden",
	"track",
	"track_seconds",
	"position_seconds",
	"duration_seconds",
	"progress_percent",
	"bookmark_count",
	"tags",
];

function csvCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	const text = Array.isArray(value) ? value.join("; ") : String(value);
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per title; bookmarks are counted (the JSON output has them all). */
export function toCsv(entries: HistoryEntry[]): string {
	const rows = entries.map((entry) =>
		CSV_COLUMNS.map((column) =>
			csvCell(
				column === "bookmark_count"
					? entry.bookmarks.length
					: entry[column]
			)
		).join(",")
	);
	return [CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}

export function toJson(entries: HistoryEntry[]): string {
	return JSON.stringify(entries, null, 2) + "\n";
}

/** Human-readable blocks, in the style of `libro list`. */
export function toText(entries: HistoryEntry[]): string {
	const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
	const blocks = entries.map((e) => {
		const lines = [`Title: ${e.title}${e.authors ? ` — ${e.authors}` : ""}`];
		lines.push(`ISBN: ${e.isbn}`);
		lines.push(
			`Added: ${date(e.added_at)} · Last played: ${date(e.last_played_at)} · Finished: ${e.finished ? "yes" : "no"}`
		);
		if (e.track !== null) {
			let position = `Position: track ${e.track}, ${formatDuration(e.track_seconds ?? 0)}`;
			if (e.progress_percent !== null && e.duration_seconds) {
				position += ` (${e.progress_percent}% of ${formatDuration(e.duration_seconds)})`;
			}
			lines.push(position);
		}
		if (e.bookmarks.length > 0) lines.push(`Bookmarks: ${e.bookmarks.length}`);
		if (e.tags.length > 0) lines.push(`Tags: ${e.tags.join(", ")}`);
		return lines.join("\n");
	});
	return `${entries.length} titles\n\n${blocks.join("\n\n")}\n`;
}
