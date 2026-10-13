import fs from "fs";
import { CONFIG_PATH } from "./Directories";
import { LogMethod } from "./Logger";
import { registerSecret, writePrivateFile } from "./Security";

const USERNAME = process.env.LIBROFM_USERNAME;
const PASSWORD = process.env.LIBROFM_PASSWORD;
const DOWNLOAD_DIR = process.env.LIBROFM_DOWNLOAD_DIR;

const scope = "Config";

/**
 * The fields written to config.json. The password is deliberately left out:
 * the cached authToken is enough to stay logged in, and a fresh login takes
 * the password from LIBROFM_PASSWORD or an interactive prompt.
 */
export function persistedConfig(config: Partial<Config>) {
	const { password, ...persisted } = config;
	return persisted;
}

/** Minutes between library checks in the background service. */
export const DEFAULT_POLL_MINUTES = 15;
// setInterval fires immediately for delays above 2^31 - 1 ms (~24.8 days).
const MAX_POLL_MS = 2 ** 31 - 1;

/**
 * Milliseconds between the background service's library checks: the
 * LIBROFM_POLL_MINUTES env var (fractions allowed), or 15 minutes if unset.
 */
export function pollIntervalMs(
	minutes: string | undefined = process.env.LIBROFM_POLL_MINUTES
): number {
	if (minutes === undefined || minutes.trim() === "") {
		return DEFAULT_POLL_MINUTES * 60_000;
	}
	const ms = Number(minutes) * 60_000;
	if (!(ms > 0 && ms <= MAX_POLL_MS)) {
		throw new Error(
			`LIBROFM_POLL_MINUTES must be a number of minutes above 0 and at most ${Math.floor(MAX_POLL_MS / 60_000)}, got "${minutes}"`
		);
	}
	return ms;
}

/** New books the background service downloads at the same time. */
export const DEFAULT_PARALLEL_DOWNLOADS = 4;

/**
 * How many new books the background service downloads at once: the
 * LIBROFM_PARALLEL_DOWNLOADS env var (a whole number, 1 or more), or 4 if unset.
 */
export function parallelDownloads(
	value: string | undefined = process.env.LIBROFM_PARALLEL_DOWNLOADS
): number {
	if (value === undefined || value.trim() === "") {
		return DEFAULT_PARALLEL_DOWNLOADS;
	}
	const count = Number(value);
	if (!Number.isInteger(count) || count < 1) {
		throw new Error(
			`LIBROFM_PARALLEL_DOWNLOADS must be a whole number of 1 or more, got "${value}"`
		);
	}
	return count;
}

/** Configuration for the app */
export default class Config {
	username: string | undefined;
	password: string | undefined;
	authToken: string | undefined;
	downloadDir: string | undefined;

	constructor(config?: Partial<Config>) {
		this.load();
		Object.assign(this, config);
	}

	/** Changes the config */
	@LogMethod({ scope })
	change(config: Partial<Config>): void {
		Object.assign(this, config);
		this.registerSecrets();
		this.save();
	}

	/** Loads the config from the file system */
	@LogMethod({ scope })
	private load(): Config | null {
		let config: Config | null = null;
		if (fs.existsSync(CONFIG_PATH)) {
			const data = fs.readFileSync(CONFIG_PATH, "utf-8");
			config = JSON.parse(data);
			Object.assign(this, config);
			// Older versions saved the password; rewrite the file without it.
			if (config && "password" in config) this.save();
		} else {
			this.save();
		}
		this.loadEnv();
		this.registerSecrets();
		return config;
	}

	/** Keep credentials out of the logs wherever they appear. */
	private registerSecrets(): void {
		registerSecret(this.username);
		registerSecret(this.password);
		registerSecret(this.authToken);
	}

	/** Load Environment variables */
	@LogMethod({ scope })
	private loadEnv(override = false): void {
		if (override || !this.username) this.username = USERNAME;
		if (override || !this.password) this.password = PASSWORD;
		if (override || !this.downloadDir) this.downloadDir = DOWNLOAD_DIR;
	}

	/** Saves the config to the file system */
	@LogMethod({ scope })
	private save(): void {
		writePrivateFile(
			CONFIG_PATH,
			JSON.stringify(persistedConfig(this), null, 2)
		);
	}
}
