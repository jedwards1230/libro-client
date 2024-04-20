import path from "path";
import fs from "fs";

const PROJECT_DIR = path.join(__dirname, "..", "..");

// Downloads
const DOWNLOAD_DIR = path.join(PROJECT_DIR, "downloads");

// App data
const APP_DIR = path.join(PROJECT_DIR, "data");
const LOGS_DIR = path.join(APP_DIR, "logs");
const CONFIG_DIR = path.join(APP_DIR, "config");

// Create directories if they don't exist
const dirs = [APP_DIR, LOGS_DIR, DOWNLOAD_DIR, CONFIG_DIR];
for (const dir of dirs) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir);
	}
}

const STATE_PATH = `${CONFIG_DIR}/state.json`;
const CONFIG_PATH = `${CONFIG_DIR}/config.json`;

export { LOGS_DIR, DOWNLOAD_DIR, STATE_PATH, CONFIG_PATH };
