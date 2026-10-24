import { describe, test, expect } from "bun:test";
import { Writable } from "stream";
import { createLogger, format, transports } from "winston";
import {
	createJsonLog,
	formatJsonLine,
	jsonLogFormat,
	serializeError,
} from "../lib/LogFormat";

/** Split output into lines, failing on blank ones. */
function lines(text: string): string[] {
	const out = text.split("\n");
	expect(out.pop()).toBe(""); // trailing newline, nothing after it
	for (const line of out) expect(line.trim()).not.toBe("");
	return out;
}

describe("Logger", () => {
	describe("LogMethod decorator", () => {
		// Test the decorator pattern without importing the actual module
		// (which has side effects from Directories import)

		test("decorator wraps a method and preserves return value", () => {
			// Simulate the decorator pattern
			function LogMethod(opts: { scope?: string; message?: string } = {}) {
				return function (
					_target: any,
					_propertyKey: string,
					descriptor: PropertyDescriptor
				) {
					const originalMethod = descriptor.value;
					descriptor.value = function (...args: any[]) {
						return originalMethod.apply(this, args);
					};
					return descriptor;
				};
			}

			class TestClass {
				@LogMethod({ scope: "Test", message: "doing work" })
				doWork(x: number): number {
					return x * 2;
				}
			}

			const obj = new TestClass();
			expect(obj.doWork(5)).toBe(10);
		});

		test("decorator preserves async method behavior", async () => {
			function LogMethod(opts: { scope?: string } = {}) {
				return function (
					_target: any,
					_propertyKey: string,
					descriptor: PropertyDescriptor
				) {
					const originalMethod = descriptor.value;
					descriptor.value = function (...args: any[]) {
						return originalMethod.apply(this, args);
					};
					return descriptor;
				};
			}

			class TestClass {
				@LogMethod({ scope: "Test" })
				async fetchData(): Promise<string> {
					return "data";
				}
			}

			const obj = new TestClass();
			const result = await obj.fetchData();
			expect(result).toBe("data");
		});

		test("decorator passes arguments through", () => {
			const receivedArgs: any[][] = [];

			function LogMethod(opts: { scope?: string } = {}) {
				return function (
					_target: any,
					_propertyKey: string,
					descriptor: PropertyDescriptor
				) {
					const originalMethod = descriptor.value;
					descriptor.value = function (...args: any[]) {
						receivedArgs.push(args);
						return originalMethod.apply(this, args);
					};
					return descriptor;
				};
			}

			class TestClass {
				@LogMethod({ scope: "Test" })
				add(a: number, b: number): number {
					return a + b;
				}
			}

			const obj = new TestClass();
			expect(obj.add(3, 4)).toBe(7);
			expect(receivedArgs[0]).toEqual([3, 4]);
		});
	});
	describe("JSON line format", () => {
		test("emits one parseable line with ts, level, logger and msg", () => {
			const line = formatJsonLine({
				level: "info",
				logger: "service",
				msg: "Checking for new books...",
			});
			expect(line).not.toContain("\n");
			const parsed = JSON.parse(line);
			expect(parsed.level).toBe("info");
			expect(parsed.logger).toBe("service");
			expect(parsed.msg).toBe("Checking for new books...");
			// RFC3339, which is what Alloy's json_processor parses from `ts`
			expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
			expect(Date.parse(parsed.ts)).not.toBeNaN();
		});

		test("uses the given timestamp and a default logger", () => {
			const parsed = JSON.parse(
				formatJsonLine({ level: "warn", msg: "x", ts: "2026-10-23T12:00:00.000Z" })
			);
			expect(parsed.ts).toBe("2026-10-23T12:00:00.000Z");
			expect(parsed.logger).toBe("libro");
		});

		test("errors carry error (message) and stack (one string, newlines escaped)", () => {
			const err = new Error("Not logged in");
			const line = formatJsonLine({
				level: "error",
				logger: "service",
				msg: "Scan failed",
				error: err,
			});
			// The raw line has no real newline even though the stack has several.
			expect(err.stack).toContain("\n");
			expect(line).not.toContain("\n");

			const parsed = JSON.parse(line);
			expect(parsed.error).toBe("Not logged in");
			expect(typeof parsed.stack).toBe("string");
			expect(parsed.stack).toContain("Error: Not logged in");
			expect(parsed.stack).toContain("\n");
			// Alloy stores only `msg`, so the reason must be in it
			expect(parsed.msg).toBe("Scan failed: Not logged in");
		});

		test("does not repeat the error text when msg already has it", () => {
			const parsed = JSON.parse(
				formatJsonLine({
					level: "error",
					msg: "Failed to fetch library: boom",
					error: new Error("boom"),
				})
			);
			expect(parsed.msg).toBe("Failed to fetch library: boom");
		});

		test("serializes thrown strings and objects", () => {
			expect(serializeError("nope")).toEqual({ error: "nope" });
			expect(serializeError({ code: 7 })).toEqual({ error: '{"code":7}' });
			expect(serializeError(new Error("x")).stack).toContain("Error: x");
		});

		test("a multi-line message stays on one line", () => {
			const line = formatJsonLine({ level: "info", msg: "a\nb\r\nc" });
			expect(line).not.toContain("\n");
			expect(JSON.parse(line).msg).toBe("a\nb\r\nc");
		});

		test("never emits a blank msg or '<no value>'", () => {
			for (const msg of [undefined, "", "   "]) {
				const parsed = JSON.parse(formatJsonLine({ level: "info", msg }));
				expect(parsed.msg.trim()).not.toBe("");
				expect(parsed.msg).not.toContain("<no value>");
			}
			expect(
				JSON.parse(formatJsonLine({ level: "info", msg: "", fn: "State.save" })).msg
			).toBe("State.save");
		});

		test("extra fields are kept but cannot overwrite the core ones", () => {
			const parsed = JSON.parse(
				formatJsonLine({ level: "info", msg: "m", isbn: "123", count: 2 })
			);
			expect(parsed.isbn).toBe("123");
			expect(parsed.count).toBe(2);
			const keys = Object.keys(parsed);
			expect(keys.slice(0, 4)).toEqual(["ts", "level", "logger", "msg"]);
		});

		test("an unserializable field degrades to a valid one-line entry", () => {
			const circular: Record<string, unknown> = {};
			circular.self = circular;
			const line = formatJsonLine({ level: "info", msg: "m", circular });
			expect(line).not.toContain("\n");
			expect(JSON.parse(line).msg).toBe("m");
		});

		test("bigint fields are stringified instead of throwing", () => {
			const parsed = JSON.parse(formatJsonLine({ level: "info", msg: "m", n: 10n }));
			expect(parsed.n).toBe("10");
		});
	});

	describe("createJsonLog", () => {
		test("writes exactly one JSON line per call, with the scope as logger", () => {
			const out: string[] = [];
			const log = createJsonLog("service", (line) => out.push(`${line}\n`));
			log.info("one");
			log.warn("two");
			log.error("three", { error: new Error("bad"), isbn: "9" });
			log.debug("four");

			const parsed = lines(out.join("")).map((l) => JSON.parse(l));
			expect(parsed.map((p) => p.level)).toEqual(["info", "warn", "error", "debug"]);
			expect(parsed.every((p) => p.logger === "service")).toBe(true);
			expect(parsed[2].msg).toBe("three: bad");
			expect(parsed[2].error).toBe("bad");
			expect(parsed[2].isbn).toBe("9");
			expect(parsed[2].stack).toContain("Error: bad");
		});
	});

	describe("winston JSON transport", () => {
		/** A winston logger shaped like Logger.ts's, writing to a buffer. */
		function capture() {
			let buffer = "";
			const stream = new Writable({
				write(chunk, _enc, cb) {
					buffer += chunk.toString();
					cb();
				},
			});
			const logger = createLogger({
				level: "silly",
				transports: [
					new transports.Stream({
						stream,
						format: format.combine(
							format.errors({ stack: true }),
							format.splat(),
							format.timestamp(),
							jsonLogFormat
						),
					}),
				],
			});
			return {
				logger,
				output: async () => {
					await new Promise((r) => setTimeout(r, 10));
					return buffer;
				},
			};
		}

		test("every call shape used in the codebase is exactly one non-blank JSON line", async () => {
			const { logger, output } = capture();

			logger.info("plain message");
			logger.info("");
			logger.error("Failed to fetch library: boom", { fn: "LibroFmClient.getLibrary" });
			logger.error({ error: new Error("unzip failed"), fn: "DownloadClient.unzip" });
			logger.error(new Error("raw error"));
			logger.log("silly", { args: [1, "a"], message: undefined, fn: "State.save" });
			logger.log("silly", { args: [], message: "Fetching library...", fn: "LibroFmClient.getLibrary" });
			logger.verbose("Got new authToken", { fn: "LibroFmClient.login" });
			logger.warn("multi\nline");

			const parsed = lines(await output()).map((l) => JSON.parse(l));
			expect(parsed).toHaveLength(9);
			for (const p of parsed) {
				expect(typeof p.msg).toBe("string");
				expect(p.msg.trim()).not.toBe("");
				expect(p.msg).not.toContain("<no value>");
				expect(typeof p.logger).toBe("string");
				expect(Date.parse(p.ts)).not.toBeNaN();
			}
		});

		test("error objects keep their message and stack; scope comes from fn", async () => {
			const { logger, output } = capture();
			logger.error({ error: new Error("unzip failed"), fn: "DownloadClient.unzip" });

			const [p] = lines(await output()).map((l) => JSON.parse(l));
			expect(p.level).toBe("error");
			expect(p.logger).toBe("DownloadClient");
			expect(p.error).toBe("unzip failed");
			expect(p.stack).toContain("Error: unzip failed");
			expect(p.msg).toBe("DownloadClient.unzip: unzip failed");
		});

		test("no ANSI colour codes leak into the level", async () => {
			const { logger, output } = capture();
			logger.error("x");
			const [p] = lines(await output()).map((l) => JSON.parse(l));
			expect(p.level).toBe("error");
		});
	});
});
