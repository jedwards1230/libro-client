import fs from "fs";
import { STATE_PATH } from "./Constants";
import { LogMethod } from "./Logger";

const scope = "State";

/** State of downloaded audiobooks */
export default class State {
	downloadedAudioBooks: StateDataMap = {};

	constructor(state?: Partial<State>) {
		const localState = this.load();
		Object.assign(this, localState, state);
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

	/** Check if a book is in the state */
	@LogMethod({ scope })
	hasBook(isbn: string) {
		return this.downloadedAudioBooks[isbn] !== undefined;
	}

	/** Loads the state from the file system */
	@LogMethod({ scope })
	private load(): State | null {
		if (fs.existsSync(STATE_PATH)) {
			const data = fs.readFileSync(STATE_PATH, "utf-8");
			return JSON.parse(data);
		} else {
			fs.writeFileSync(STATE_PATH, JSON.stringify(this, null, 2));
			return null;
		}
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