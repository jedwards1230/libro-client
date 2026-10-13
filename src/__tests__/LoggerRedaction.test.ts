import { describe, test, expect, beforeEach } from "bun:test";

// Imports the real logger (unlike Logger.test.ts) so the redaction runs through
// the exact format the file transports use.
import { getFormat, LogMethod } from "../lib/Logger";
import { persistedConfig } from "../lib/Config";
import { forgetSecrets, registerSecret } from "../lib/Security";

const MESSAGE = Symbol.for("message");

function render(info: Record<string, any>): string {
	const out = getFormat(true).transform(
		{ level: "silly", ...info } as any,
		{}
	) as any;
	return out[MESSAGE];
}

describe("Logger redaction", () => {
	// Other test files register short fake secrets such as "token".
	beforeEach(() => forgetSecrets());
	test("LogMethod args of a login never contain the credentials", () => {
		registerSecret("reader@example.invalid");
		registerSecret("Correct-Horse-1");

		const line = render({
			message: {
				args: ["reader@example.invalid", "Correct-Horse-1"],
				fn: "APIHandler.fetchLoginData",
			},
		});
		expect(line).toContain("APIHandler.fetchLoginData");
		expect(line).not.toContain("reader@example.invalid");
		expect(line).not.toContain("Correct-Horse-1");
	});

	test("request options lose the Authorization header and body password", () => {
		registerSecret("Battery-Staple-2");

		const line = render({
			message: {
				args: [
					"https://libro.fm/oauth/token",
					{
						method: "POST",
						headers: { Authorization: "Bearer tok-abc-123" },
						body: JSON.stringify({
							grant_type: "password",
							username: "someone",
							password: "Battery-Staple-2",
						}),
					},
				],
				fn: "APIHandler.fetchData",
			},
		});
		expect(line).not.toContain("tok-abc-123");
		expect(line).not.toContain("Battery-Staple-2");
		expect(line).toContain("https://libro.fm/oauth/token");
	});

	test("unregistered bearer tokens and signed URLs are scrubbed", () => {
		const line = render({
			message: "Downloading",
			fn: "DownloadClient.downloadFiles",
			urls: ["https://cdn.example.com/p1.zip?Signature=abc&Expires=9"],
			note: "Bearer fresh-token-xyz",
		});
		expect(line).not.toContain("Signature=abc");
		expect(line).not.toContain("fresh-token-xyz");
	});

	test("Config.change payloads are redacted by key", () => {
		const line = render({
			message: {
				args: [{ username: "u-name-1", password: "p-word-1", authToken: "t-1234" }],
				fn: "Config.change",
			},
		});
		expect(line).not.toContain("u-name-1");
		expect(line).not.toContain("p-word-1");
		expect(line).not.toContain("t-1234");
	});

	test("secretArgs scrubs credentials Config has never seen", () => {
		class Api {
			@LogMethod({ scope: "Api", secretArgs: [1] })
			login(_user: string, _password: string) {
				return true;
			}
		}
		new Api().login("someone", "Never-Registered-42");

		const line = render({
			message: { args: ["someone", "Never-Registered-42"], fn: "Api.login" },
		});
		expect(line).not.toContain("Never-Registered-42");
	});

	test("does not mutate the logged object", () => {
		const message = { args: ["x"], fn: "Some.fn" };
		render({ message });
		expect(message.fn).toBe("Some.fn");
	});
});

describe("persistedConfig", () => {
	test("never includes the password", () => {
		const saved = persistedConfig({
			username: "reader@example.invalid",
			password: "Correct-Horse-1",
			authToken: "tok",
			downloadDir: "/books",
		});
		expect(saved).not.toHaveProperty("password");
		expect(saved).toEqual({
			username: "reader@example.invalid",
			authToken: "tok",
			downloadDir: "/books",
		});
	});
});
