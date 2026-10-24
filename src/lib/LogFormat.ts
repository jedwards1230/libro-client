/**
 * One-JSON-object-per-line log formatting.
 *
 * Kept free of side effects (unlike `Logger.ts`, which prunes the logs
 * directory on import) so it can be imported and tested in isolation.
 *
 * Field names match the cluster's Alloy `json_processor`: `level` becomes a
 * Loki label, `ts` (RFC3339) the entry timestamp, `logger` a label, and `msg`
 * the stored line. Alloy keeps ONLY `msg` in Loki, so the error text is
 * appended to `msg`; the full `error` / `stack` fields stay in the raw line
 * (`kubectl logs`).
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

	for (const [key, value] of Object.entries(fields)) {
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
