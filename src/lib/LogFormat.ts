/**
 * One-JSON-object-per-line log formatting.
 *
 * Kept free of side effects (unlike `Logger.ts`, which prunes the logs
 * directory on import) so it can be imported and tested in isolation.
 *
 * Field names suit the log shipper (Grafana Alloy): `level` and `logger`
 * become labels, `ts` (RFC3339) the entry timestamp and `msg` the stored line.
 * The shipper keeps only `msg`, so the error text is appended to it; the full
 * `error` / `stack` fields stay in the raw stdout line.
 */
import { format } from "winston";

export const DEFAULT_LOGGER = "libro";

export type LogFields = Record<string, unknown>;

export interface LogEntry extends LogFields {
	level: string;
	msg?: string;
	/** Stable scope, e.g. "service" or "LibroFmClient". */
	logger?: string;
	/** RFC3339; defaults to now. */
	ts?: string;
	/** An Error (or anything thrown); becomes `error` (message) + `stack`. */
	error?: unknown;
}

// --- Redaction -------------------------------------------------------------
// Everything that reaches a log goes through here: credentials and tokens must
// never be written, including by the @LogMethod argument dumps.

export const REDACTED = "[REDACTED]";

const SENSITIVE_NAME =
	/password|passwd|passphrase|secret|token|authorization|credential|api[-_]?key|access[-_]?key|private[-_]?key|cookie/i;

/** Names whose value is a credential: password, token, authorization, secret, key... */
export function isSensitiveName(name: string): boolean {
	return SENSITIVE_NAME.test(name) || /^(pass|key)$/i.test(name);
}

/** Mask `Bearer`/`Basic` credentials, including inside JSON-encoded strings. */
function redactString(value: string): string {
	let out = value.replace(
		/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
		`$1 ${REDACTED}`
	);
	if (/^\s*[[{]/.test(out)) {
		try {
			const parsed = JSON.parse(out);
			const redacted = redactValue(parsed, new Set());
			if (JSON.stringify(redacted) !== JSON.stringify(parsed)) {
				out = JSON.stringify(redacted);
			}
		} catch {
			// not JSON after all
		}
	}
	return out;
}

function redactValue(value: unknown, ancestors: Set<object>): unknown {
	if (typeof value === "string") return redactString(value);
	if (typeof value !== "object" || value === null) return value;
	if (
		value instanceof Error ||
		value instanceof Date ||
		ArrayBuffer.isView(value)
	) {
		return value;
	}
	if (ancestors.has(value)) return "[Circular]";
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map((v) => redactValue(v, ancestors));
		}
		const out: Record<string, unknown> = {};
		for (const [key, v] of Object.entries(value)) {
			out[key] = isSensitiveName(key) ? REDACTED : redactValue(v, ancestors);
		}
		return out;
	} finally {
		ancestors.delete(value);
	}
}

/** A copy of `value` with credential-like values masked, by key name and by shape. */
export function redact<T>(value: T): T {
	return redactValue(value, new Set()) as T;
}

