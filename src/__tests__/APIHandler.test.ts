import { describe, test, expect, mock, beforeEach } from "bun:test";
import APIHandler from "../APIHandler";

describe("APIHandler", () => {
	describe("getHeaders", () => {
		test("returns Content-Type header without auth token", () => {
			const headers = APIHandler.getHeaders();
			expect(headers["Content-Type"]).toBe("application/json");
			expect(headers.Authorization).toBe("Bearer undefined");
		});

		test("returns Content-Type and Authorization with auth token", () => {
			const headers = APIHandler.getHeaders("test-token");
			expect(headers["Content-Type"]).toBe("application/json");
			expect(headers.Authorization).toBe("Bearer test-token");
		});

		test("includes User-Agent when auth token is provided", () => {
			const headers = APIHandler.getHeaders("test-token");
			expect(headers["User-Agent"]).toBe("okhttp/3.14.9");
		});

		test("omits User-Agent when no auth token is provided", () => {
			const headers = APIHandler.getHeaders();
			expect(headers).not.toHaveProperty("User-Agent");
		});
	});

	describe("static properties", () => {
		test("has correct base URL", () => {
			expect(APIHandler.baseUrl).toBe("https://libro.fm");
		});

		test("has correct login endpoint", () => {
			expect(APIHandler.loginEndpoint).toBe("/oauth/token");
		});

		test("has correct library endpoint", () => {
			expect(APIHandler.libraryEndpoint).toBe("/api/v7/library");
		});

		test("has correct download endpoint", () => {
			expect(APIHandler.downloadEndpoint).toBe("/api/v9/download-manifest");
		});
	});

	describe("fetchLoginData", () => {
		beforeEach(() => {
			mock.restore();
		});

		test("sends POST request with credentials", async () => {
			const mockResponse = {
				access_token: "abc123",
				token_type: "bearer",
				created_at: Date.now(),
			};

			const fetchMock = mock(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve(mockResponse),
				} as Response)
			);
			globalThis.fetch = fetchMock;

			const result = await APIHandler.fetchLoginData("user@test.com", "pass123");

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, opts] = fetchMock.mock.calls[0];
			expect(url).toBe("https://libro.fm/oauth/token");
			expect(opts.method).toBe("POST");
			const body = JSON.parse(opts.body as string);
			expect(body.grant_type).toBe("password");
			expect(body.username).toBe("user@test.com");
			expect(body.password).toBe("pass123");
			expect(result.access_token).toBe("abc123");
		});

		test("throws on non-ok response", async () => {
			const fetchMock = mock(() =>
				Promise.resolve({
					ok: false,
					statusText: "Unauthorized",
				} as Response)
			);
			globalThis.fetch = fetchMock;

			expect(APIHandler.fetchLoginData("bad", "creds")).rejects.toThrow(
				"Unauthorized"
			);
		});

		test("throws on error response body", async () => {
			const fetchMock = mock(() =>
				Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({ error: "invalid_grant" }),
				} as Response)
			);
			globalThis.fetch = fetchMock;

			expect(APIHandler.fetchLoginData("user", "pass")).rejects.toThrow(
				"invalid_grant"
			);
		});

		test("throws on empty response body", async () => {
			const fetchMock = mock(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve({}),
				} as Response)
			);
			globalThis.fetch = fetchMock;

			expect(APIHandler.fetchLoginData("user", "pass")).rejects.toThrow(
				"Empty response"
			);
		});
	});

	describe("fetchLibrary", () => {
		beforeEach(() => {
			mock.restore();
		});

		test("sends GET request with auth token and page", async () => {
			const mockLibrary: LibraryMetadata = {
				page: 1,
				total_pages: 1,
				audiobooks: [
					{ isbn: "1234567890", title: "Test Book" },
				],
				tags: [],
			};

			const fetchMock = mock(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve(mockLibrary),
				} as Response)
			);
			globalThis.fetch = fetchMock;

			const result = await APIHandler.fetchLibrary("token123", 2);

			const [url, opts] = fetchMock.mock.calls[0];
			expect(url).toBe("https://libro.fm/api/v7/library?page=2");
			expect(opts.headers.Authorization).toBe("Bearer token123");
			expect(result.audiobooks).toHaveLength(1);
		});

		test("defaults to page 1", async () => {
			const mockLibrary: LibraryMetadata = {
				page: 1,
				total_pages: 1,
				audiobooks: [],
				tags: [],
			};

			const fetchMock = mock(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve(mockLibrary),
				} as Response)
			);
			globalThis.fetch = fetchMock;

			await APIHandler.fetchLibrary("token123");

			const [url] = fetchMock.mock.calls[0];
			expect(url).toBe("https://libro.fm/api/v7/library?page=1");
		});
	});

	describe("fetchDownloadMetadata", () => {
		beforeEach(() => {
			mock.restore();
		});

		test("sends GET request with isbn", async () => {
			const mockMeta: DownloadMetadata = {
				isbn: "1234567890",
				parts: [{ url: "https://example.com/part1.zip", size_bytes: 1000 }],
				tracks: [],
				expires_at: "2025-01-01",
				version: "1",
				size_bytes: 1000,
			};

			const fetchMock = mock(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve(mockMeta),
				} as Response)
			);
			globalThis.fetch = fetchMock;

			const result = await APIHandler.fetchDownloadMetadata("token", "1234567890");

			const [url] = fetchMock.mock.calls[0];
			expect(url).toBe(
				"https://libro.fm/api/v9/download-manifest?isbn=1234567890"
			);
			expect(result.isbn).toBe("1234567890");
		});
	});
});
