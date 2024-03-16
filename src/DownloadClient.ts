import path from "path";
import fs from "fs";
import JSZip from "jszip";

const DOWNLOAD_DIR = path.join(process.cwd(), "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) {
	fs.mkdirSync(DOWNLOAD_DIR);
}

/** Helper class for downloading and unzipping files */
export default class DownloadCLient {
	/**
	 * Downloads a file from a URL and returns the data as a Uint8Array
	 * Throws an error if the data is not a ZIP file
	 * */
	static download = async (
		url: string,
		headers: FetchRequestInit
	): Promise<Uint8Array> => {
		const response = await fetch(url, headers);
		const buffer = await response.arrayBuffer();
		const data = new Uint8Array(buffer);

		// Convert the first two bytes to their ASCII representation
		const fileType =
			String.fromCharCode(data[0]) + String.fromCharCode(data[1]);

		// Check if the data is a ZIP file
		if (fileType !== "PK") {
			throw new Error("Received data is not a ZIP file");
		}

		return data;
	};

	/** Saves a Uint8Array to a file and returns the path */
	static save = async (
		data: Uint8Array,
		filename: string
	): Promise<string> => {
		const outputPath = path.join(DOWNLOAD_DIR, filename);
		fs.writeFileSync(outputPath, data);

		return outputPath;
	};

	/** Unzips a file to a directory */
	static unzip = async (
		filePath: string,
		outputDir: string
	): Promise<void> => {
		const compressed = fs.readFileSync(filePath);
		const zip = new JSZip();

		const directory = await zip.loadAsync(compressed);

		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}

		directory.forEach(async (relativePath, file) => {
			if (!file.dir) {
				const content = await file.async("nodebuffer");
				fs.writeFileSync(path.join(outputDir, relativePath), content);
			}
		});
	};
}
