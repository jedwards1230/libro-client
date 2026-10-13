import path from "path";
import fs from "fs";

const PROJECT_DIR = path.join(__dirname, "..", "..");

// Downloads
const DOWNLOAD_DIR = path.join(PROJECT_DIR, "downloads");

// App data
const APP_DIR = path.join(PROJECT_DIR, "data");
const CACHE_DIR = path.join(APP_DIR, "cache");
const LOGS_DIR = path.join(APP_DIR, "logs");
const CONFIG_DIR = path.join(APP_DIR, "config");

// Create directories if they don't exist. App data (token, logs, cache) is
// private to the current user; downloads keep the default permissions.
const privateDirs = [APP_DIR, LOGS_DIR, CACHE_DIR, CONFIG_DIR];
const dirs = [APP_DIR, LOGS_DIR, CACHE_DIR, DOWNLOAD_DIR, CONFIG_DIR];
for (const dir of dirs) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir);
	}
	if (privateDirs.includes(dir)) {
		fs.chmodSync(dir, 0o700);
	}
}

const STATE_PATH = `${CONFIG_DIR}/state.json`;
const CONFIG_PATH = `${CONFIG_DIR}/config.json`;

export { LOGS_DIR, CACHE_DIR, DOWNLOAD_DIR, STATE_PATH, CONFIG_PATH };
