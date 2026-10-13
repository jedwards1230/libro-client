import path from "path";
import fs from "fs";
import { createHash, randomBytes } from "crypto";
import JSZip from "jszip";

import APIHandler from "../APIHandler";
import logger, { LogMethod } from "./Logger";
import { CACHE_DIR, DOWNLOAD_DIR } from "./Directories";
import { isLibroFmUrl, isWithin } from "./Security";

const scope = "DownloadClient";

/** Helper class for downloading and unzipping files */
export default class DownloadCLient {
	/** Hidden folder in the download directory where books are unpacked. */
	static readonly stagingDirName = ".libro-partial";

	/**
	 * Downloads a list of files and returns the paths.
	 * This assumes that the urls are meant to compile for one book.
	 * (multi-part zip files, etc.)
	 * */
	@LogMethod({ scope, message: "Downloading files...", secretArgs: [2] })
	static async downloadFiles(
		filename: string,
		urls: string[],
		authToken: string,
		keepZip = false,
		directory?: string,
	): Promise<[string, string[] | false]> {
		const baseDir = directory || DOWNLOAD_DIR;
		const finalPath = path.join(baseDir, filename);
		if (
			!isWithin(baseDir, finalPath) ||
			!isWithin(CACHE_DIR, path.join(CACHE_DIR, filename))
		) {
			throw new Error(
				`Refusing to write outside the download directory: ${filename}`
			);
		}

		const buffers = await Promise.all(
			urls.map((url) => DownloadCLient.download(url, authToken))
		);
		const zipped_files =
			keepZip &&
			(await Promise.all(
				buffers.map((buffer, idx) =>
					DownloadCLient.save(buffer, `/${filename}-${idx}.zip`)
				)
			));

		// Unpack into a staging folder, then move the book into place with
		// renames only: a failed or interrupted download never leaves a partial
		// book in the download directory.
		const staging = DownloadCLient.stagingPath(baseDir, filename);
		// Left behind by an interrupted attempt at the same book.
		fs.rmSync(staging, { recursive: true, force: true });
		try {
			// In part order, so a later part wins a name clash, as before.
			for (const buffer of buffers) {
				await DownloadCLient.unzip(buffer, staging);
			}
			DownloadCLient.moveIntoPlace(staging, finalPath);
		} finally {
			fs.rmSync(staging, { recursive: true, force: true });
			DownloadCLient.removeIfEmpty(path.dirname(staging));
		}

		return [finalPath, zipped_files];
	}

	/**
	 * Staging folder for one book, inside the download directory so the final
	 * move is a rename on the same filesystem. Stable per book, so the next
	 * attempt clears what an interrupted one left.
	 */
	static stagingPath(baseDir: string, filename: string): string {
		const id = createHash("sha256").update(filename).digest("hex");
		return path.join(baseDir, DownloadCLient.stagingDirName, id.slice(0, 16));
	}

	/**
	 * Save Audiobook object as JSON file alongside the downloaded files.
	 */
	@LogMethod({ scope, message: "Saving metadata..." })
	static async saveMetadata(
		book: Audiobook,
		fileData: DownloadMetadata,
		filepath: string
	): Promise<void> {
		const metadataPath = path.join(filepath, "metadata.json");
		DownloadCLient.writeFileAtomic(
			metadataPath,
			JSON.stringify({ book, fileData }, null, 2)
		);
	}

	/** Downloads a file from a URL and returns the data as a Uint8Array */
	@LogMethod({ scope, message: "Downloading file...", secretArgs: [1] })
	private static async download(
		url: string,
		authToken: string
	): Promise<ArrayBuffer> {
		try {
			var opts = {};
			// Only libro.fm itself gets the bearer token; part URLs on a CDN
			// (or a lookalike such as evillibro.fm) are fetched without it.
			if (isLibroFmUrl(url)) {
				opts = {
					headers: APIHandler.getHeaders(authToken),
				};
			}

			const response = await fetch(url, opts);
			// An error page (e.g. an expired signed URL) is not a zip.
			if (!response.ok) {
				throw new Error(
					`Download failed: HTTP ${response.status} ${response.statusText}`.trim()
				);
			}
			const buffer = await response.arrayBuffer();

			return buffer;
		} catch (error) {
			logger.error({ error, fn: "DownloadClient.download" });
			throw error;
		}
	}

