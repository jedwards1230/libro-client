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
