import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import { Writable } from "stream";
import { format, transports } from "winston";
import LibroFmClient from "../LibroFmClient";
import logger, { LogMethod } from "../lib/Logger";
import { LOGS_DIR } from "../lib/Directories";
import {
	REDACTED,
	createJsonLog,
	formatJsonLine,
	isSensitiveName,
	paramNames,
	redact,
	redactArgs,
} from "../lib/LogFormat";

const PASSWORD = "pw-SENTINEL-9f3a41";
const OLD_TOKEN = "tok-SENTINEL-old-7712";
const NEW_TOKEN = "tok-SENTINEL-new-8843";

describe("redaction helpers", () => {
	test("names that carry credentials are sensitive", () => {
		for (const name of [
			"password",
			"Password",
			"passwd",
			"token",
			"authToken",
			"access_token",
			"refreshToken",
			"Authorization",
			"secret",
			"clientSecret",
			"key",
			"apiKey",
			"api_key",
			"LIBROFM_PASSWORD",
			"cookie",
		]) {
			expect(isSensitiveName(name)).toBe(true);
		}
	});

	test("ordinary names are not", () => {
		for (const name of ["username", "isbn", "title", "downloadDir", "page", "monkey", "fn", ""]) {
			expect(isSensitiveName(name)).toBe(false);
		}
	});

	test("redact masks sensitive keys at any depth and leaves the rest alone", () => {
		const input = {
			config: { username: "u", password: PASSWORD, authToken: OLD_TOKEN, downloadDir: "/d" },
			list: [{ access_token: NEW_TOKEN, isbn: "1" }],
		};
		expect(redact(input)).toEqual({
			config: { username: "u", password: REDACTED, authToken: REDACTED, downloadDir: "/d" },
			list: [{ access_token: REDACTED, isbn: "1" }],
		});
		// the original is not modified
		expect(input.config.password).toBe(PASSWORD);
	});

	test("redact masks Bearer credentials in strings and JSON-encoded bodies", () => {
		const body = JSON.stringify({ grant_type: "password", username: "u", password: PASSWORD });
		const out = redact({
			headers: { Authorization: `Bearer ${OLD_TOKEN}` },
			note: `sent Bearer ${NEW_TOKEN} today`,
			body,
		});
		const text = JSON.stringify(out);
		for (const secret of [PASSWORD, OLD_TOKEN, NEW_TOKEN]) expect(text).not.toContain(secret);
		expect(JSON.parse((out as { body: string }).body).username).toBe("u");
	});

	test("redact leaves plain values, errors and dates intact and survives cycles", () => {
		const error = new Error("boom");
		const date = new Date(0);
		const cyclic: Record<string, unknown> = { a: 1 };
		cyclic.self = cyclic;
		const out = redact({ n: 1, s: "plain text", error, date, cyclic }) as Record<string, any>;
		expect(out.n).toBe(1);
		expect(out.s).toBe("plain text");
		expect(out.error).toBe(error);
		expect(out.date).toBe(date);
		expect(out.cyclic.self).toBe("[Circular]");
	});

	test("paramNames reads parameter names, including defaults and destructuring", () => {
		class A {
			async login(username: string, password: string) {
				return [username, password];
			}
			static f(authToken: string, page = 1, { a }: { a?: number } = {}, ...rest: number[]) {
				return [authToken, page, a, rest];
			}
			g() {}
			h(a = Math.max(1, 2), token: string) {
				return [a, token];
			}
		}
		expect(paramNames(A.prototype.login)).toEqual(["username", "password"]);
		expect(paramNames(A.f)).toEqual(["authToken", "page", "", "rest"]);
		expect(paramNames(A.prototype.g)).toEqual([""]);
		expect(paramNames(A.prototype.h)).toEqual(["a", "token"]);
	});

	test("redactArgs masks positional arguments by parameter name", () => {
		expect(redactArgs(["user", PASSWORD], ["username", "password"])).toEqual(["user", REDACTED]);
		expect(redactArgs([OLD_TOKEN, 2], ["authToken", "page"])).toEqual([REDACTED, 2]);
	});

	test("the JSON line formatter masks credentials in fields as a safety net", () => {
		const line = formatJsonLine({
			level: "info",
			msg: "x",
			config: { password: PASSWORD, authToken: OLD_TOKEN },
		});
		expect(line).not.toContain(PASSWORD);
		expect(line).not.toContain(OLD_TOKEN);
		const out: string[] = [];
		createJsonLog("t", (l) => out.push(l)).info("x", { token: NEW_TOKEN });
		expect(out.join("")).not.toContain(NEW_TOKEN);
	});
});

