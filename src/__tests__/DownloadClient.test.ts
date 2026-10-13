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
import { ReadableStream } from "stream/web";
import JSZip from "jszip";

import DownloadClient from "../lib/DownloadClient";
import { CACHE_DIR } from "../lib/Directories";

// These tests run the real client, with fetch stubbed, against a temp
// download directory. JSZip only builds the zips they read.
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

	async function zipOf(files: Record<string, string>) {
		const zip = new JSZip();
		for (const [name, content] of Object.entries(files)) {
			zip.file(name, content);
		}
		return zip.generateAsync({ type: "arraybuffer" });
	}

	/** Every file under `dir`, relative to it, sorted. */
	function files(dir: string): string[] {
		return (fs.readdirSync(dir, { recursive: true }) as string[])
			.filter((f) => fs.statSync(path.join(dir, f)).isFile())
			.sort();
	}

	describe("unzip", () => {
		async function zipFile(files: Record<string, string>) {
			const file = path.join(cacheDir, "part.zip");
			fs.writeFileSync(file, new Uint8Array(await zipOf(files)));
			return file;
		}

		test("extracts every file from a zip on disk, nested ones too", async () => {
			const zip = await zipFile({
				"track01.mp3": "fake-audio-data-1",
				"track02.mp3": "fake-audio-data-2",
				"extras/bonus.mp3": "bonus",
			});
			const out = path.join(tmpDir, "out");

			expect(await DownloadClient.unzip(zip, out)).toBe(out);
			expect(files(out)).toEqual([
				path.join("extras", "bonus.mp3"),
				"track01.mp3",
				"track02.mp3",
			]);
			expect(fs.readFileSync(path.join(out, "track01.mp3"), "utf-8")).toBe(
				"fake-audio-data-1"
			);
		});

		test("skips directory entries", async () => {
			const zip = new JSZip();
			zip.folder("empty");
			zip.file("subdir/file.txt", "content");
			const file = path.join(cacheDir, "dirs.zip");
			fs.writeFileSync(
				file,
				new Uint8Array(await zip.generateAsync({ type: "arraybuffer" }))
			);
			const out = path.join(tmpDir, "out");

			await DownloadClient.unzip(file, out);

			expect(files(out)).toEqual([path.join("subdir", "file.txt")]);
			expect(fs.existsSync(path.join(out, "empty"))).toBe(false);
		});

		test("rejects a zip with an entry that escapes the folder", async () => {
			const zip = await zipFile({ "../evil.txt": "x", "ok.txt": "y" });
			const out = path.join(tmpDir, "nested", "out");

			await expect(DownloadClient.unzip(zip, out)).rejects.toThrow(
				"invalid relative path"
			);
			expect(fs.existsSync(path.join(tmpDir, "nested", "evil.txt"))).toBe(
				false
			);
		});

		test("rejects a file that is not a zip", async () => {
			const file = path.join(cacheDir, "page.zip");
			fs.writeFileSync(file, "<html>Forbidden</html>");

			await expect(
				DownloadClient.unzip(file, path.join(tmpDir, "out"))
			).rejects.toThrow();
		});
	});

	describe("downloadFiles", () => {
		const book = "Author/Series/Title";

		/** Serve `responses[url]`: a zip buffer, or a ready-made Response. */
		function serve(responses: Record<string, ArrayBuffer | Response>) {
			return spyOn(globalThis, "fetch").mockImplementation((async (
				url: string
			) => {
				const body = responses[url];
				return body instanceof Response ? body : new Response(body.slice(0));
			}) as unknown as typeof fetch);
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

		test("a connection that drops midway leaves nothing behind", async () => {
			const body = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(1024).fill(1));
					controller.error(new Error("ECONNRESET"));
				},
			});
			serve({
				"https://cdn.example/p1.zip": await zipOf({ "01.mp3": "one" }),
				"https://cdn.example/p2.zip": new Response(body),
			});

			await expect(
				DownloadClient.downloadFiles(
					book,
					["https://cdn.example/p1.zip", "https://cdn.example/p2.zip"],
					"token",
					false,
					downloadDir
				)
			).rejects.toThrow("ECONNRESET");
			// No book, no staging, no temp files.
			expect(fs.readdirSync(downloadDir)).toEqual([]);
		});

		test("a failed part stops the others before cleaning up", async () => {
			// Part 1 trickles in; part 2 fails at once.
			let chunks = 0;
			const slow = new ReadableStream({
				async pull(controller) {
					await new Promise((resolve) => setTimeout(resolve, 10));
					controller.enqueue(new Uint8Array(1024));
					if (++chunks === 50) controller.close();
				},
			});
			serve({
				"https://cdn.example/p1.zip": new Response(slow),
				"https://cdn.example/p2.zip": new Response("gone", { status: 410 }),
			});

			await expect(
				DownloadClient.downloadFiles(
					book,
					["https://cdn.example/p1.zip", "https://cdn.example/p2.zip"],
					"token",
					false,
					downloadDir
				)
			).rejects.toThrow("Download failed: HTTP 410");
			// Part 1 was cut off, not left writing into a removed staging folder.
			const pulled = chunks;
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(chunks).toBe(pulled);
			expect(chunks).toBeLessThan(50);
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
			// Downloads rename their temp files too; fail only the book's move.
			const rename = fs.renameSync;
			spyOn(fs, "renameSync").mockImplementation(
				(from: fs.PathLike, to: fs.PathLike) => {
					if (path.basename(String(from)) === "book") {
						throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
					}
					return rename(from, to);
				}
			);

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
				expect(fs.readdirSync(path.join(CACHE_DIR, author, "Series"))).toEqual([
					"Title-0.zip",
				]);
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
			const fileData: DownloadMetadata = {
				isbn: "1",
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

			await DownloadClient.saveMetadata(book, fileData, bookDir);

			expect(fs.readdirSync(bookDir)).toEqual(["metadata.json"]);
			const saved = JSON.parse(
				fs.readFileSync(path.join(bookDir, "metadata.json"), "utf-8")
			);
			expect(saved.book.title).toBe("Book");
			expect(saved.fileData.parts).toHaveLength(1);
			expect(saved.fileData.tracks[0].chapter_title).toBe("Chapter 1");
		});
	});
});
