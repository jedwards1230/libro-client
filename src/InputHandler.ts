import select from "@inquirer/select";
import password from "@inquirer/password";
import input from "@inquirer/input";

import type { Audiobook } from "./LibroFmClient/LibroFmClient";

type Credentials = {
	username: string;
	password: string;
};

/** Helper class for handling user input */
export default class InputHandler {
	/** Requests the user's libro.fm credentials (username/password) */
	static requestCredentials = async (): Promise<Credentials> => {
		const username = await input({
			message: "Enter your libro.fm username",
		});
		const pass = await password({
			message: "Enter your libro.fm password",
		});

		return { username, password: pass };
	};

	/** Requests the user to select a book to download */
	static requestDownloadChoice = async (
		audiobooks: Audiobook[]
	): Promise<string> => {
		const answer = await select({
			message: "Select a package manager",
			choices: audiobooks.map((ab, idx) => ({
				name: ab.title,
				value: ab.isbn,
				description: ab.isbn,
			})),
		});

		return answer;
	};
}
