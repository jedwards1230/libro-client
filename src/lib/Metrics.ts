/**
 * Minimal Prometheus metrics for the background service.
 *
 * Hand-rolled text exposition (format 0.0.4) with no dependencies: a tiny
 * registry of counters and gauges, plus a `Bun.serve` endpoint that serves it.
 * Output is deterministic: families are sorted by name and series by their
 * rendered label set.
 *
 * Logs through `createJsonLog` rather than the winston logger, which prunes
 * the logs directory at import time.
 */
import { createJsonLog } from "./LogFormat";

const log = createJsonLog("metrics");

// The slice of `Bun.serve` used here. tsconfig does not load Bun's global
// types, and importing them (`from "bun"`) would surface unrelated latent
// errors in the test files, so describe it locally.
interface BunServer {
	port: number;
	stop(closeActiveConnections?: boolean): void;
}
interface BunRuntime {
	serve(options: {
		port: number;
		hostname: string;
		fetch(req: Request): Response;
	}): BunServer;
}

export const DEFAULT_METRICS_PORT = 9464;
export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

const METRIC_NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export type Labels = Readonly<Record<string, string>>;

/** Escape a label value: backslash, double quote and newline. */
export function escapeLabelValue(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n");
}

/** Escape HELP text: backslash and newline. */
function escapeHelp(help: string): string {
	return help.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

function formatValue(value: number): string {
	if (Number.isNaN(value)) return "NaN";
	if (value === Infinity) return "+Inf";
	if (value === -Infinity) return "-Inf";
	return String(value);
}

abstract class Metric {
	/** Rendered label set (`{a="b"}` or empty) -> current value. */
	private readonly series = new Map<string, number>();

	protected constructor(
		readonly name: string,
		readonly help: string,
		readonly type: "counter" | "gauge",
		readonly labelNames: readonly string[]
	) {
		if (!METRIC_NAME_RE.test(name)) {
			throw new Error(`Invalid metric name: ${name}`);
		}
		for (const label of labelNames) {
			if (!LABEL_NAME_RE.test(label) || label.startsWith("__")) {
				throw new Error(`Invalid label name: ${label}`);
			}
		}
		// A metric without labels has exactly one series; expose it from the start.
		if (labelNames.length === 0) this.series.set("", 0);
	}

	/** Render a label set, validating it against the declared label names. */
	private key(labels: Labels = {}): string {
		const given = Object.keys(labels);
		if (
			given.length !== this.labelNames.length ||
			!this.labelNames.every((l) => Object.hasOwn(labels, l))
		) {
			throw new Error(
				`${this.name} expects labels [${this.labelNames.join(", ")}], got [${given.join(", ")}]`
			);
		}
		if (this.labelNames.length === 0) return "";
		const pairs = this.labelNames.map(
			(l) => `${l}="${escapeLabelValue(String(labels[l]))}"`
		);
		return `{${pairs.join(",")}}`;
	}

	/** Create the series at 0 if it does not exist yet. */
	init(labels?: Labels): this {
		const key = this.key(labels);
		if (!this.series.has(key)) this.series.set(key, 0);
		return this;
	}

	/** Current value of a series, or undefined if it does not exist. */
	get(labels?: Labels): number | undefined {
		return this.series.get(this.key(labels));
	}

	protected write(labels: Labels | undefined, value: number) {
		this.series.set(this.key(labels), value);
	}

	protected read(labels: Labels | undefined): number {
		return this.series.get(this.key(labels)) ?? 0;
	}

	render(): string {
		const lines = [
			`# HELP ${this.name} ${escapeHelp(this.help)}`,
			`# TYPE ${this.name} ${this.type}`,
		];
		const keys = [...this.series.keys()].sort((a, b) =>
			a < b ? -1 : a > b ? 1 : 0
		);
		for (const key of keys) {
			lines.push(`${this.name}${key} ${formatValue(this.series.get(key)!)}`);
		}
		return lines.join("\n");
	}
}

/** Monotonically increasing value. */
export class Counter extends Metric {
	constructor(name: string, help: string, labelNames: readonly string[] = []) {
		super(name, help, "counter", labelNames);
	}

	inc(labels?: Labels, by: number = 1): void {
		if (!Number.isFinite(by) || by < 0) {
			throw new RangeError(`${this.name}: counters can only increase`);
		}
		this.write(labels, this.read(labels) + by);
	}
}

/** Value that can go up and down. */
export class Gauge extends Metric {
	constructor(name: string, help: string, labelNames: readonly string[] = []) {
		super(name, help, "gauge", labelNames);
	}

	set(value: number, labels?: Labels): void {
		this.write(labels, value);
	}
}

export class Registry {
	private readonly metrics = new Map<string, Counter | Gauge>();

	private add<T extends Counter | Gauge>(metric: T): T {
		if (this.metrics.has(metric.name)) {
			throw new Error(`Metric already registered: ${metric.name}`);
		}
		this.metrics.set(metric.name, metric);
		return metric;
	}

	counter(name: string, help: string, labelNames: readonly string[] = []) {
		return this.add(new Counter(name, help, labelNames));
	}

	gauge(name: string, help: string, labelNames: readonly string[] = []) {
		return this.add(new Gauge(name, help, labelNames));
	}

	/** Prometheus text exposition, families sorted by name. */
	render(): string {
		const names = [...this.metrics.keys()].sort((a, b) =>
			a < b ? -1 : a > b ? 1 : 0
		);
		if (names.length === 0) return "";
		return names.map((n) => this.metrics.get(n)!.render()).join("\n") + "\n";
	}
}

export interface LibroMetricsOptions {
	registry?: Registry;
	/** Unix time in seconds; injectable for tests. */
	now?: () => number;
}

/**
 * The service's metrics. Each `record*` method is the single place that
 * decides which series move for an event, so it can be tested without
 * importing `service.ts` (which starts the sync loop on import).
 */
export function createLibroMetrics(options: LibroMetricsOptions = {}) {
	const registry = options.registry ?? new Registry();
	const now = options.now ?? (() => Date.now() / 1000);

	const lastSuccessfulSync = registry.gauge(
		"libro_last_successful_sync_timestamp_seconds",
		"Unix time a full library scan last completed with no error, whether or not it found new books. 0 until the first success."
	);
	const lastScan = registry.gauge(
		"libro_last_scan_timestamp_seconds",
		"Unix time the last library scan attempt finished, successful or not. 0 until the first scan finishes."
	);
	const scans = registry.counter(
		"libro_scans_total",
		"Library scans finished, by result.",
		["result"]
	);
	const booksDownloaded = registry.counter(
		"libro_books_downloaded_total",
		"Books downloaded."
	);
	const errors = registry.counter(
		"libro_errors_total",
		"Errors, by stage (scan or download).",
		["stage"]
	);
	const libraryFetchErrors = registry.counter(
		"libro_library_fetch_errors_total",
		"Library fetch errors that getLibrary() swallowed: it clears the auth token and returns an empty library instead of throwing."
	);

	const logins = registry.counter(
		"libro_login_total",
		"Login attempts, by result.",
		["result"]
	);

	scans.init({ result: "success" }).init({ result: "error" });
	logins.init({ result: "success" }).init({ result: "error" });
	errors.init({ stage: "scan" }).init({ stage: "download" });

	function recordScanSuccess() {
		const t = now();
		scans.inc({ result: "success" });
		lastScan.set(t);
		lastSuccessfulSync.set(t);
	}

	function recordScanError() {
		scans.inc({ result: "error" });
		errors.inc({ stage: "scan" });
		lastScan.set(now());
	}

	return {
		registry,

		recordScanSuccess,
		recordScanError,

		/** A login attempt finished. */
		recordLogin(result: "success" | "error") {
			logins.inc({ result });
		},

		/** `getLibrary()` hit a fetch error and swallowed it. */
		recordLibraryFetchError() {
			libraryFetchErrors.inc();
		},

		/**
		 * Run one scan and record its outcome. It is an error if `scan` throws,
		 * and also if a library-fetch error was swallowed while it ran: the
		 * scan then returns normally, but with an empty or partial library.
		 * Scans never overlap (the service has an `isRunning` guard), so
		 * comparing the counter before and after attributes errors correctly.
		 */
		async trackScan<T>(scan: () => Promise<T>): Promise<T> {
			const before = libraryFetchErrors.get() ?? 0;
			let result: T;
			try {
				result = await scan();
			} catch (error) {
				recordScanError();
				throw error;
			}
			if ((libraryFetchErrors.get() ?? 0) > before) recordScanError();
			else recordScanSuccess();
			return result;
		},

		recordDownload() {
			booksDownloaded.inc();
		},

		recordDownloadError() {
			errors.inc({ stage: "download" });
		},
	};
}

/** Shared instance used by the service. */
export const metrics = createLibroMetrics();

/** Parse `METRICS_PORT`; warn and fall back to the default if it is invalid. */
export function resolveMetricsPort(
	raw: string | undefined = process.env.METRICS_PORT
): number {
	if (raw === undefined || raw === "") return DEFAULT_METRICS_PORT;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		log.warn(`Invalid METRICS_PORT "${raw}"; using ${DEFAULT_METRICS_PORT}`);
		return DEFAULT_METRICS_PORT;
	}
	return port;
}

