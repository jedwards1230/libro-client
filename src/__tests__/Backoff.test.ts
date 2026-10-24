import { describe, test, expect } from "bun:test";
import {
	Backoff,
	LOGIN_BACKOFF_BASE_MS,
	LOGIN_BACKOFF_MAX_MS,
} from "../lib/Backoff";

describe("Backoff", () => {
	function make() {
		let t = 1_000_000;
		const backoff = new Backoff(undefined, undefined, () => t);
		return {
			backoff,
			advance: (ms: number) => {
				t += ms;
			},
		};
	}

	test("defaults: 1 minute doubling up to 30 minutes", () => {
		expect(LOGIN_BACKOFF_BASE_MS).toBe(60_000);
		expect(LOGIN_BACKOFF_MAX_MS).toBe(30 * 60_000);
	});

	test("allows an attempt before any failure", () => {
		const { backoff } = make();
		expect(backoff.remainingMs()).toBe(0);
		expect(backoff.failures).toBe(0);
	});

	test("delay doubles with each consecutive failure", () => {
		const { backoff } = make();
		const delays = [1, 2, 3, 4, 5].map(() => backoff.recordFailure());
		expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 960_000]);
		expect(backoff.failures).toBe(5);
	});

	test("delay is capped at the maximum", () => {
		const { backoff } = make();
		let last = 0;
		for (let i = 0; i < 20; i++) last = backoff.recordFailure();
		expect(last).toBe(LOGIN_BACKOFF_MAX_MS);
	});

	test("blocks until the delay has elapsed, then allows an attempt", () => {
		const { backoff, advance } = make();
		backoff.recordFailure();
		expect(backoff.remainingMs()).toBe(60_000);
		advance(30_000);
		expect(backoff.remainingMs()).toBe(30_000);
		advance(30_000);
		expect(backoff.remainingMs()).toBe(0);
	});

	test("elapsed time alone does not reset the growth; only reset() does", () => {
		const { backoff, advance } = make();
		backoff.recordFailure();
		advance(10 * 60_000);
		expect(backoff.recordFailure()).toBe(120_000);
		backoff.reset();
		expect(backoff.failures).toBe(0);
		expect(backoff.remainingMs()).toBe(0);
		expect(backoff.recordFailure()).toBe(60_000);
	});
});
