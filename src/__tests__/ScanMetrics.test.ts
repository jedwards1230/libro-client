import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import LibroFmClient from "../LibroFmClient";
import { metrics } from "../lib/Metrics";

/**
 * Wiring test: the real `LibroFmClient.getLibrary()` against a stubbed `fetch`,
 * scanned through the shared `metrics` instance exactly as service.ts does.
 *
 * The client is built without its constructor so that no real Config or State
 * is loaded: `getLibrary()` clears the auth token on a fetch error, which would
 * otherwise rewrite a developer's real config file.
 */

type StubConfig = { authToken?: string; change(update: object): void };

function makeClient() {
	const config: StubConfig = {
		authToken: "token",
		change(update) {
			Object.assign(config, update);
		},
	};
	const client = Object.assign(Object.create(LibroFmClient.prototype), {
		config,
		state: { findDiff: () => [] },
	}) as LibroFmClient;
	return { client, config };
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
	lastScan: read("libro_last_scan_timestamp_seconds"),
	ok: read('libro_scans_total{result="success"}'),
	failed: read('libro_scans_total{result="error"}'),
	scanErrors: read('libro_errors_total{stage="scan"}'),
	fetchErrors: read("libro_library_fetch_errors_total"),
});

describe("scan metrics through the real LibroFmClient", () => {
	const realFetch = globalThis.fetch;
	const realWrite = process.stdout.write;

	beforeEach(() => {
		// getLibrary() logs the fetch error to the console; keep test output quiet.
		process.stdout.write = (() => true) as typeof process.stdout.write;
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
		process.stdout.write = realWrite;
	});

	const stubFetch = (response: () => Response) => {
		globalThis.fetch = (async () => response()) as unknown as typeof fetch;
	};
	const unauthorized = () => new Response("", { status: 401, statusText: "Unauthorized" });
	const emptyLibrary = () =>
		new Response(JSON.stringify({ audiobooks: [], total_pages: 1 }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});

	test("a swallowed fetch failure is a failed scan, behaviour unchanged, gauge not advanced", async () => {
		const { client, config } = makeClient();
		stubFetch(unauthorized);
		const before = snapshot();

		const books = await metrics.trackScan(() => client.getNewBooks());

		// getLibrary() still swallows: empty result, token cleared, no throw.
		expect(books).toEqual([]);
		expect(config.authToken).toBeUndefined();

		const after = snapshot();
		expect(after.fetchErrors).toBe(before.fetchErrors + 1);
		expect(after.failed).toBe(before.failed + 1);
		expect(after.scanErrors).toBe(before.scanErrors + 1);
		expect(after.ok).toBe(before.ok);
		expect(after.lastSuccess).toBe(before.lastSuccess);
		expect(after.lastScan).toBeGreaterThan(0);
	});

	test("the next scan throws Not logged in and is also a failed scan", async () => {
		const { client, config } = makeClient();
		config.authToken = undefined;
		const before = snapshot();

		await expect(
			metrics.trackScan(() => client.getNewBooks())
		).rejects.toThrow("Not logged in");

		const after = snapshot();
		expect(after.failed).toBe(before.failed + 1);
		expect(after.scanErrors).toBe(before.scanErrors + 1);
		expect(after.ok).toBe(before.ok);
		expect(after.lastSuccess).toBe(before.lastSuccess);
		// Throwing before any fetch is not a swallowed fetch error.
		expect(after.fetchErrors).toBe(before.fetchErrors);
	});

	test("a clean scan advances the gauge", async () => {
		const { client } = makeClient();
		stubFetch(emptyLibrary);
		const before = snapshot();
		const startedAt = Date.now() / 1000;

		const books = await metrics.trackScan(() => client.getNewBooks());

		expect(books).toEqual([]);
		const after = snapshot();
		expect(after.ok).toBe(before.ok + 1);
		expect(after.failed).toBe(before.failed);
		expect(after.fetchErrors).toBe(before.fetchErrors);
		expect(after.lastSuccess).toBeGreaterThanOrEqual(startedAt - 1);
		expect(after.lastSuccess).toBeGreaterThan(before.lastSuccess);
		expect(after.lastSuccess).toBe(after.lastScan);
	});
});
