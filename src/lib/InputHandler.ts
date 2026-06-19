import select from "@inquirer/select";
import password from "@inquirer/password";
import input from "@inquirer/input";
import confirm from "@inquirer/confirm";

type Credentials = {
	username: string;
	password: string;
};

/**
 * Guards an interactive prompt against a non-interactive (non-TTY) environment.
 *
 * When stdin is not a TTY (e.g. a container with stdin bound to /dev/null), the
 * @inquirer readline prompts never receive input and spin the event loop at
 * 100% of a CPU core indefinitely. Throwing here turns that silent hang into a
 * clear, actionable error instead.
 */
const ensureInteractive = (what: string): void => {
	if (!process.stdin.isTTY) {
		throw new Error(
			`Cannot prompt for ${what}: stdin is not a TTY (non-interactive environment). ` +
				`Provide it via configuration or environment variables instead.`
		);
	}
};

/** Helper class for handling user input */
export default class InputHandler {
	/** Requests the user's libro.fm credentials (username/password) */
	static requestCredentials = async (): Promise<Credentials> => {
		ensureInteractive("libro.fm credentials");
		const username = await input({
			message: "Enter your libro.fm username",
		});
		const pass = await password({
			message: "Enter your libro.fm password",
		});

		return { username, password: pass };
	};

	static requestDownloadLocation = async (): Promise<string> => {
		ensureInteractive("download location");
		const location = await input({
			message: "Enter the full path to your download location",
		});
		return location;
	};

	/** Requests the user to select a book to download */
	static requestDownloadChoice = async (
		audiobooks: Audiobook[]
	): Promise<string> => {
		ensureInteractive("audiobook selection");
		const answer = await select({
			message: "Select an audiobook to download",
			choices: audiobooks.map((ab, idx) => ({
				name: `${ab.authors} - ${ab.title} - ${ab.isbn}`,
				value: ab.isbn,
			})),
		});

		return answer;
	};

	static requestOverwrite = async (book: Audiobook): Promise<boolean> => {
		ensureInteractive("overwrite confirmation");
		const answer = await confirm({
			message: `${book.title} already exists. Overwrite?`,
		});

		return answer;
	};
}
