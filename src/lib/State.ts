import fs from "fs";
import { STATE_PATH } from "./Directories";
import { LogMethod } from "./Logger";
import { writePrivateFile } from "./Security";

const scope = "State";

/** State of downloaded audiobooks */
export default class State {
	downloadedAudioBooks: StateDataMap = {};

	/** `statePath` defaults to `data/config/state.json`; tests pass a temp file. */
	constructor(
		state?: Partial<State>,
		private readonly statePath: string = STATE_PATH
	) {
		this.load();
		Object.assign(this, state);
	}

	/** Adds a book to the state */
	@LogMethod({ scope })
	addBook(data: StateData) {
		this.downloadedAudioBooks[data.book.isbn] = data;
		this.save();
	}

	/** Removes a book from the state */
	@LogMethod({ scope })
	removeBook(isbn: string) {
		delete this.downloadedAudioBooks[isbn];
		this.save();
	}

	/** Find the difference between two states */
	@LogMethod({ scope })
	findDiff(curr: AudiobookMap): Audiobook[] {
		const diff: Audiobook[] = [];
		for (const isbn in curr) {
			if (!this.hasBook(isbn)) {
				diff.push(curr[isbn]);
			}
		}
		return diff;
	}

	/** Check if a book is in the state */
	@LogMethod({ scope })
	hasBook(isbn: string) {
		return this.downloadedAudioBooks[isbn] !== undefined;
	}

	/** Loads the state from the file system */
	@LogMethod({ scope })
	private load(): StateDataMap | null {
		let stateData: StateDataMap | null = null;
		if (fs.existsSync(this.statePath)) {
			const data = fs.readFileSync(this.statePath, "utf-8");
			const parsed: StateDataMap = JSON.parse(data);
			// Older versions created the file as `{"downloadedAudioBooks": {}}`,
			// which then loaded as a bogus entry. It is never an ISBN.
			delete parsed.downloadedAudioBooks;
			stateData = parsed;
			Object.assign(this, { downloadedAudioBooks: stateData });
		} else {
			// Same shape as every later write: the map itself.
			this.save();
		}

		return stateData;
	}

	/** Saves the state to the file system */
	@LogMethod({ scope })
	private save(): void {
		writePrivateFile(
			this.statePath,
			JSON.stringify(this.downloadedAudioBooks, null, 2)
		);
	}
}