	/** Saves a Uint8Array to a file and returns the path */
	@LogMethod({ scope, message: "Saving zip file to filesystem..." })
	static async save(buffer: ArrayBuffer, filename: string): Promise<string> {
		const data = new Uint8Array(buffer);
		try {
			const outputPath = path.join(CACHE_DIR, filename);
			// The book's author/series folders may not exist in the cache yet.
			fs.mkdirSync(path.dirname(outputPath), { recursive: true });
			DownloadCLient.writeFileAtomic(outputPath, data);
			return outputPath;
		} catch (error) {
			logger.error({ error, fn: "DownloadClient.save" });
			throw error;
		}
	}

	/** Unzips a file into a directory */
	@LogMethod({ scope, message: "Unzipping file to filesystem..." })
	static async unzip(
		buffer: ArrayBuffer,
		outputPath: string
	): Promise<string> {
		try {
			const zip = new JSZip();

			const directory = await zip.loadAsync(buffer);

			if (!fs.existsSync(outputPath)) {
				fs.mkdirSync(outputPath, { recursive: true });
			}

			const filePromises: Promise<void>[] = [];
			directory.forEach((relativePath, file) => {
				if (!file.dir) {
					const filePromise = file
						.async("nodebuffer")
						.then((content) => {
							const filePath = path.join(
								outputPath,
								relativePath
							);
							// Zip-slip guard: never write outside the extraction dir.
							if (!isWithin(outputPath, filePath)) {
								logger.warn(
									`Skipping unsafe zip entry: ${relativePath}`,
									{ fn: "DownloadClient.unzip" }
								);
								return;
							}
							const fileDir = path.dirname(filePath);
							if (!fs.existsSync(fileDir)) {
								fs.mkdirSync(fileDir, { recursive: true });
							}
							fs.writeFileSync(filePath, content);
						});
					filePromises.push(filePromise);
				}
			});

			// Wait for all files to be written
			await Promise.all(filePromises);

			return outputPath;
		} catch (error) {
			logger.error({ error, fn: "DownloadClient.unzip" });
			throw error;
		}
	}

	/**
	 * Move `src` to `dest` with renames only. A new book appears in one step.
	 * Into an existing folder (a re-download), each file is replaced in one
	 * step, and files that aren't in the download are kept, as before.
	 */
	@LogMethod({ scope })
	private static moveIntoPlace(src: string, dest: string): void {
		if (!fs.existsSync(dest)) {
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.renameSync(src, dest);
			return;
		}
		for (const name of fs.readdirSync(src)) {
			const from = path.join(src, name);
			const to = path.join(dest, name);
			if (fs.statSync(from).isDirectory() && fs.existsSync(to)) {
				DownloadCLient.moveIntoPlace(from, to);
			} else {
				fs.renameSync(from, to);
			}
		}
	}

	/** Write `data` to a temp file next to `file`, then rename it over `file`. */
	private static writeFileAtomic(file: string, data: string | Uint8Array) {
		const tmp = path.join(
			path.dirname(file),
			`.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`
		);
		try {
			fs.writeFileSync(tmp, data);
			fs.renameSync(tmp, file);
		} catch (error) {
			fs.rmSync(tmp, { force: true });
			throw error;
		}
	}

	/**
	 * Remove `dir` if it is empty. Best effort: other downloads may still be
	 * using it, and a failure here must not hide the download's own error.
	 */
	private static removeIfEmpty(dir: string) {
		try {
			fs.rmdirSync(dir);
		} catch {}
	}
}
