import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import LibroFmClient from "../LibroFmClient";
import { Backoff } from "../lib/Backoff";
import { metrics } from "../lib/Metrics";

/**
 * Re-login behaviour of the real LibroFmClient and APIHandler against a
 * stubbed `fetch` (nothing leaves the machine), scanned through the shared
 * `metrics` instance exactly as service.ts does. The client gets a stub config
 * and state, so no real config file is read or rewritten.
 */

const NEW_TOKEN = "token-new";

type StubConfig = {
	username?: string;
	password?: string;
	authToken?: string;
	change(update: object): void;
};

interface Call {
	method: string;
	path: string;
	authorization?: string;
}

let now = 0;
let calls: Call[] = [];
let loginResponses: Array<() => Response> = [];
let libraryResponses: Array<() => Response> = [];

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
const failure = (status: number) =>
	new Response("", {
		status,
		statusText: status === 401 ? "Unauthorized" : "",
	});
const loginOk = () =>
	json({ access_token: NEW_TOKEN, token_type: "bearer", created_at: 1 });
const libraryOk = () =>
	json({ audiobooks: [{ isbn: "111", title: "Book" }], total_pages: 1 });

function installFetchStub() {
	globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
		const { pathname } = new URL(String(url));
		const headers = (init?.headers ?? {}) as Record<string, string>;
		calls.push({
			method: init?.method ?? "GET",
			path: pathname,
			authorization: headers.Authorization,
		});
		const queue = pathname.includes("oauth") ? loginResponses : libraryResponses;
		const next = queue.shift();
		if (!next) throw new Error(`unexpected request to ${pathname}`);
		return next();
	}) as unknown as typeof fetch;
}

function makeClient(
	options: { autoRelogin?: boolean; token?: string | undefined; credentials?: boolean } = {}
) {
	const config: StubConfig = {
		username: options.credentials === false ? undefined : "user@example.invalid",
		password: options.credentials === false ? undefined : "stored-password",
		authToken: "token" in options ? options.token : "token-old",
		change(update) {
			Object.assign(config, update);
		},
	};
	const backoff = new Backoff(undefined, undefined, () => now);
	const client = new LibroFmClient({
		autoRelogin: options.autoRelogin ?? true,
		config: config as never,
		state: { findDiff: (lib: Record<string, unknown>) => Object.values(lib) } as never,
		loginBackoff: backoff,
	});
	return { client, config, backoff };
}

/** Current value of a series in the shared registry. */
function read(series: string): number {
	const line = metrics.registry
		.render()
		.split("\n")
		.find((l) => l.startsWith(`${series} `));
	if (line === undefined) throw new Error(`missing series ${series}`);
	return Number(line.slice(series.length + 1));
}

const snapshot = () => ({
	lastSuccess: read("libro_last_successful_sync_timestamp_seconds"),
	scanOk: read('libro_scans_total{result="success"}'),
	scanFailed: read('libro_scans_total{result="error"}'),
	scanErrors: read('libro_errors_total{stage="scan"}'),
	fetchErrors: read("libro_library_fetch_errors_total"),
	loginOk: read('libro_login_total{result="success"}'),
	loginFailed: read('libro_login_total{result="error"}'),
});

const scan = (client: LibroFmClient) => metrics.trackScan(() => client.getNewBooks());