/** Parameter names of a function, read from its source ([] if unreadable). */
export function paramNames(fn: (...args: any[]) => unknown): string[] {
	const source = Function.prototype.toString.call(fn);
	const open = source.indexOf("(");
	if (open < 0) return [];
	const params: string[] = [];
	let depth = 0;
	let current = "";
	for (let i = open; i < source.length; i++) {
		const ch = source[i];
		if ("([{".includes(ch)) {
			depth += 1;
			if (depth === 1) continue; // the opening parenthesis itself
		} else if (")]}".includes(ch)) {
			depth -= 1;
			if (depth === 0) {
				params.push(current);
				break;
			}
		} else if (ch === "," && depth === 1) {
			params.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	// `{ a, b }` destructuring has no single name; it is masked by key instead.
	return params.map(
		(p) => p.trim().replace(/^\.\.\./, "").match(/^[A-Za-z_$][\w$]*/)?.[0] ?? ""
	);
}

/** Positional arguments with the ones named like credentials masked. */
export function redactArgs(args: unknown[], names: string[]): unknown[] {
	return args.map((arg, i) =>
		isSensitiveName(names[i] ?? "") ? REDACTED : arg
	);
}

/** winston format: run on the logger itself so every transport sees masked values. */
export const redactFormat = format((info) => {
	for (const key of Object.keys(info)) {
		if (key === "level") continue;
		info[key] = isSensitiveName(key) ? REDACTED : redact(info[key]);
	}
	return info;
})();

/** Message and stack of anything that can be thrown, as plain strings. */
export function serializeError(err: unknown): { error: string; stack?: string } {
	if (err instanceof Error) {
		return {
			error: err.message || err.name,
			...(err.stack ? { stack: err.stack } : {}),
		};
	}
	if (typeof err === "string") return { error: err };
	try {
		return { error: JSON.stringify(err) ?? String(err) };
	} catch {
		return { error: String(err) };
	}
}

function replacer(_key: string, value: unknown) {
	if (typeof value === "bigint") return value.toString();
	if (value instanceof Error) {
		return { name: value.name, message: value.message, stack: value.stack };
	}
	return value;
}

/** Render one log event as a single line of JSON (no trailing newline). */
export function formatJsonLine(entry: LogEntry): string {
	const { level, msg, logger, ts, error, ...fields } = entry;
	const out: Record<string, unknown> = {
		ts: ts ?? new Date().toISOString(),
		level,
		logger: logger ?? DEFAULT_LOGGER,
		msg: "",
	};

	// Never emit a blank message: fall back to the call site, then a literal.
	let text = msg?.trim() ? msg : "";
	if (!text) text = typeof fields.fn === "string" ? fields.fn : "(no message)";

	if (error !== undefined) {
		const serialized = serializeError(error);
		if (!text.includes(serialized.error)) text = `${text}: ${serialized.error}`;
		out.msg = text;
		out.error = serialized.error;
		if (serialized.stack) out.stack = serialized.stack;
	} else {
		out.msg = text;
	}

	for (const [key, value] of Object.entries(redact(fields))) {
		if (!(key in out)) out[key] = value;
	}

	try {
		return JSON.stringify(out, replacer);
	} catch {
		// e.g. a circular structure in a field
		return JSON.stringify({
			ts: out.ts,
			level,
			logger: out.logger,
			msg: out.msg,
			note: "log fields could not be serialized",
		});
	}
}

/** Scope from a `Class.method` call-site name, e.g. "LibroFmClient". */
function scopeFromFn(fn: unknown): string | undefined {
	return typeof fn === "string" && fn ? fn.split(".")[0] : undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * winston format that renders every event, however it was logged, as one JSON
 * line. Handles the call shapes used in this repo: `(msg, meta)`,
 * `({ error, fn })` (winston hands us the object as `message`) and
 * `(level, { args, message, fn })`.
 */
export const jsonLogFormat = format.printf((info) => {
	const { level, message, timestamp, logger, ...rest } = info;
	const fields = { ...(isRecord(message) ? message : {}), ...rest };
	let msg = "";
	if (typeof message === "string") msg = message;
	else if (message != null && !isRecord(message)) {
		msg = JSON.stringify(message, replacer);
	}
	// `format.errors({ stack: true })` turns a logged Error into message + stack.
	const loggedError =
		typeof fields.stack === "string" && fields.error === undefined
			? { error: msg }
			: {};
	return formatJsonLine({
		...fields,
		...loggedError,
		level,
		logger: typeof logger === "string" ? logger : scopeFromFn(fields.fn),
		ts: typeof timestamp === "string" ? timestamp : undefined,
		msg,
	});
});

export type JsonLog = Record<
	"debug" | "info" | "warn" | "error",
	(msg: string, fields?: LogFields) => void
>;

/**
 * Synchronous JSON logger for entrypoint code. Writes straight to stdout, so a
 * line logged right before `process.exit()` is not lost, which a winston
 * transport cannot promise. Pass `{ error }` to attach an error and its stack.
 */
export function createJsonLog(
	scope: string,
	write: (line: string) => void = (line) => {
		process.stdout.write(`${line}\n`);
	}
): JsonLog {
	const emit = (level: string) => (msg: string, fields: LogFields = {}) =>
		write(formatJsonLine({ ...fields, level, logger: scope, msg }));
	return {
		debug: emit("debug"),
		info: emit("info"),
		warn: emit("warn"),
		error: emit("error"),
	};
}
