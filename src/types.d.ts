type AudiobookMap = {
	[isbn: string]: Audiobook;
};

type StateData = {
	book: Audiobook;
	meta: DownloadMetadata;
	path: string;
	zippedPaths?: string[];
};

type StateDataMap = {
	[isbn: string]: StateData;
};

interface Audiobook {
	isbn: string;
	title: string;
	authors?: string | string[];
	cover_url?: string;
	catalog_info?: {
		bookseller_pick?: boolean;
		new_release?: boolean;
		coming_soon?: boolean;
	};
	audiobook_info?: {
		narrators?: string[];
		duration?: number;
		size_bytes?: number;
		/** v12 key (APK `ApiAudioInfo`); older versions sent `track_count`. */
		trackCount?: number;
		track_count?: number;
		parts_count?: number;
		/** v12 sends a list; older versions sent a single object. */
		pdf_extras?: PdfExtra[] | PdfExtra;
		/** v12 key; older versions sent `audio_language`. */
		audio_language_display?: string;
		audio_language?: string;
		ai_narrated?: boolean;
		tracks_updated_at?: string;
		version_num?: number;
	};
	ebook_info?: {
		drm_type?: string;
		has_drm?: boolean;
		size_bytes?: number;
	};
	id?: number;
	subtitle?: string;
	publisher?: string;
	publication_date?: string;
	created_at?: string;
	updated_at?: string;
	description?: string;
	genres?: {
		id: number;
		name: string;
		html_name: string;
	}[];
	lead?: string | null;
	abridged?: boolean;
	series?: string | null;
	series_num?: number | null;
	recommendations?: (
		| string
		| { org?: string; org_logo_url?: string; review?: string; reviewer?: string }
	)[];
	/** Per-user listening state: position, finished flag, bookmarks, tags. */
	user_metadata?: {
		tags?: (string | { id: number; name: string; tagged_at?: string })[];
		track_index?: number;
		track_seconds?: number;
		last_touched_at?: string;
		changed_at?: string;
		bookmarks?: (string | Bookmark)[];
		finished?: boolean;
		added_at?: string;
		hidden?: boolean;
		ebook_position?: number;
	};
}

interface PdfExtra {
	filename: string;
	size_bytes?: number;
}

interface Bookmark {
	uuid?: string;
	note?: string;
	track_index: number;
	track_seconds: number;
	created_at?: string;
	changed_at?: string;
}

interface LibraryMetadata {
	page: number;
	total_pages: number;
	audiobooks: Audiobook[];
	tags: (
		| string
		| { id: number; name: string; created_at?: string; updated_at?: string }
	)[];
	ebooks?: Audiobook[];
	pending_preorders?: {
		cover_urls?: string[];
		total_count?: number;
	};
}

interface DownloadMetadata {
	isbn: string;
	parts: {
		url: string;
		size_bytes: number;
	}[];
	tracks: {
		number: number;
		/** v12 reports track length in milliseconds. */
		length_msec?: number;
		/** Pre-v12 key, in seconds. */
		length_sec?: number;
		chapter_title: string | null;
		created_at: string;
		updated_at: string;
	}[];
	expires_at: string;
	version: string | number;
	size_bytes: number;
}

interface TokenMetadata {
	access_token: string;
	token_type: string;
	created_at: number;
	error?: string;
	error_description?: string;
}