describe("service re-login", () => {
	const realFetch = globalThis.fetch;
	const realWrite = process.stdout.write;

	beforeEach(() => {
		now = 1_000_000;
		calls = [];
		loginResponses = [];
		libraryResponses = [];
		installFetchStub();
		process.stdout.write = (() => true) as typeof process.stdout.write;
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
		process.stdout.write = realWrite;
	});

	test("a missing token is replaced by logging in before the scan, which succeeds", async () => {
		const { client, config, backoff } = makeClient({ token: undefined });
		loginResponses = [loginOk];
		libraryResponses = [libraryOk];
		const before = snapshot();

		const books = await scan(client);

		expect(books).toHaveLength(1);
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"POST /oauth/token",
			"GET /api/v7/library",
		]);
		expect(calls[1].authorization).toBe(`Bearer ${NEW_TOKEN}`);
		expect(config.authToken).toBe(NEW_TOKEN);
		const after = snapshot();
		expect(after.loginOk).toBe(before.loginOk + 1);
		expect(after.loginFailed).toBe(before.loginFailed);
		expect(after.scanOk).toBe(before.scanOk + 1);
		expect(after.scanFailed).toBe(before.scanFailed);
		expect(after.lastSuccess).toBeGreaterThan(before.lastSuccess);
		expect(backoff.failures).toBe(0);
	});

	test("a valid token is used as is: no login", async () => {
		const { client } = makeClient();
		libraryResponses = [libraryOk];
		const before = snapshot();

		await scan(client);

		expect(calls.map((c) => c.path)).toEqual(["/api/v7/library"]);
		expect(calls[0].authorization).toBe("Bearer token-old");
		expect(snapshot().loginOk).toBe(before.loginOk);
	});

	test("a 401 on the library fetch clears the token, logs in once and retries once: success", async () => {
		const { client, config } = makeClient();
		libraryResponses = [() => failure(401), libraryOk];
		loginResponses = [loginOk];
		const before = snapshot();

		const books = await scan(client);

		expect(books).toHaveLength(1);
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"GET /api/v7/library",
			"POST /oauth/token",
			"GET /api/v7/library",
		]);
		expect(calls[0].authorization).toBe("Bearer token-old");
		expect(calls[2].authorization).toBe(`Bearer ${NEW_TOKEN}`);
		expect(config.authToken).toBe(NEW_TOKEN);
		const after = snapshot();
		// A scan that needed a successful re-login and then worked is a success.
		expect(after.scanOk).toBe(before.scanOk + 1);
		expect(after.scanFailed).toBe(before.scanFailed);
		expect(after.fetchErrors).toBe(before.fetchErrors);
		expect(after.loginOk).toBe(before.loginOk + 1);
		expect(after.lastSuccess).toBeGreaterThan(before.lastSuccess);
	});

	test("a 403 is treated like a 401", async () => {
		const { client } = makeClient();
		libraryResponses = [() => failure(403), libraryOk];
		loginResponses = [loginOk];

		expect(await scan(client)).toHaveLength(1);
		expect(calls.map((c) => c.path)).toEqual([
			"/api/v7/library",
			"/oauth/token",
			"/api/v7/library",
		]);
	});

	test("a 401 followed by a failed login is a failed scan; the backoff blocks the next attempt", async () => {
		const { client, config, backoff } = makeClient();
		libraryResponses = [() => failure(401)];
		loginResponses = [() => failure(401)];
		const before = snapshot();

		await expect(scan(client)).rejects.toThrow("Unauthorized");

		expect(config.authToken).toBeUndefined();
		let after = snapshot();
		expect(after.scanFailed).toBe(before.scanFailed + 1);
		expect(after.scanErrors).toBe(before.scanErrors + 1);
		expect(after.scanOk).toBe(before.scanOk);
		expect(after.lastSuccess).toBe(before.lastSuccess);
		expect(after.loginFailed).toBe(before.loginFailed + 1);
		expect(after.loginOk).toBe(before.loginOk);
		expect(backoff.failures).toBe(1);

		// The very next scan (30 s later) must not touch the login endpoint.
		calls = [];
		now += 30_000;
		await expect(scan(client)).rejects.toThrow(/next login attempt in 30s/);
		expect(calls).toEqual([]);
		after = snapshot();
		expect(after.scanFailed).toBe(before.scanFailed + 2);
		expect(after.scanErrors).toBe(before.scanErrors + 2);
		expect(after.loginFailed).toBe(before.loginFailed + 1);
	});

	test("after the backoff elapses the login is attempted again; success clears the backoff", async () => {
		const { client, config, backoff } = makeClient({ token: undefined });
		loginResponses = [() => failure(401)];
		await expect(scan(client)).rejects.toThrow();
		expect(backoff.remainingMs()).toBe(60_000);

		now += 60_000;
		loginResponses = [loginOk];
		libraryResponses = [libraryOk];
		const before = snapshot();

		expect(await scan(client)).toHaveLength(1);

		expect(config.authToken).toBe(NEW_TOKEN);
		expect(backoff.failures).toBe(0);
		expect(backoff.remainingMs()).toBe(0);
		expect(snapshot().scanOk).toBe(before.scanOk + 1);
	});

	test("repeated login failures back off exponentially", async () => {
		const { client, backoff } = makeClient({ token: undefined });
		const waits: number[] = [];
		for (let i = 0; i < 4; i++) {
			loginResponses = [() => failure(401)];
			await expect(scan(client)).rejects.toThrow();
			waits.push(backoff.remainingMs());
			now += backoff.remainingMs(); // wait it out, then the next attempt is allowed
		}
		expect(waits).toEqual([60_000, 120_000, 240_000, 480_000]);
	});

	test("a fresh token that is still rejected does not trigger a second login in the same scan", async () => {
		const { client, backoff } = makeClient({ token: undefined });
		loginResponses = [loginOk];
		libraryResponses = [() => failure(401)];
		const before = snapshot();

		// Swallowed as today: empty library, which the scan accounting counts as an error.
		expect(await scan(client)).toEqual([]);

		expect(calls.map((c) => c.path)).toEqual(["/oauth/token", "/api/v7/library"]);
		const after = snapshot();
		expect(after.loginOk).toBe(before.loginOk + 1);
		expect(after.scanFailed).toBe(before.scanFailed + 1);
		expect(after.fetchErrors).toBe(before.fetchErrors + 1);
		expect(after.lastSuccess).toBe(before.lastSuccess);
		expect(backoff.failures).toBe(1);

		// So the next scan does not log in again straight away.
		calls = [];
		now += 30_000;
		await expect(scan(client)).rejects.toThrow(/next login attempt/);
		expect(calls).toEqual([]);
	});

	test("a non-auth error (5xx) keeps today's handling: swallowed, token cleared, scan counted as failed, no re-login", async () => {
		const { client, config } = makeClient();
		libraryResponses = [() => failure(503)];
		const before = snapshot();

		expect(await scan(client)).toEqual([]);

		expect(calls.map((c) => c.path)).toEqual(["/api/v7/library"]);
		expect(config.authToken).toBeUndefined();
		const after = snapshot();
		expect(after.fetchErrors).toBe(before.fetchErrors + 1);
		expect(after.scanFailed).toBe(before.scanFailed + 1);
		expect(after.scanErrors).toBe(before.scanErrors + 1);
		expect(after.lastSuccess).toBe(before.lastSuccess);
		expect(after.loginOk + after.loginFailed).toBe(before.loginOk + before.loginFailed);
	});

	test("a network error is handled like a 5xx", async () => {
		const { client, config } = makeClient();
		libraryResponses = [
			() => {
				throw new TypeError("fetch failed");
			},
		];
		const before = snapshot();

		expect(await scan(client)).toEqual([]);

		expect(calls).toHaveLength(1);
		expect(config.authToken).toBeUndefined();
		expect(snapshot().scanFailed).toBe(before.scanFailed + 1);
	});

	test("without stored credentials there is nothing to log in with: the scan fails, no request is made", async () => {
		const { client } = makeClient({ token: undefined, credentials: false });
		const before = snapshot();

		await expect(scan(client)).rejects.toThrow(/no stored credentials/);

		expect(calls).toEqual([]);
		const after = snapshot();
		expect(after.scanFailed).toBe(before.scanFailed + 1);
		expect(after.loginFailed).toBe(before.loginFailed);
	});
});

