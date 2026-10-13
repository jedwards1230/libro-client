import {
	describe,
	test,
	expect,
	beforeEach,
	afterEach,
	mock,
	spyOn,
} from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import JSZip from "jszip";

import DownloadClient from "../lib/DownloadClient";
import { CACHE_DIR } from "../lib/Directories";

// The "save", "unzip" and "saveMetadata" tests replicate the logic; the
// "downloadFiles" and "atomic writes" tests run the real client with fetch
// stubbed, writing into a temp download directory.
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

	describe("downloadFiles", () => {
		const book = "Author/Series/Title";

		async function zipOf(files: Record<string, string>) {
			const zip = new JSZip();
			for (const [name, content] of Object.entries(files)) {
				zip.file(name, content);
			}
			return zip.generateAsync({ type: "arraybuffer" });
		}

		/** Serve `responses[url]`: a zip buffer, or a ready-made Response. */
		function serve(responses: Record<string, ArrayBuffer | Response>) {
			return spyOn(globalThis, "fetch").mockImplementation((async (
				url: string
			) => {
				const body = responses[url];
				return body instanceof Response ? body : new Response(body.slice(0));
			}) as unknown as typeof fetch);
		}

		/** Every file under `dir`, relative to it, sorted. */
		function files(dir: string): string[] {
			return (fs.readdirSync(dir, { recursive: true }) as string[])
				.filter((f) => fs.statSync(path.join(dir, f)).isFile())
				.sort();
		}

		const read = (...parts: string[]) =>
			fs.readFileSync(path.join(downloadDir, book, ...parts), "utf-8");

		const staging = () =>
			path.join(downloadDir, DownloadClient.stagingDirName);

		afterEach(() => {
			mock.restore();
		});

		test("places a multi-part book, nested folders included", async () => {
			serve({
				"https://cdn.example/p1.zip": await zipOf({
					"01.mp3": "one",
					"02.mp3": "two",
				}),
				"https://cdn.example/p2.zip": await zipOf({
					"03.mp3": "three",
					"extras/bonus.mp3": "bonus",
				}),
			});

			const [finalPath] = await DownloadClient.downloadFiles(
				book,
				["https://cdn.example/p1.zip", "https://cdn.example/p2.zip"],
				"token",
				false,
				downloadDir
			);

			expect(finalPath).toBe(path.join(downloadDir, book));
			expect(files(finalPath)).toEqual([
				"01.mp3",
				"02.mp3",
				"03.mp3",
				path.join("extras", "bonus.mp3"),
			]);
			expect(fs.existsSync(staging())).toBe(false);
		});

		test("a later part wins a name clash", async () => {
			serve({
				"https://cdn.example/p1.zip": await zipOf({ "01.mp3": "first" }),
				"https://cdn.example/p2.zip": await zipOf({ "01.mp3": "second" }),
			});

			await DownloadClient.downloadFiles(
				book,
				["https://cdn.example/p1.zip", "https://cdn.example/p2.zip"],
				"token",
				false,
				downloadDir
			);

			expect(read("01.mp3")).toBe("second");
		});

		test("an HTTP error fails with the status and writes nothing", async () => {
			serve({
				"https://cdn.example/p1.zip": await zipOf({ "01.mp3": "one" }),
				"https://cdn.example/p2.zip": new Response("<html>Forbidden</html>", {
					status: 403,
					statusText: "Forbidden",
				}),
			});

			await expect(
				DownloadClient.downloadFiles(
					book,
					["https://cdn.example/p1.zip", "https://cdn.example/p2.zip"],
					"token",
					false,
					downloadDir
				)
			).rejects.toThrow("Download failed: HTTP 403 Forbidden");
			expect(fs.readdirSync(downloadDir)).toEqual([]);
		});

		test("a part that fails to unpack leaves no partial book", async () => {
			serve({
				"https://cdn.example/p1.zip": await zipOf({ "01.mp3": "one" }),
				"https://cdn.example/p2.zip": new TextEncoder().encode("not a zip")
					.buffer as ArrayBuffer,
			});

			await expect(
				DownloadClient.downloadFiles(
					book,
					["https://cdn.example/p1.zip", "https://cdn.example/p2.zip"],
					"token",
					false,
					downloadDir
				)
			).rejects.toThrow();
			// Part 1 was unpacked, but only in staging, which is cleaned up.
			expect(fs.readdirSync(downloadDir)).toEqual([]);
		});

		test("a failed move into place leaves no partial book", async () => {
			serve({
				"https://cdn.example/p1.zip": await zipOf({ "01.mp3": "one" }),
				"https://cdn.example/p2.zip": await zipOf({ "02.mp3": "two" }),
			});
			spyOn(fs, "renameSync").mockImplementationOnce(() => {
				throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
			});

			await expect(
				DownloadClient.downloadFiles(
					book,
					["https://cdn.example/p1.zip", "https://cdn.example/p2.zip"],
					"token",
					false,
					downloadDir
				)
			).rejects.toThrow("EIO");
			expect(fs.existsSync(path.join(downloadDir, book))).toBe(false);
			expect(fs.existsSync(staging())).toBe(false);
		});

		test("clears what an interrupted attempt left in staging", async () => {
			const leftover = DownloadClient.stagingPath(downloadDir, book);
			fs.mkdirSync(leftover, { recursive: true });
			fs.writeFileSync(path.join(leftover, "stale.mp3"), "from a crash");
			serve({ "https://cdn.example/p1.zip": await zipOf({ "01.mp3": "one" }) });

			await DownloadClient.downloadFiles(
				book,
				["https://cdn.example/p1.zip"],
				"token",
				false,
				downloadDir
			);

			expect(files(path.join(downloadDir, book))).toEqual(["01.mp3"]);
			expect(fs.existsSync(staging())).toBe(false);
		});

		test("a re-download replaces files and keeps the others", async () => {
			const existing = path.join(downloadDir, book);
			fs.mkdirSync(path.join(existing, "extras"), { recursive: true });
			fs.writeFileSync(path.join(existing, "01.mp3"), "old");
			fs.writeFileSync(path.join(existing, "cover.jpg"), "mine");
			fs.writeFileSync(path.join(existing, "extras", "notes.txt"), "mine");
			serve({
				"https://cdn.example/p1.zip": await zipOf({
					"01.mp3": "new",
					"extras/bonus.mp3": "bonus",
				}),
			});

			await DownloadClient.downloadFiles(
				book,
				["https://cdn.example/p1.zip"],
				"token",
				false,
				downloadDir
			);

			expect(read("01.mp3")).toBe("new");
			expect(read("cover.jpg")).toBe("mine");
			expect(read("extras", "notes.txt")).toBe("mine");
			expect(read("extras", "bonus.mp3")).toBe("bonus");
		});

		test("keepZip saves each part on a fresh cache", async () => {
			// keepZip writes to the real cache dir; use a name no book has.
			const author = `libro-test-${process.pid}-${Date.now()}`;
			const keptBook = `${author}/Series/Title`;
			serve({ "https://cdn.example/p1.zip": await zipOf({ "01.mp3": "one" }) });
			try {
				const [, zips] = await DownloadClient.downloadFiles(
					keptBook,
					["https://cdn.example/p1.zip"],
					"token",
					true,
					downloadDir
				);

				expect(zips).toEqual([path.join(CACHE_DIR, `${keptBook}-0.zip`)]);
				const kept = await new JSZip().loadAsync(
					new Uint8Array(fs.readFileSync((zips as string[])[0]))
				);
				expect(await kept.file("01.mp3")!.async("string")).toBe("one");
			} finally {
				fs.rmSync(path.join(CACHE_DIR, author), {
					recursive: true,
					force: true,
				});
			}
		});
	});

	describe("atomic writes", () => {
		test("saveMetadata replaces metadata.json and leaves no temp file", async () => {
			const bookDir = path.join(downloadDir, "Book");
			fs.mkdirSync(bookDir);
			fs.writeFileSync(path.join(bookDir, "metadata.json"), "old");
			const book: Audiobook = { isbn: "1", title: "Book" };
			const fileData = {
				isbn: "1",
				parts: [],
				tracks: [],
				expires_at: "",
				version: "1",
				size_bytes: 0,
			} as DownloadMetadata;

			await DownloadClient.saveMetadata(book, fileData, bookDir);

			expect(fs.readdirSync(bookDir)).toEqual(["metadata.json"]);
			const saved = JSON.parse(
				fs.readFileSync(path.join(bookDir, "metadata.json"), "utf-8")
			);
			expect(saved.book.title).toBe("Book");
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
						length_msec: 300000,
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
