import path from "path";
import fs from "fs";
import JSZip from "jszip";

import APIHandler from "../APIHandler";
import logger, { LogMethod } from "./Logger";
import { CACHE_DIR, DOWNLOAD_DIR } from "./Directories";

const scope = "DownloadClient";

/** Helper class for downloading and unzipping files */
export default class DownloadCLient {
	/**
	 * Downloads a list of files and returns the paths.
	 * This assumes that the urls are meant to compile for one book.
	 * (multi-part zip files, etc.)
	 * */
	@LogMethod({ scope, message: "Downloading files..." })
	static async downloadFiles(
		filename: string,
		urls: string[],
		authToken: string,
		keepZip = false
	): Promise<[string, string[] | false]> {
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

		const paths = await Promise.all(
			buffers.map((buffer, idx) =>
				DownloadCLient.unzip(buffer, `/${filename}-${idx}`)
			)
		);

		const finalPath = path.join(DOWNLOAD_DIR, filename);
		await DownloadCLient.mergeDirectories(paths, finalPath);

		return [finalPath, zipped_files];
	}

	/**
	 * Save Audiobook object as JSON file alongside the downloaded files.
	 */
	@LogMethod({ scope, message: "Saving metadata..." })
	static async saveMetadata(
		book: Audiobook,
		filepath: string
	): Promise<void> {
		const metadataPath = path.join(filepath, "metadata.json");
		fs.writeFileSync(metadataPath, JSON.stringify(book, null, 2));
	}

	/** Downloads a file from a URL and returns the data as a Uint8Array */
	@LogMethod({ scope, message: "Downloading file..." })
	private static async download(
		url: string,
		authToken: string
	): Promise<ArrayBuffer> {
		try {
			const response = await fetch(url, {
				headers: APIHandler.getHeaders(authToken),
			});
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
			fs.writeFileSync(outputPath, data);
			return outputPath;
		} catch (error) {
			logger.error({ error, fn: "DownloadClient.save" });
			throw error;
		}
	}

	/** Unzips a file to a directory */
	@LogMethod({ scope, message: "Unzipping file to filesystem..." })
	static async unzip(
		buffer: ArrayBuffer,
		outputDir: string
	): Promise<string> {
		try {
			const zip = new JSZip();

			const directory = await zip.loadAsync(buffer);
			const outputPath = path.join(CACHE_DIR, outputDir);

			if (!fs.existsSync(outputPath)) {
				fs.mkdirSync(outputPath);
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

	/** Merge contents of two directories */
	@LogMethod({ scope })
	private static async mergeDirectories(
		src: string[],
		dest: string
	): Promise<void> {
		logger.silly(`Merging directories: ${src} -> ${dest}`, {
			fn: "DownloadClient.mergeDirectories",
		});
		try {
			if (!fs.existsSync(dest)) {
				fs.mkdirSync(dest);
			}

			for (const dir of src) {
				const files = fs.readdirSync(dir);
				for (const file of files) {
					const srcFile = `${dir}/${file}`;
					const destFile = `${dest}/${file}`;
					if (fs.existsSync(srcFile)) {
						fs.copyFileSync(srcFile, destFile);
					} else {
						logger.error(`File ${srcFile} does not exist`, {
							fn: "LibroFmClient.mergeDirectories",
						});
					}
				}

				// Delete files in the source directory
				for (const file of files) {
					fs.unlinkSync(`${dir}/${file}`);
				}
				// Delete the source directory
				fs.rmdirSync(dir);
			}
		} catch (error) {
			logger.error({ error, fn: "LibroFmClient.mergeDirectories" });
			throw new Error("Failed to merge directories");
		}
	}
}