describe("CLI behaviour (autoRelogin off) is unchanged", () => {
	const realFetch = globalThis.fetch;
	const realWrite = process.stdout.write;

	beforeEach(() => {
		now = 1_000_000;
		calls = [];
		loginResponses = [];
		libraryResponses = [];
		installFetchStub();
		process.stdout.write = (() => true) as typeof process.stdout.write;
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
		process.stdout.write = realWrite;
	});

	test("auto re-login is off by default", async () => {
		const config: StubConfig = {
			username: "u",
			password: "p",
			authToken: undefined,
			change(update) {
				Object.assign(config, update);
			},
		};
		const client = new LibroFmClient({ config: config as never, state: {} as never });

		await expect(client.getLibrary()).rejects.toThrow("Not logged in");
		expect(calls).toEqual([]); // no login attempted
	});

	test("a missing token throws Not logged in without logging in", async () => {
		const { client } = makeClient({ autoRelogin: false, token: undefined });

		await expect(client.getLibrary()).rejects.toThrow("Not logged in");
		expect(calls).toEqual([]);
	});

	test("a 401 is swallowed as before: empty library, token cleared, no re-login", async () => {
		const { client, config } = makeClient({ autoRelogin: false });
		libraryResponses = [() => failure(401)];
		const before = snapshot();

		expect(await client.getLibrary()).toEqual({});

		expect(calls.map((c) => c.path)).toEqual(["/api/v7/library"]);
		expect(config.authToken).toBeUndefined();
		expect(snapshot().fetchErrors).toBe(before.fetchErrors + 1);
	});

	test("an explicit login() works and is counted", async () => {
		const { client, config } = makeClient({ autoRelogin: false, token: undefined });
		loginResponses = [loginOk];
		const before = snapshot();

		await client.login("user@example.invalid", "stored-password");

		expect(config.authToken).toBe(NEW_TOKEN);
		expect(snapshot().loginOk).toBe(before.loginOk + 1);
	});
});
