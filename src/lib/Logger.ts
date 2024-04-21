import { format, transports, createLogger } from "winston";
import path from "path";
import fs from "fs";

import { LOGS_DIR } from "./Directories";

if (fs.existsSync(LOGS_DIR)) {
	fs.readdirSync(LOGS_DIR).forEach((file) => {
		fs.unlinkSync(path.join(LOGS_DIR, file));
	});
}

const sillyLogFile = path.join(LOGS_DIR, "silly.log");
const debugLogFile = path.join(LOGS_DIR, "debug.log");

const DEBUG_MODE = process.env.DEBUG === "true";

function getFormat(fileTransport: boolean = false) {
	return format.printf(({ timestamp, level, message, fn, ...rest }) => {
		if (!DEBUG_MODE && !fileTransport && level.includes("info")) {
			return message;
		}

		const timeStr = timestamp ? `${timestamp} - ` : "";

		let msg = `${timeStr}(${level}) - Uncategorized Log Message | ${JSON.stringify(
			message
		)}\n${JSON.stringify(rest)}}`;

		if (typeof message === "object") {
			const fnStr = message.fn ? ` ${message.fn}` : "";
			delete message.fn;
			msg = `${timeStr}(${level})${fnStr}`;
			for (const key in message) {
				msg += `\n${key}: ${JSON.stringify(message[key], null, 2)}`;
			}
		} else if (message) {
			const fnStr = fn ? ` ${fn}` : "";
			msg = `${timeStr}(${level})${fnStr} | ${message}`;
		} else {
			// no message, try to render fn and rest
			const fnStr = fn ? ` ${fn}` : "";
			msg = `${timeStr}(${level})${fnStr}`;
		}

		for (const key in rest) {
			msg += `\n${key}: ${JSON.stringify(rest[key], null, 2)}`;
		}

		return msg;
	});
}

const logger = createLogger({
	level: DEBUG_MODE ? "debug" : "info",

	transports: [
		new transports.Console({
			format: format.combine(
				format.errors({ stack: true }),
				format.splat(),
				format.colorize(),
				getFormat()
			),
		}),
		new transports.File({
			format: format.combine(
				format.errors({ stack: true }),
				format.splat(),
				format.timestamp(),
				getFormat(true)
			),
			filename: sillyLogFile,
			level: "silly",
		}),
		new transports.File({
			format: format.combine(
				format.errors({ stack: true }),
				format.splat(),
				format.timestamp(),
				getFormat(true)
			),
			filename: debugLogFile,
			level: "debug",
		}),
	],
});

type LogMethodOptions = {
	level?: string;
	scope?: string;
	message?: string;
	[key: string]: any;
};

/**
 * Log a method call.
 * Default level is "silly".
 * */
export function LogMethod(
	{ level = "silly", scope, message, ...rest }: LogMethodOptions = {
		level: "silly",
	}
) {
	return function (
		target: any,
		propertyKey: string,
		descriptor: PropertyDescriptor
	) {
		const originalMethod = descriptor.value;

		descriptor.value = function (...args: any[]) {
			const fn = scope || target.constructor.name;
			if (message) {
				logger.verbose(message, {
					...rest,
					fn: `${fn}.${propertyKey}`,
				});
			}
			logger.log(level, {
				args,
				message,
				...rest,
				fn: `${fn}.${propertyKey}`,
			});

			// call the original method
			const result = originalMethod.apply(this, args);

			return result;
		};

		return descriptor;
	};
}

export default logger;
