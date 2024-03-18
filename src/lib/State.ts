import fs from "fs";
import { STATE_PATH } from "./Directories";
import { LogMethod } from "./Logger";

const scope = "State";

/** State of downloaded audiobooks */
export default class State {
	downloadedAudioBooks: StateDataMap = {};

	constructor(state?: Partial<State>) {
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
		if (fs.existsSync(STATE_PATH)) {
			const data = fs.readFileSync(STATE_PATH, "utf-8");
			stateData = JSON.parse(data);
			Object.assign(this, { downloadedAudioBooks: stateData });
		} else {
			fs.writeFileSync(STATE_PATH, JSON.stringify(this, null, 2));
		}

		return stateData;
	}

	/** Saves the state to the file system */
	@LogMethod({ scope })
	private save(): void {
		fs.writeFileSync(
			STATE_PATH,
			JSON.stringify(this.downloadedAudioBooks, null, 2)
		);
	}
}
