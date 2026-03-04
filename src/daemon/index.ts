#!/usr/bin/env node
/**
 * Daemon entry point - starts the session watcher.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CortexLiteConfigSchema } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { createSessionWatcher } from "./session-watcher.js";

async function main(): Promise<void> {
	const configJson = process.env["CORTEX_LITE_CONFIG"];
	const pidFile = process.env["CORTEX_LITE_PID_FILE"] || join(homedir(), ".cortex", "lite-daemon.pid");
	const verbose = process.env["CORTEX_LITE_DEBUG"] === "true";

	const logger = createLogger(verbose);

	let config = CortexLiteConfigSchema.parse({});
	if (configJson) {
		try {
			const parsed = JSON.parse(configJson);
			config = CortexLiteConfigSchema.parse(parsed);
		} catch (err) {
			logger.warn(`Invalid config, using defaults: ${err}`);
		}
	}

	// Write PID file
	const pidDir = dirname(pidFile);
	if (!existsSync(pidDir)) {
		mkdirSync(pidDir, { recursive: true });
	}
	writeFileSync(pidFile, String(process.pid), "utf-8");

	const watcher = createSessionWatcher({
		config,
		onOptimize: (sessionId, stats) => {
			logger.info(
				`Optimized session ${sessionId}: ${stats.entryCount} entries, ${stats.reduction.toFixed(0)}% reduction`,
			);
		},
		onError: (error) => {
			logger.error(`Watcher error: ${error.message}`);
		},
	});

	await watcher.start();
	logger.info("cortex-lite daemon started");

	// Graceful shutdown
	const shutdown = () => {
		logger.info("Shutting down...");
		watcher.stop();
		try {
			const { unlinkSync } = require("node:fs");
			unlinkSync(pidFile);
		} catch {
			// ignore
		}
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	console.error("Daemon failed to start:", err);
	process.exit(1);
});
