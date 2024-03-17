import path from "path";
import fs from "fs";

const LOGS_DIR = "./logs";

const DOWNLOAD_DIR = path.join(process.cwd(), "downloads");

const STATE_DIR = process.env.CONFIG_DIR || "./config";
const STATE_FILE = "state.json";
const STATE_PATH = `${STATE_DIR}/${STATE_FILE}`;

const CONFIG_DIR = process.env.CONFIG_DIR || "./config";
const CONFIG_FILE = "config.json";
const CONFIG_PATH = `${CONFIG_DIR}/${CONFIG_FILE}`;

const METADATA_DIR = "./metadata";

const dirs = [LOGS_DIR, DOWNLOAD_DIR, STATE_DIR, CONFIG_DIR, METADATA_DIR];
for (const dir of dirs) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir);
	}
}

export { LOGS_DIR, DOWNLOAD_DIR, STATE_PATH, CONFIG_PATH, METADATA_DIR };
