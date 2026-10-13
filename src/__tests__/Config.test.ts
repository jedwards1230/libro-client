import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import {
	DEFAULT_PARALLEL_DOWNLOADS,
	DEFAULT_POLL_MINUTES,
	parallelDownloads,
	pollIntervalMs,
} from "../lib/Config";

describe("Config", () => {
	let tmpDir: string;
	let configPath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "libro-config-test-"));
		configPath = path.join(tmpDir, "config.json");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// Replicate Config logic without module-level side effects
	function createConfig(
		initial?: Partial<{
			username: string;
			password: string;
			authToken: string;
		}>
	) {
		const config = {
			username: undefined as string | undefined,
			password: undefined as string | undefined,
			authToken: undefined as string | undefined,

			change(update: Partial<typeof config>) {
				Object.assign(this, update);
				this.save();
			},

			load() {
				if (fs.existsSync(configPath)) {
					const data = fs.readFileSync(configPath, "utf-8");
					const parsed = JSON.parse(data);
					Object.assign(this, parsed);
				}
			},

			save() {
				// The password is never written to disk (see persistedConfig).
				const { username, authToken } = this;
				fs.writeFileSync(
					configPath,
					JSON.stringify({ username, authToken }, null, 2)
				);
			},
		};

		if (initial) {
			Object.assign(config, initial);
		}

		return config;
	}

	describe("change", () => {
		test("updates username", () => {
			const config = createConfig();
			config.change({ username: "user@test.com" });
			expect(config.username).toBe("user@test.com");
		});

		test("updates password", () => {
			const config = createConfig();
			config.change({ password: "secret" });
			expect(config.password).toBe("secret");
		});

		test("updates authToken", () => {
			const config = createConfig();
			config.change({ authToken: "token123" });
			expect(config.authToken).toBe("token123");
		});

		test("persists changes to disk", () => {
			const config = createConfig();
			config.change({ username: "persisted" });

			const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			expect(saved.username).toBe("persisted");
		});

		test("partial update preserves other fields", () => {
			const config = createConfig({
				username: "user",
				password: "pass",
			});
			config.save();

			config.change({ authToken: "newtoken" });
			expect(config.username).toBe("user");
			expect(config.password).toBe("pass");
			expect(config.authToken).toBe("newtoken");
		});

		test("can clear authToken by setting undefined", () => {
			const config = createConfig({ authToken: "old" });
			config.change({ authToken: undefined });
			expect(config.authToken).toBeUndefined();
		});
	});

	describe("persistence", () => {
		test("load restores saved config without the password", () => {
			const config1 = createConfig();
			config1.change({
				username: "user@test.com",
				password: "secret",
				authToken: "abc",
			});

			const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			expect(saved).not.toHaveProperty("password");

			const config2 = createConfig();
			config2.load();
			expect(config2.username).toBe("user@test.com");
			expect(config2.password).toBeUndefined();
			expect(config2.authToken).toBe("abc");
		});

		test("load with no file does not throw", () => {
			const config = createConfig();
			expect(() => config.load()).not.toThrow();
		});
	});

	describe("constructor defaults", () => {
		test("fields are undefined by default", () => {
			const config = createConfig();
			expect(config.username).toBeUndefined();
			expect(config.password).toBeUndefined();
			expect(config.authToken).toBeUndefined();
		});

		test("accepts initial values", () => {
			const config = createConfig({
				username: "init-user",
				password: "init-pass",
			});
			expect(config.username).toBe("init-user");
			expect(config.password).toBe("init-pass");
		});
	});

	describe("pollIntervalMs", () => {
		test("defaults to 15 minutes when unset or empty", () => {
			expect(DEFAULT_POLL_MINUTES).toBe(15);
			expect(pollIntervalMs(undefined)).toBe(15 * 60_000);
			expect(pollIntervalMs("")).toBe(15 * 60_000);
			expect(pollIntervalMs("  ")).toBe(15 * 60_000);
		});

		test("reads minutes, fractions included", () => {
			expect(pollIntervalMs("60")).toBe(60 * 60_000);
			expect(pollIntervalMs("0.5")).toBe(30_000);
		});

		test("rejects values that are not a positive number", () => {
			for (const bad of ["0", "-5", "abc", "15m", "Infinity"]) {
				expect(() => pollIntervalMs(bad)).toThrow("LIBROFM_POLL_MINUTES");
			}
		});

		test("rejects intervals setInterval cannot hold", () => {
			expect(pollIntervalMs("35791")).toBe(35791 * 60_000);
			expect(() => pollIntervalMs("35792")).toThrow("at most 35791");
		});
	});

	describe("parallelDownloads", () => {
		test("defaults to 4 when unset or empty", () => {
			expect(DEFAULT_PARALLEL_DOWNLOADS).toBe(4);
			expect(parallelDownloads(undefined)).toBe(4);
			expect(parallelDownloads("")).toBe(4);
			expect(parallelDownloads("  ")).toBe(4);
		});

		test("reads a whole number", () => {
			expect(parallelDownloads("1")).toBe(1);
			expect(parallelDownloads("8")).toBe(8);
		});

		test("rejects values that are not a whole number of 1 or more", () => {
			for (const bad of ["0", "-2", "2.5", "abc", "Infinity"]) {
				expect(() => parallelDownloads(bad)).toThrow(
					"LIBROFM_PARALLEL_DOWNLOADS"
				);
			}
		});
	});
});
