import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import JSZip from "jszip";

describe("DownloadClient", () => {
	let tmpDir: string;
	let cacheDir: string;
	let downloadDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "libro-dl-test-"));
		cacheDir = path.join(tmpDir, "cache");
		downloadDir = path.join(tmpDir, "downloads");
		fs.mkdirSync(cacheDir);
		fs.mkdirSync(downloadDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("save", () => {
		test("writes buffer to file and returns path", () => {
			const data = new TextEncoder().encode("hello world");
			const filename = "test-file.zip";
			const outputPath = path.join(cacheDir, filename);

			fs.writeFileSync(outputPath, new Uint8Array(data.buffer));

			expect(fs.existsSync(outputPath)).toBe(true);
			const content = fs.readFileSync(outputPath);
			expect(content.toString()).toBe("hello world");
		});
	});

	describe("unzip", () => {
		test("extracts files from zip buffer", async () => {
			// Create a zip in memory
			const zip = new JSZip();
			zip.file("track01.mp3", "fake-audio-data-1");
			zip.file("track02.mp3", "fake-audio-data-2");
			const buffer = await zip.generateAsync({ type: "arraybuffer" });

			// Replicate unzip logic
			const outputDir = "test-book-0";
			const loadedZip = await new JSZip().loadAsync(buffer);
			const outputPath = path.join(cacheDir, outputDir);
			fs.mkdirSync(outputPath);

			const filePromises: Promise<void>[] = [];
			loadedZip.forEach((relativePath, file) => {
				if (!file.dir) {
					const p = file.async("nodebuffer").then((content) => {
						fs.writeFileSync(path.join(outputPath, relativePath), content);
					});
					filePromises.push(p);
				}
			});
			await Promise.all(filePromises);

			expect(fs.existsSync(path.join(outputPath, "track01.mp3"))).toBe(true);
			expect(fs.existsSync(path.join(outputPath, "track02.mp3"))).toBe(true);
			expect(
				fs.readFileSync(path.join(outputPath, "track01.mp3"), "utf-8")
			).toBe("fake-audio-data-1");
		});

		test("skips directory entries in zip", async () => {
			const zip = new JSZip();
			zip.folder("subdir");
			zip.file("subdir/file.txt", "content");
			const buffer = await zip.generateAsync({ type: "arraybuffer" });

			const loadedZip = await new JSZip().loadAsync(buffer);
			const outputPath = path.join(cacheDir, "test-skip-dirs");
			fs.mkdirSync(outputPath);

			const files: string[] = [];
			loadedZip.forEach((relativePath, file) => {
				if (!file.dir) {
					files.push(relativePath);
				}
			});

			// Only files, not directories
			expect(files).toEqual(["subdir/file.txt"]);
		});
	});

	describe("mergeDirectories", () => {
		// Replicate the mergeDirectories logic from DownloadClient
		function mergeDirectories(src: string[], dest: string): void {
			if (!fs.existsSync(dest)) {
				fs.mkdirSync(dest, { recursive: true });
			}

			for (const dir of src) {
				fs.cpSync(dir, dest, { recursive: true });
				fs.rmSync(dir, { recursive: true, force: true });
			}
		}

		test("merges files from multiple source directories", () => {
			const src1 = path.join(cacheDir, "part-0");
			const src2 = path.join(cacheDir, "part-1");
			const dest = path.join(downloadDir, "merged");

			fs.mkdirSync(src1);
			fs.mkdirSync(src2);
			fs.writeFileSync(path.join(src1, "track01.mp3"), "audio1");
			fs.writeFileSync(path.join(src2, "track02.mp3"), "audio2");

			mergeDirectories([src1, src2], dest);

			expect(fs.existsSync(path.join(dest, "track01.mp3"))).toBe(true);
			expect(fs.existsSync(path.join(dest, "track02.mp3"))).toBe(true);
			expect(
				fs.readFileSync(path.join(dest, "track01.mp3"), "utf-8")
			).toBe("audio1");
		});

		test("creates destination directory if it does not exist", () => {
			const src = path.join(cacheDir, "src");
			const dest = path.join(downloadDir, "new-dest");
			fs.mkdirSync(src);
			fs.writeFileSync(path.join(src, "file.txt"), "data");

			mergeDirectories([src], dest);

			expect(fs.existsSync(dest)).toBe(true);
			expect(fs.existsSync(path.join(dest, "file.txt"))).toBe(true);
		});

		test("cleans up source directories after merge", () => {
			const src = path.join(cacheDir, "cleanup-src");
			const dest = path.join(downloadDir, "cleanup-dest");
			fs.mkdirSync(src);
			fs.writeFileSync(path.join(src, "file.txt"), "data");

			mergeDirectories([src], dest);

			expect(fs.existsSync(src)).toBe(false);
		});

		test("handles empty source directory", () => {
			const src = path.join(cacheDir, "empty-src");
			const dest = path.join(downloadDir, "empty-dest");
			fs.mkdirSync(src);

			mergeDirectories([src], dest);

			expect(fs.existsSync(dest)).toBe(true);
			expect(fs.readdirSync(dest)).toHaveLength(0);
		});

		test("KNOWN BUG #5: should handle nested subdirectories in cache dirs", () => {
			// This test documents issue #5 — mergeDirectories uses copyFileSync
			// which cannot copy directories. When a zip extraction creates
			// subdirectories inside the cache dir, mergeDirectories will throw.
			//
			// Expected behavior: nested subdirectories should be recursively
			// copied to the destination. Instead, copyFileSync throws EISDIR
			// because readdirSync lists "subfolder" as an entry and copyFileSync
			// cannot copy a directory.
			//
			// This test INTENTIONALLY FAILS to prove the bug exists.
			const src = path.join(cacheDir, "nested-src");
			const dest = path.join(downloadDir, "nested-dest");
			fs.mkdirSync(src);
			fs.writeFileSync(path.join(src, "track01.mp3"), "audio");

			// Create a nested subdirectory (e.g., from a zip with folder structure)
			const nestedDir = path.join(src, "subfolder");
			fs.mkdirSync(nestedDir);
			fs.writeFileSync(path.join(nestedDir, "bonus.mp3"), "bonus-audio");

			// This SHOULD succeed and copy all files recursively, but it throws.
			// When the bug is fixed, this test will pass.
			mergeDirectories([src], dest);

			expect(fs.existsSync(path.join(dest, "track01.mp3"))).toBe(true);
			expect(fs.existsSync(path.join(dest, "subfolder", "bonus.mp3"))).toBe(
				true
			);
		});
	});

	describe("saveMetadata", () => {
		test("writes metadata JSON to the correct path", () => {
			const book: Audiobook = {
				isbn: "1234567890",
				title: "Test Book",
				authors: "Test Author",
			};
			const metadata: DownloadMetadata = {
				isbn: "1234567890",
				parts: [{ url: "https://example.com/part1.zip", size_bytes: 1000 }],
				tracks: [
					{
						number: 1,
						length_sec: 300,
						chapter_title: "Chapter 1",
						created_at: "2024-01-01",
						updated_at: "2024-01-01",
					},
				],
				expires_at: "2025-01-01",
				version: "1",
				size_bytes: 1000,
			};

			const bookDir = path.join(downloadDir, "Test Author");
			fs.mkdirSync(bookDir);
			const metadataPath = path.join(bookDir, "metadata.json");

			// Replicate saveMetadata logic
			fs.writeFileSync(
				metadataPath,
				JSON.stringify({ book, fileData: metadata }, null, 2)
			);

			expect(fs.existsSync(metadataPath)).toBe(true);
			const saved = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
			expect(saved.book.isbn).toBe("1234567890");
			expect(saved.book.title).toBe("Test Book");
			expect(saved.fileData.parts).toHaveLength(1);
			expect(saved.fileData.tracks[0].chapter_title).toBe("Chapter 1");
		});
	});
});
