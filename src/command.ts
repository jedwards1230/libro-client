import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import handlers from "@/LibroFmClient/handlers";

const Command = yargs(hideBin(process.argv))
	.command("list", "Fetch list of books in library", () => {}, handlers.list)
	.command(
		"get [isbn]",
		"Download a book. Optionally provide ISBN to download a specific book.",
		() => {},
		handlers.get
	)
	.demandCommand(1)
	.parse();

export default Command;
