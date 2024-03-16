import fs from "fs";

/** Configuration for the app */
export default class Config {
	baseUrl = "https://libro.fm";
	loginEndpoint = "/oauth/token";
	libraryEndpoint = "/api/v7/library";
	downloadEndpoint = "/api/v9/download-manifest";
	username: string | undefined;
	password: string | undefined;
	authToken: string | undefined;

	constructor(config?: Partial<Config>) {
		const localConfig = this.load();
		Object.assign(this, localConfig, config);
	}

	/** Loads the config from the file system */
	private load = (): Config | null => {
		if (fs.existsSync("config.json")) {
			const data = fs.readFileSync("config.json", "utf-8");
			return JSON.parse(data);
		} else {
			fs.writeFileSync("config.json", JSON.stringify(this, null, 2));
			return null;
		}
	};

	/** Saves the config to the file system */
	save = (config: Partial<Config>): void => {
		Object.assign(this, config);
		fs.writeFileSync("config.json", JSON.stringify(this, null, 2));
	};
}
