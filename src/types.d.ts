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
		track_count?: number;
		parts_count?: number;
		pdf_extras?: {
			filename: string;
			size_bytes: number;
		};
		audio_language?: string;
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
	recommendations?: string[];
	user_metadata?: {
		tags?: string[];
		track_index?: number;
		track_seconds?: number;
		last_touched_at?: string;
		changed_at?: string;
		bookmarks?: string[];
		finished?: boolean;
		added_at?: string;
		hidden?: boolean;
	};
}

interface LibraryMetadata {
	page: number;
	total_pages: number;
	audiobooks: Audiobook[];
	tags: string[];
}

interface DownloadMetadata {
	isbn: string;
	parts: {
		url: string;
		size_bytes: number;
	}[];
	tracks: {
		number: number;
		length_sec: number;
		chapter_title: string | null;
		created_at: string;
		updated_at: string;
	}[];
	expires_at: string;
	version: string;
	size_bytes: number;
}

interface TokenMetadata {
	access_token: string;
	token_type: string;
	created_at: number;
}