export interface MetricsServerOptions {
	/** Defaults to `METRICS_PORT`, else 9464. Pass 0 for an ephemeral port. */
	port?: number;
	hostname?: string;
	registry?: Registry;
}

/**
 * Serve `GET /metrics` on 0.0.0.0. Never throws: if the port cannot be bound
 * it logs a warning and returns undefined so the sync loop carries on.
 */
export function startMetricsServer(
	options: MetricsServerOptions = {}
): BunServer | undefined {
	const registry = options.registry ?? metrics.registry;
	const port = options.port ?? resolveMetricsPort();
	const hostname = options.hostname ?? "0.0.0.0";

	try {
		const { Bun } = globalThis as unknown as { Bun: BunRuntime };
		const server = Bun.serve({
			port,
			hostname,
			fetch(req) {
				if (new URL(req.url).pathname !== "/metrics") {
					return new Response("Not Found\n", { status: 404 });
				}
				if (req.method !== "GET") {
					return new Response("Method Not Allowed\n", {
						status: 405,
						headers: { Allow: "GET" },
					});
				}
				try {
					return new Response(registry.render(), {
						headers: { "Content-Type": METRICS_CONTENT_TYPE },
					});
				} catch (error) {
					log.error("Failed to render metrics", { error });
					return new Response("Internal Server Error\n", {
						status: 500,
					});
				}
			},
		});
		log.info(`Metrics available on http://${hostname}:${server.port}/metrics`, {
			port: server.port,
		});
		return server;
	} catch (error) {
		log.warn(
			`Could not start metrics server on ${hostname}:${port}; continuing without it`,
			{ error, port }
		);
		return undefined;
	}
}
