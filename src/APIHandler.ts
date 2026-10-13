import logger, { LogMethod } from "./lib/Logger";

const scope = "APIHandler";

/** A failed Libro.fm request, with the OAuth/API error code if the server sent one. */
export class ApiError extends Error {
	constructor(
		readonly status: number | undefined,
		readonly statusText: string | undefined,
		/** `error` from a JSON body, e.g. `invalid_grant`. */
		readonly code?: string,
		readonly description?: string
	) {
		const http = [status && `HTTP ${status}`, statusText]
			.filter(Boolean)
			.join(" ");
		const api = code && (description ? `${code} - ${description}` : code);
		super([http, api].filter(Boolean).join(": ") || "Request failed");
		this.name = "ApiError";
	}
}

// Libro.fm has no public API; endpoints and required headers are reverse-engineered
// from the official Android app (fm.libro.librofm). The most current source is the
// weekly APK probe in https://github.com/Bookclerk/bookclerk
// (scripts/librofm-apk-probe), which decompiles the latest Play Store build; its
// drift issues report the app's current /api/vN/ prefix, app version and OkHttp UA.
// https://github.com/burntcookie90/librofm-downloader is a second, hand-maintained
// reference. Values below match Android app 7.39.1 (API v12).
export default class APIHandler {
	static baseUrl = "https://libro.fm";
	static loginEndpoint = "/oauth/token";
	static libraryEndpoint = "/api/v12/library";
	static downloadEndpoint = "/api/v12/download-manifest";
	static userAgent = "okhttp/4.12.0";
	// Required since late 2025 — without it, /oauth/token returns 401 at the ELB
	// before the request reaches the auth backend.
	static appVer = "7.39.1";
	// Also sent by the app's AuthInterceptor on every request.
	static device = "libro-client";
	static osVer = "Android 34";

	/** Fetch Login Data */
	@LogMethod({
		scope,
		message: "Fetching login data...",
		secretArgs: [0, 1],
	})
	static async fetchLoginData(
		username: string,
		password: string
	): Promise<TokenMetadata> {
		const url = `${this.baseUrl}${this.loginEndpoint}`;
		return this.fetchData<TokenMetadata>(url, {
			method: "POST",
			headers: this.getHeaders(),
			body: JSON.stringify({
				grant_type: "password",
				username,
				password,
			}),
		});
	}

	/** Fetch Library */
	@LogMethod({ scope, message: "Fetching library...", secretArgs: [0] })
	static async fetchLibrary(
		authToken: string,
		page: number = 1
	): Promise<LibraryMetadata> {
		const url = `${this.baseUrl}${this.libraryEndpoint}?page=${page}`;
		const data = await this.fetchData<LibraryMetadata>(url, {
			headers: this.getHeaders(authToken),
		});
		data.audiobooks = (data.audiobooks ?? []).map((book) => ({
			...book,
			isbn: this.normalizeIsbn(book.isbn),
		}));
		return data;
	}

	/** Fetch Audiobook */
	@LogMethod({
		scope,
		message: "Fetching audiobook metadata...",
		secretArgs: [0],
	})
	static async fetchDownloadMetadata(
		authToken: string,
		isbn: string
	): Promise<DownloadMetadata> {
		logger.verbose(`Fetching download metadata for ${isbn}...`, {
			fn: "APIHandler.fetchDownloadMetadata",
		});
		// The app also sends `format=m4b` for a single packaged file; omitting it
		// returns the multi-part ZIP manifest DownloadClient expects.
		const query = new URLSearchParams({ isbn, client_version: this.appVer });
		const url = `${this.baseUrl}${this.downloadEndpoint}?${query}`;
		const data = await this.fetchData<DownloadMetadata>(url, {
			headers: this.getHeaders(authToken),
		});
		return { ...data, isbn: this.normalizeIsbn(data.isbn) };
	}

	/**
	 * True when /oauth/token turned the credentials down: the server answered
	 * with an OAuth error code (bad credentials get a JSON 401 from nginx).
	 * Not the ELB's empty 401 for a missing X-LibroFm-AppVer, and not a 429
	 * or 5xx: those are worth retrying.
	 */
	static isRejectedLogin(error: unknown): boolean {
		return (
			error instanceof ApiError &&
			error.code !== undefined &&
			(error.status === undefined ||
				(error.status < 500 && error.status !== 429))
		);
	}

	/**
	 * The app's DTOs type isbn as a long and the API has sent both strings and
	 * numbers; keep it a string so it works as an AudiobookMap/State key.
	 */
	private static normalizeIsbn(isbn: string | number): string {
		return String(isbn);
	}

	/** Fetch API Data */
	@LogMethod({ scope })
	private static async fetchData<T>(
		url: string,
		opts: RequestInit
	): Promise<T> {
		const response = await fetch(url, opts);
		if (!response.ok) throw await this.httpError(response);

		const data: any = await response.json();
		this.errorCheck(data, response);

		return data;
	}

	/** An ApiError for a non-2xx response, keeping the error code of a JSON body. */
	private static async httpError(response: Response): Promise<ApiError> {
		let body: any;
		try {
			body = await response.json();
		} catch {
			// Empty or not JSON, like the ELB's bare 401.
		}
		return new ApiError(
			response.status,
			response.statusText,
			typeof body?.error === "string" ? body.error : undefined,
			typeof body?.error_description === "string"
				? body.error_description
				: undefined
		);
	}

	/** General request headers. */
	static getHeaders = (authToken?: string) => ({
		"Content-Type": "application/json",
		"User-Agent": this.userAgent,
		"X-LibroFm-AppVer": this.appVer,
		"X-LibroFm-Device": this.device,
		"X-LibroFm-OsVer": this.osVer,
		...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
	});

	@LogMethod({ scope })
	private static errorCheck(data: any, response: Response) {
		if (Object.keys(data).length === 0) {
			throw new Error("Empty response");
		}

		if ("error" in data) {
			throw new ApiError(
				response.status,
				response.statusText,
				typeof data.error === "string"
					? data.error
					: JSON.stringify(data.error),
				data.error_description
			);
		}
	}
}
