import fs from "fs";
import { CONFIG_PATH } from "./Constants";
import { LogMethod } from "./Logger";

const scope = "Config";

/** Configuration for the app */
export default class Config {
	username: string | undefined;
	password: string | undefined;
	authToken: string | undefined;

	constructor(config?: Partial<Config>) {
		const localConfig = this.load();
		Object.assign(this, localConfig, config);
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
		if (fs.existsSync(CONFIG_PATH)) {
			const data = fs.readFileSync(CONFIG_PATH, "utf-8");
			return JSON.parse(data);
		} else {
			fs.writeFileSync(CONFIG_PATH, JSON.stringify(this, null, 2));
			return null;
		}
	}

	/** Saves the config to the file system */
	@LogMethod({ scope })
	private save(): void {
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(this, null, 2));
	}
}
