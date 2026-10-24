import { describe, test, expect, afterEach } from "bun:test";
import http from "http";
import {
	Registry,
	createLibroMetrics,
	escapeLabelValue,
	resolveMetricsPort,
	startMetricsServer,
	DEFAULT_METRICS_PORT,
	METRICS_CONTENT_TYPE,
} from "../lib/Metrics";

interface HttpResult {
	status: number;
	headers: http.IncomingHttpHeaders;
	text: string;
}

// APIHandler.test.ts replaces globalThis.fetch with a mock and never restores
// it (files run in one process), so make real requests with node:http instead.
function request(url: string, method = "GET"): Promise<HttpResult> {
	return new Promise((resolve, reject) => {
		const req = http.request(url, { method }, (res) => {
			let text = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => (text += chunk));
			res.on("end", () =>
				resolve({ status: res.statusCode ?? 0, headers: res.headers, text })
			);
		});
		req.on("error", reject);
		req.end();
	});
}

/** Value of the first sample line whose series matches `series`. */
function sample(text: string, series: string): number | undefined {
	const line = text.split("\n").find((l) => l.startsWith(`${series} `));
	return line === undefined ? undefined : Number(line.slice(series.length + 1));
}

/** Run `fn` with stdout muted: the service logs there directly. */
function quiet<T>(fn: () => T): T {
	const write = process.stdout.write.bind(process.stdout);
	process.stdout.write = (() => true) as typeof process.stdout.write;
	try {
		return fn();
	} finally {
		process.stdout.write = write;
	}
}

