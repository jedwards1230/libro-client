import logger, { LogMethod } from "./lib/Logger";

const scope = "APIHandler";

export default class APIHandler {
	static baseUrl = "https://libro.fm";
	static loginEndpoint = "/oauth/token";
	static libraryEndpoint = "/api/v7/library";
	static downloadEndpoint = "/api/v9/download-manifest";
	static userAgent = "okhttp/3.14.9";

	/** Fetch Login Data */
	@LogMethod({ scope, message: "Fetching login data..." })
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
	@LogMethod({ scope, message: "Fetching library..." })
	static async fetchLibrary(
		authToken: string,
		page: number = 1
	): Promise<LibraryMetadata> {
		const url = `${this.baseUrl}${this.libraryEndpoint}?page=${page}`;
		return this.fetchData<LibraryMetadata>(url, {
			headers: this.getHeaders(authToken),
		});
	}

	/** Fetch Audiobook */
	@LogMethod({
		scope,
		message: "Fetching audiobook metadata...",
	})
	static async fetchDownloadMetadata(
		authToken: string,
		isbn: string
	): Promise<DownloadMetadata> {
		logger.verbose(`Fetching download metadata for ${isbn}...`, {
			fn: "APIHandler.fetchDownloadMetadata",
		});
		const url = `${this.baseUrl}${this.downloadEndpoint}?isbn=${isbn}`;
		return this.fetchData<DownloadMetadata>(url, {
			headers: this.getHeaders(authToken),
		});
	}

	/** Fetch API Data */
	@LogMethod({ scope })
	private static async fetchData<T>(
		url: string,
		opts: RequestInit
	): Promise<T> {
		const response = await fetch(url, opts);
		this.statusCheck(response);

		const data: any = await response.json();
		this.errorCheck(data);

		return data;
	}

	/** General request headers. */
	static getHeaders = (authToken?: string) => ({
		"Content-Type": "application/json",
		Authorization: `Bearer ${authToken}`,
		...(authToken ? { "User-Agent": this.userAgent } : {}),
	});

	@LogMethod({ scope })
	private static statusCheck(response: Response) {
		if (!response.ok) {
			throw new Error(response.statusText);
		}
	}

	@LogMethod({ scope })
	private static errorCheck(data: any) {
		if (Object.keys(data).length === 0) {
			throw new Error("Empty response");
		}

		if ("error" in data) {
			throw new Error(data.error);
		}
	}
}
