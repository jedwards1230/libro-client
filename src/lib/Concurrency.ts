// Side-effect free: service.ts and the tests import it.

/**
 * Like `Promise.all(items.map(fn))`, but with at most `limit` calls running at
 * once; the next item starts as soon as any call finishes. Results keep the
 * order of `items`. On the first rejection no further items start, and the
 * returned promise rejects with that error.
 */
export async function mapWithLimit<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	if (!Number.isInteger(limit) || limit < 1) {
		throw new RangeError(
			`limit must be a whole number of 1 or more, got ${limit}`
		);
	}
	const results = new Array<R>(items.length);
	let next = 0;
	let failed = false;

	const worker = async () => {
		while (!failed && next < items.length) {
			const index = next++;
			try {
				results[index] = await fn(items[index], index);
			} catch (error) {
				failed = true;
				throw error;
			}
		}
	};

	const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
	await Promise.all(workers);
	return results;
}