describe("Metrics", () => {
	describe("exposition format", () => {
		test("renders HELP, TYPE and samples for each family", () => {
			const registry = new Registry();
			registry.counter("jobs_total", "Jobs run.").inc();
			registry.gauge("temp_celsius", "Temperature.").set(21.5);

			expect(registry.render()).toBe(
				[
					"# HELP jobs_total Jobs run.",
					"# TYPE jobs_total counter",
					"jobs_total 1",
					"# HELP temp_celsius Temperature.",
					"# TYPE temp_celsius gauge",
					"temp_celsius 21.5",
					"",
				].join("\n")
			);
		});

		test("empty registry renders nothing", () => {
			expect(new Registry().render()).toBe("");
		});

		test("output is sorted by name and label set regardless of insertion order", () => {
			const a = new Registry();
			a.gauge("zeta", "z").set(1);
			const c = a.counter("alpha_total", "a", ["k"]);
			c.inc({ k: "b" });
			c.inc({ k: "a" });

			const b = new Registry();
			const c2 = b.counter("alpha_total", "a", ["k"]);
			c2.inc({ k: "a" });
			c2.inc({ k: "b" });
			b.gauge("zeta", "z").set(1);

			expect(a.render()).toBe(b.render());
			const lines = a.render().split("\n");
			expect(lines.indexOf("# HELP alpha_total a")).toBeLessThan(
				lines.indexOf("# HELP zeta z")
			);
			expect(lines.indexOf('alpha_total{k="a"} 1')).toBeLessThan(
				lines.indexOf('alpha_total{k="b"} 1')
			);
		});

		test("renders non-finite gauge values the way Prometheus expects", () => {
			const registry = new Registry();
			const g = registry.gauge("g", "g", ["k"]);
			g.set(NaN, { k: "nan" });
			g.set(Infinity, { k: "pinf" });
			g.set(-Infinity, { k: "ninf" });
			const out = registry.render();
			expect(out).toContain('g{k="nan"} NaN');
			expect(out).toContain('g{k="pinf"} +Inf');
			expect(out).toContain('g{k="ninf"} -Inf');
		});
	});

	describe("escaping", () => {
		test("escapes backslash, double quote and newline in label values", () => {
			expect(escapeLabelValue('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd');
		});

		test("escaped label values keep the sample on one line", () => {
			const registry = new Registry();
			registry.gauge("info", "i", ["v"]).set(1, { v: 'x"y\\z\nw' });
			expect(registry.render()).toContain('info{v="x\\"y\\\\z\\nw"} 1\n');
		});

		test("escapes backslash and newline in HELP text", () => {
			const registry = new Registry();
			registry.counter("c_total", "line one\nline \\ two");
			expect(registry.render()).toContain(
				"# HELP c_total line one\\nline \\\\ two\n"
			);
		});
	});

	describe("counters and gauges", () => {
		test("counter increments by 1 or by an amount", () => {
			const c = new Registry().counter("c_total", "c");
			c.inc();
			c.inc(undefined, 4);
			expect(c.get()).toBe(5);
		});

		test("counter rejects negative and non-finite increments", () => {
			const c = new Registry().counter("c_total", "c");
			expect(() => c.inc(undefined, -1)).toThrow(RangeError);
			expect(() => c.inc(undefined, NaN)).toThrow(RangeError);
			expect(c.get()).toBe(0);
		});

		test("gauge can be set up and down", () => {
			const g = new Registry().gauge("g", "g");
			g.set(10);
			g.set(3);
			expect(g.get()).toBe(3);
		});

		test("labelled counter keeps a separate value per label set", () => {
			const c = new Registry().counter("c_total", "c", ["result"]);
			c.inc({ result: "ok" });
			c.inc({ result: "ok" });
			c.inc({ result: "fail" });
			expect(c.get({ result: "ok" })).toBe(2);
			expect(c.get({ result: "fail" })).toBe(1);
		});

		test("unlabelled metrics exist at 0 before any update", () => {
			const registry = new Registry();
			registry.counter("c_total", "c");
			registry.gauge("g", "g");
			const out = registry.render();
			expect(sample(out, "c_total")).toBe(0);
			expect(sample(out, "g")).toBe(0);
		});

		test("labelled metrics have no series until initialised or used", () => {
			const registry = new Registry();
			const c = registry.counter("c_total", "c", ["k"]);
			expect(registry.render()).not.toContain("c_total{");
			c.init({ k: "a" });
			expect(registry.render()).toContain('c_total{k="a"} 0');
		});

		test("init does not reset an existing series", () => {
			const c = new Registry().counter("c_total", "c", ["k"]);
			c.inc({ k: "a" });
			c.init({ k: "a" });
			expect(c.get({ k: "a" })).toBe(1);
		});
	});

	describe("validation", () => {
		test("rejects invalid metric and label names", () => {
			const registry = new Registry();
			expect(() => registry.counter("bad-name", "x")).toThrow();
			expect(() => registry.counter("ok_total", "x", ["bad-label"])).toThrow();
			expect(() => registry.counter("ok2_total", "x", ["__reserved"])).toThrow();
		});

		test("rejects duplicate registration", () => {
			const registry = new Registry();
			registry.counter("dup_total", "x");
			expect(() => registry.gauge("dup_total", "x")).toThrow(/already registered/);
		});

		test("rejects labels that do not match the declared names", () => {
			const c = new Registry().counter("c_total", "c", ["k"]);
			expect(() => c.inc()).toThrow();
			expect(() => c.inc({ other: "x" })).toThrow();
			expect(() => c.inc({ k: "x", extra: "y" })).toThrow();
		});
	});

	describe("libro metrics", () => {
		function setup() {
			let t = 1_700_000_000;
			const m = createLibroMetrics({
				registry: new Registry(),
				now: () => t,
			});
			return {
				m,
				advance: (s: number) => {
					t += s;
				},
				out: () => m.registry.render(),
			};
		}

		test("every contract series exists at start, before any scan", () => {
			const { out } = setup();
			const text = out();
			expect(sample(text, "libro_last_successful_sync_timestamp_seconds")).toBe(0);
			expect(sample(text, "libro_last_scan_timestamp_seconds")).toBe(0);
			expect(sample(text, 'libro_scans_total{result="success"}')).toBe(0);
			expect(sample(text, 'libro_scans_total{result="error"}')).toBe(0);
			expect(sample(text, "libro_books_downloaded_total")).toBe(0);
			expect(sample(text, 'libro_errors_total{stage="scan"}')).toBe(0);
			expect(sample(text, 'libro_errors_total{stage="download"}')).toBe(0);
			expect(sample(text, 'libro_login_total{result="success"}')).toBe(0);
			expect(sample(text, 'libro_login_total{result="error"}')).toBe(0);
		});

		test("declares the contract types", () => {
			const text = setup().out();
			expect(text).toContain("# TYPE libro_last_successful_sync_timestamp_seconds gauge");
			expect(text).toContain("# TYPE libro_last_scan_timestamp_seconds gauge");
			expect(text).toContain("# TYPE libro_scans_total counter");
			expect(text).toContain("# TYPE libro_books_downloaded_total counter");
			expect(text).toContain("# TYPE libro_errors_total counter");
			expect(text).toContain("# TYPE libro_login_total counter");
		});

		test("a successful scan stamps both timestamps, even with no new books", () => {
			const { m, out } = setup();
			m.recordScanSuccess();
			const text = out();
			expect(sample(text, "libro_last_successful_sync_timestamp_seconds")).toBe(1_700_000_000);
			expect(sample(text, "libro_last_scan_timestamp_seconds")).toBe(1_700_000_000);
			expect(sample(text, 'libro_scans_total{result="success"}')).toBe(1);
			expect(sample(text, 'libro_scans_total{result="error"}')).toBe(0);
		});

		test("a failed scan leaves the last-successful timestamp untouched", () => {
			const { m, advance, out } = setup();
			m.recordScanError();
			advance(30);
			m.recordScanError();
			const text = out();
			// The silent-failure signal: never succeeded, but scans are happening.
			expect(sample(text, "libro_last_successful_sync_timestamp_seconds")).toBe(0);
			expect(sample(text, "libro_last_scan_timestamp_seconds")).toBe(1_700_000_030);
			expect(sample(text, 'libro_scans_total{result="error"}')).toBe(2);
			expect(sample(text, 'libro_errors_total{stage="scan"}')).toBe(2);
		});

		test("success after failures advances the last-successful timestamp", () => {
			const { m, advance, out } = setup();
			m.recordScanSuccess();
			advance(30);
			m.recordScanError();
			advance(30);
			expect(sample(out(), "libro_last_successful_sync_timestamp_seconds")).toBe(1_700_000_000);
			m.recordScanSuccess();
			expect(sample(out(), "libro_last_successful_sync_timestamp_seconds")).toBe(1_700_000_060);
		});

		test("the library-fetch-error counter exists at 0 from start", () => {
			const text = setup().out();
			expect(sample(text, "libro_library_fetch_errors_total")).toBe(0);
			expect(text).toContain("# TYPE libro_library_fetch_errors_total counter");
		});

		describe("trackScan", () => {
			test("a clean scan is a success: gauge advances, value is passed through", async () => {
				const { m, out } = setup();
				const books = [{ isbn: "1" }];
				expect(await m.trackScan(async () => books)).toBe(books);
				const text = out();
				expect(sample(text, "libro_last_successful_sync_timestamp_seconds")).toBe(1_700_000_000);
				expect(sample(text, 'libro_scans_total{result="success"}')).toBe(1);
				expect(sample(text, 'libro_scans_total{result="error"}')).toBe(0);
				expect(sample(text, 'libro_errors_total{stage="scan"}')).toBe(0);
			});

			test("a swallowed library-fetch error is a failed scan, and the gauge does not move", async () => {
				const { m, out } = setup();
				// What getLibrary() does on a fetch error: record it, then return normally.
				const result = await m.trackScan(async () => {
					m.recordLibraryFetchError();
					return [] as unknown[];
				});
				expect(result).toEqual([]); // the scan's return value is untouched
				const text = out();
				expect(sample(text, "libro_last_successful_sync_timestamp_seconds")).toBe(0);
				expect(sample(text, "libro_last_scan_timestamp_seconds")).toBe(1_700_000_000);
				expect(sample(text, 'libro_scans_total{result="error"}')).toBe(1);
				expect(sample(text, 'libro_scans_total{result="success"}')).toBe(0);
				expect(sample(text, 'libro_errors_total{stage="scan"}')).toBe(1);
				expect(sample(text, "libro_library_fetch_errors_total")).toBe(1);
			});

			test("a throwing scan is a failed scan and the error is rethrown unchanged", async () => {
				const { m, out } = setup();
				const boom = new Error("Not logged in");
				await expect(m.trackScan(async () => { throw boom; })).rejects.toBe(boom);
				const text = out();
				expect(sample(text, "libro_last_successful_sync_timestamp_seconds")).toBe(0);
				expect(sample(text, 'libro_scans_total{result="error"}')).toBe(1);
				expect(sample(text, 'libro_errors_total{stage="scan"}')).toBe(1);
				// Only a swallowed fetch error moves the fetch-error counter.
				expect(sample(text, "libro_library_fetch_errors_total")).toBe(0);
			});

			test("several swallowed errors in one scan are still one failed scan", async () => {
				const { m, out } = setup();
				await m.trackScan(async () => {
					m.recordLibraryFetchError();
					m.recordLibraryFetchError();
				});
				const text = out();
				expect(sample(text, 'libro_scans_total{result="error"}')).toBe(1);
				expect(sample(text, "libro_library_fetch_errors_total")).toBe(2);
			});

			test("a fetch error outside a scan does not fail the next clean scan", async () => {
				const { m, out } = setup();
				m.recordLibraryFetchError(); // e.g. from the download stage
				await m.trackScan(async () => []);
				const text = out();
				expect(sample(text, 'libro_scans_total{result="success"}')).toBe(1);
				expect(sample(text, 'libro_scans_total{result="error"}')).toBe(0);
				expect(sample(text, "libro_last_successful_sync_timestamp_seconds")).toBe(1_700_000_000);
			});

			test("a clean scan after a failed one advances the gauge again", async () => {
				const { m, advance, out } = setup();
				await m.trackScan(async () => m.recordLibraryFetchError());
				advance(30);
				await m.trackScan(async () => []);
				const text = out();
				expect(sample(text, "libro_last_successful_sync_timestamp_seconds")).toBe(1_700_000_030);
				expect(sample(text, 'libro_scans_total{result="error"}')).toBe(1);
				expect(sample(text, 'libro_scans_total{result="success"}')).toBe(1);
			});
		});

		test("logins are counted by result and do not touch the scan series", () => {
			const { m, out } = setup();
			m.recordLogin("success");
			m.recordLogin("error");
			m.recordLogin("error");
			const text = out();
			expect(sample(text, 'libro_login_total{result="success"}')).toBe(1);
			expect(sample(text, 'libro_login_total{result="error"}')).toBe(2);
			expect(sample(text, 'libro_scans_total{result="error"}')).toBe(0);
			expect(sample(text, "libro_last_scan_timestamp_seconds")).toBe(0);
		});

		test("download events move only the download series", () => {
			const { m, out } = setup();
			m.recordDownload();
			m.recordDownload();
			m.recordDownloadError();
			const text = out();
			expect(sample(text, "libro_books_downloaded_total")).toBe(2);
			expect(sample(text, 'libro_errors_total{stage="download"}')).toBe(1);
			expect(sample(text, 'libro_errors_total{stage="scan"}')).toBe(0);
			expect(sample(text, "libro_last_scan_timestamp_seconds")).toBe(0);
		});
	});

	describe("resolveMetricsPort", () => {
		test("defaults to 9464 when unset or empty", () => {
			expect(DEFAULT_METRICS_PORT).toBe(9464);
			expect(resolveMetricsPort(undefined)).toBe(9464);
			expect(resolveMetricsPort("")).toBe(9464);
		});

		test("accepts a valid port", () => {
			expect(resolveMetricsPort("9100")).toBe(9100);
		});

		test("falls back to the default on garbage or out-of-range values", () => {
			quiet(() => {
				for (const bad of ["abc", "0", "-1", "70000", "9464.5"]) {
					expect(resolveMetricsPort(bad)).toBe(9464);
				}
			});
		});
	});

	describe("HTTP server", () => {
		const servers: Array<{ stop(force?: boolean): void }> = [];
		const start = (registry: Registry, port = 0) => {
			const server = quiet(() =>
				startMetricsServer({ port, hostname: "127.0.0.1", registry })
			);
			if (server) servers.push(server);
			return server;
		};

		afterEach(() => {
			while (servers.length) servers.pop()!.stop(true);
		});

		test("serves the registry on GET /metrics with the exposition content type", async () => {
			const registry = new Registry();
			registry.counter("hits_total", "Hits.").inc();
			const server = start(registry)!;

			const res = await request(`http://127.0.0.1:${server.port}/metrics`);
			expect(res.status).toBe(200);
			expect(res.headers["content-type"]).toBe(METRICS_CONTENT_TYPE);
			expect(res.text).toBe(registry.render());
		});

		test("reflects updates between scrapes", async () => {
			const registry = new Registry();
			const c = registry.counter("hits_total", "Hits.");
			const server = start(registry)!;
			const url = `http://127.0.0.1:${server.port}/metrics`;

			expect(sample((await request(url)).text, "hits_total")).toBe(0);
			c.inc();
			expect(sample((await request(url)).text, "hits_total")).toBe(1);
		});

		test("serves the libro series from a fresh shared-style registry", async () => {
			const m = createLibroMetrics({ registry: new Registry() });
			m.recordScanError();
			const server = start(m.registry)!;

			const { text } = await request(
				`http://127.0.0.1:${server.port}/metrics`
			);
			expect(sample(text, "libro_last_successful_sync_timestamp_seconds")).toBe(0);
			expect(sample(text, 'libro_scans_total{result="error"}')).toBe(1);
		});

		test("404 for other paths, 405 for non-GET on /metrics", async () => {
			const server = start(new Registry())!;
			const base = `http://127.0.0.1:${server.port}`;

			expect((await request(`${base}/`)).status).toBe(404);
			expect((await request(`${base}/metrics/extra`)).status).toBe(404);
			const post = await request(`${base}/metrics`, "POST");
			expect(post.status).toBe(405);
			expect(post.headers.allow).toBe("GET");
		});

		test("a port that is already taken does not throw", () => {
			const first = start(new Registry())!;
			// Same hostname and port: binding must fail, and startMetricsServer
			// must swallow that and return undefined instead of throwing.
			const second = start(new Registry(), first.port);
			expect(second).toBeUndefined();
		});
	});
});
