/**
 * Simple structured logger.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
	debug(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
}

export function createLogger(verbose = false): Logger {
	return {
		debug(message: string, ...args: unknown[]): void {
			if (verbose) {
				console.debug(`[DEBUG] ${message}`, ...args);
			}
		},
		info(message: string, ...args: unknown[]): void {
			console.info(`[INFO] ${message}`, ...args);
		},
		warn(message: string, ...args: unknown[]): void {
			console.warn(`[WARN] ${message}`, ...args);
		},
		error(message: string, ...args: unknown[]): void {
			console.error(`[ERROR] ${message}`, ...args);
		},
	};
}
