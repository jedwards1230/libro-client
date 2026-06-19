import { describe, test, expect, afterEach } from "bun:test";
import InputHandler from "@/lib/InputHandler";

/**
 * Regression guard for the headless 1-core busy-spin: when stdin is not a TTY,
 * the interactive @inquirer prompts must throw immediately instead of hanging
 * (which previously spun the event loop at 100% of a CPU core indefinitely).
 */
describe("InputHandler non-TTY guards", () => {
	const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

	const setTTY = (value: boolean | undefined): void => {
		Object.defineProperty(process.stdin, "isTTY", {
			value,
			configurable: true,
		});
	};

	afterEach(() => {
		if (original) {
			Object.defineProperty(process.stdin, "isTTY", original);
		} else {
			setTTY(undefined);
		}
	});

	test("requestCredentials throws without a TTY instead of hanging", async () => {
		setTTY(undefined);
		await expect(InputHandler.requestCredentials()).rejects.toThrow(
			/not a TTY/i
		);
	});

	test("requestDownloadLocation throws without a TTY", async () => {
		setTTY(false);
		await expect(InputHandler.requestDownloadLocation()).rejects.toThrow(
			/not a TTY/i
		);
	});

	test("requestDownloadChoice throws without a TTY", async () => {
		setTTY(false);
		await expect(
			InputHandler.requestDownloadChoice([
				{ isbn: "001", title: "Test Book" },
			])
		).rejects.toThrow(/not a TTY/i);
	});

	test("requestOverwrite throws without a TTY", async () => {
		setTTY(false);
		await expect(
			InputHandler.requestOverwrite({ isbn: "001", title: "Test Book" })
		).rejects.toThrow(/not a TTY/i);
	});
});
