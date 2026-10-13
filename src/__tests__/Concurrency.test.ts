import { describe, test, expect } from "bun:test";

import { mapWithLimit } from "../lib/Concurrency";

/** A promise that the test resolves or rejects by hand. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Let pending promise callbacks run. */
const flush = () => sleep(0);

describe("mapWithLimit", () => {
	test("returns results in input order", async () => {
		const delays = [30, 5, 20, 1, 10];
		const results = await mapWithLimit(delays, 2, async (ms, i) => {
			await sleep(ms);
			return `${i}:${ms}`;
		});
		expect(results).toEqual(["0:30", "1:5", "2:20", "3:1", "4:10"]);
	});

	test("never runs more than the limit at once", async () => {
		let active = 0;
		let maxActive = 0;
		await mapWithLimit([...Array(10).keys()], 4, async (i) => {
			active++;
			maxActive = Math.max(maxActive, active);
			await sleep(i % 3);
			active--;
		});
		expect(maxActive).toBe(4);
	});

	test("starts the next item as soon as any call finishes", async () => {
		const gates = [0, 1, 2].map(() => deferred<void>());
		const started: number[] = [];
		const done = mapWithLimit([0, 1, 2], 2, async (i) => {
			started.push(i);
			await gates[i].promise;
		});

		await flush();
		expect(started).toEqual([0, 1]);

		// Item 0 is still running; item 2 must not wait for it.
		gates[1].resolve();
		await flush();
		expect(started).toEqual([0, 1, 2]);

		gates[0].resolve();
		gates[2].resolve();
		await done;
	});

	test("handles an empty list and a limit above the item count", async () => {
		expect(await mapWithLimit([], 4, async (x) => x)).toEqual([]);
		expect(await mapWithLimit([1, 2], 10, async (x) => x * 2)).toEqual([
			2, 4,
		]);
	});

	test("stops starting items after a failure and rejects with it", async () => {
		const started: number[] = [];
		const run = mapWithLimit([0, 1, 2, 3], 1, async (i) => {
			started.push(i);
			if (i === 1) throw new Error("boom");
			return i;
		});
		await expect(run).rejects.toThrow("boom");
		expect(started).toEqual([0, 1]);
	});

	test("rejects a limit below 1 or a fraction", async () => {
		for (const bad of [0, -1, 1.5, NaN]) {
			await expect(mapWithLimit([1], bad, async (x) => x)).rejects.toThrow(
				RangeError
			);
		}
	});
});
