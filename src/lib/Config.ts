import fs from "fs";
import { CONFIG_PATH } from "./Directories";
import { LogMethod } from "./Logger";

const USERNAME = process.env.LIBROFM_USERNAME;
const PASSWORD = process.env.LIBROFM_PASSWORD;

const scope = "Config";

/** Configuration for the app */
export default class Config {
	username: string | undefined;
	password: string | undefined;
	authToken: string | undefined;

	constructor(config?: Partial<Config>) {
		this.load();
		Object.assign(this, config);
	}

	/** Changes the config */
	@LogMethod({ scope })
	change(config: Partial<Config>): void {
		Object.assign(this, config);
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
		} else {
			fs.writeFileSync(CONFIG_PATH, JSON.stringify(this, null, 2));
		}
		this.loadEnv();
		return config;
	}

	/** Load Environment variables */
	@LogMethod({ scope })
	private loadEnv(override = false): void {
		if (override || !this.username) this.username = USERNAME;
		if (override || !this.password) this.password = PASSWORD;
	}

	/** Saves the config to the file system */
	@LogMethod({ scope })
	private save(): void {
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(this, null, 2));
	}
}
