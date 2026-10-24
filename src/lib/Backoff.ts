export const LOGIN_BACKOFF_BASE_MS = 60_000;
export const LOGIN_BACKOFF_MAX_MS = 30 * 60_000;

/**
 * Exponential backoff for login attempts: the delay doubles with every
 * consecutive failure, from `baseMs` up to `maxMs`, and resets on success.
 * A persistent failure (bad password, an API gate) therefore cannot hammer
 * the login endpoint every scan and risk locking the account.
 */
export class Backoff {
	private failureCount = 0;
	private retryAt = 0;

	constructor(
		private readonly baseMs = LOGIN_BACKOFF_BASE_MS,
		private readonly maxMs = LOGIN_BACKOFF_MAX_MS,
		private readonly now: () => number = Date.now
	) {}

	/** Consecutive failures since the last reset. */
	get failures() {
		return this.failureCount;
	}

	/** Milliseconds until the next attempt is allowed; 0 when allowed now. */
	remainingMs(): number {
		return Math.max(0, this.retryAt - this.now());
	}

	/** Record a failure and return the delay now in force. */
	recordFailure(): number {
		this.failureCount += 1;
		const delay = Math.min(
			this.baseMs * 2 ** (this.failureCount - 1),
			this.maxMs
		);
		this.retryAt = this.now() + delay;
		return delay;
	}

	reset() {
		this.failureCount = 0;
		this.retryAt = 0;
	}
}
