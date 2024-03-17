import path from "path";
import fs from "fs";

const CURRENT_DIR = process.cwd();

const LOGS_DIR = path.join(CURRENT_DIR, "logs");

const DOWNLOAD_DIR = path.join(CURRENT_DIR, "downloads");

const STATE_DIR = path.join(CURRENT_DIR, process.env.CONFIG_DIR || "config");
const STATE_FILE = "state.json";
const STATE_PATH = `${STATE_DIR}/${STATE_FILE}`;

const CONFIG_DIR = path.join(CURRENT_DIR, process.env.CONFIG_DIR || "config");
const CONFIG_FILE = "config.json";
const CONFIG_PATH = `${CONFIG_DIR}/${CONFIG_FILE}`;

const dirs = [LOGS_DIR, DOWNLOAD_DIR, STATE_DIR, CONFIG_DIR];
for (const dir of dirs) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir);
	}
}

export { LOGS_DIR, DOWNLOAD_DIR, STATE_PATH, CONFIG_PATH };