describe("what the logger writes", () => {
	const realFetch = globalThis.fetch;
	const realWrite = process.stdout.write;
	let transport: transports.StreamTransportInstance;
	let captured = "";

	beforeEach(() => {
		captured = "";
		const stream = new Writable({
			write(chunk, _encoding, callback) {
				captured += chunk.toString();
				callback();
			},
		});
		// A pass-through format: any masking must already have happened on the logger.
		transport = new transports.Stream({ stream, level: "silly", format: format.json() });
		logger.add(transport);
		process.stdout.write = (() => true) as typeof process.stdout.write;
	});

	afterEach(() => {
		logger.remove(transport);
		globalThis.fetch = realFetch;
		process.stdout.write = realWrite;
	});

	const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

	/** Everything on disk after the logger has flushed a marker line. */
	async function sillyLogFile(): Promise<string> {
		const marker = `MARKER-${Math.random().toString(36).slice(2)}`;
		logger.info(marker);
		const file = path.join(LOGS_DIR, "silly.log");
		for (let i = 0; i < 100; i++) {
			const text = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
			if (text.includes(marker)) return text;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error("log file was not flushed");
	}

	function expectNoSecrets(text: string) {
		for (const secret of [PASSWORD, OLD_TOKEN, NEW_TOKEN]) {
			expect(text).not.toContain(secret);
		}
	}

	const json = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

	function client(token: string | undefined) {
		const config: Record<string, unknown> = {
			username: "user@example.invalid",
			password: PASSWORD,
			authToken: token,
			change(update: object) {
				Object.assign(config, update);
			},
		};
		return new LibroFmClient({
			autoRelogin: true,
			config: config as never,
			state: { findDiff: () => [] } as never,
		});
	}

	test("@LogMethod masks arguments named like credentials, and credential keys inside objects", async () => {
		class Probe {
			@LogMethod({ scope: "Probe" })
			login(username: string, password: string) {
				return `${username}:${password.length}`;
			}
			@LogMethod({ scope: "Probe" })
			fetchLibrary(authToken: string, page: number) {
				return [authToken, page];
			}
			@LogMethod({ scope: "Probe" })
			change(config: { authToken?: string; password?: string; downloadDir?: string }) {
				return config;
			}
			@LogMethod({ scope: "Probe" })
			request(url: string, opts: { headers: Record<string, string>; body: string }) {
				return [url, opts];
			}
		}
		const probe = new Probe();
		probe.login("user@example.invalid", PASSWORD);
		probe.fetchLibrary(OLD_TOKEN, 2);
		probe.change({ authToken: NEW_TOKEN, password: PASSWORD, downloadDir: "/downloads" });
		probe.request("https://example.invalid/x", {
			headers: { Authorization: `Bearer ${OLD_TOKEN}` },
			body: JSON.stringify({ username: "u", password: PASSWORD }),
		});
		await settle();

		expectNoSecrets(captured);
		// not vacuous: the calls were logged, with the safe arguments intact
		expect(captured).toContain("Probe.login");
		expect(captured).toContain("user@example.invalid");
		expect(captured).toContain("/downloads");
		expect(captured).toContain(REDACTED);
		expectNoSecrets(await sillyLogFile());
	});

	test("a successful login never writes the password or the token it receives", async () => {
		globalThis.fetch = (async () =>
			json({ access_token: NEW_TOKEN, token_type: "bearer", created_at: 1 })) as unknown as typeof fetch;

		await client(undefined).login("user@example.invalid", PASSWORD);
		await settle();

		expectNoSecrets(captured);
		expect(captured).toContain("APIHandler.fetchLoginData");
		expect(captured).toContain("LibroFmClient.login");
		expect(captured).toContain(REDACTED);
		expectNoSecrets(await sillyLogFile());
	});

	test("a failed login never writes the password", async () => {
		globalThis.fetch = (async () =>
			new Response("", { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch;

		await expect(client(undefined).login("user@example.invalid", PASSWORD)).rejects.toThrow("Unauthorized");
		await settle();

		expectNoSecrets(captured);
		expect(captured).toContain("APIHandler.fetchLoginData");
		expectNoSecrets(await sillyLogFile());
	});

	test("a re-login (rejected token, new login, retry) never writes the password or either token", async () => {
		const seen: string[] = [];
		globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
			const { pathname } = new URL(String(url));
			const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
			seen.push(`${pathname} ${auth ?? ""}`);
			if (pathname.includes("oauth")) {
				return json({ access_token: NEW_TOKEN, token_type: "bearer", created_at: 1 });
			}
			if (auth === `Bearer ${OLD_TOKEN}`) return new Response("", { status: 401, statusText: "Unauthorized" });
			return json({ audiobooks: [], total_pages: 1 });
		}) as unknown as typeof fetch;

		await client(OLD_TOKEN).getLibrary();
		await settle();

		// the flow really happened: old token rejected, login, new token used
		expect(seen).toEqual([
			`/api/v7/library Bearer ${OLD_TOKEN}`,
			"/oauth/token ",
			`/api/v7/library Bearer ${NEW_TOKEN}`,
		]);
		expectNoSecrets(captured);
		expect(captured).toContain("APIHandler.fetchLibrary");
		expect(captured).toContain("LibroFmClient.getLibrary");
		expectNoSecrets(await sillyLogFile());
	});
});
