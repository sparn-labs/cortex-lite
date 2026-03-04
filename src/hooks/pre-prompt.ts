#!/usr/bin/env node
/**
 * UserPromptSubmit Hook - Simplified from @sparn/cortex.
 * Size hint + session status line only. No SQLite, no dashboard, no daemon auto-start.
 *
 * CRITICAL: Always exits 0 (never disrupts Claude Code).
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEBUG = process.env["CORTEX_DEBUG"] === "true";
const LOG_FILE =
	process.env["CORTEX_LOG_FILE"] || join(homedir(), ".cortex-hook.log");

function log(message: string): void {
	if (DEBUG) {
		const timestamp = new Date().toISOString();
		appendFileSync(LOG_FILE, `[${timestamp}] [pre-prompt] ${message}\n`);
	}
}

interface HookInput {
	session_id?: string;
	transcript_path?: string;
	cwd?: string;
	hook_event_name?: string;
	prompt?: string;
}

const CACHE_FILE = join(homedir(), ".cortex", "hook-state-cache.json");
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
	key: string;
	hint: string;
	timestamp: number;
}

function getCacheKey(
	sessionId: string,
	size: number,
	mtimeMs: number,
): string {
	return `${sessionId}:${size}:${Math.floor(mtimeMs)}`;
}

function readCache(key: string): string | null {
	try {
		if (!existsSync(CACHE_FILE)) return null;
		const data = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as CacheEntry;
		if (data.key !== key) return null;
		if (Date.now() - data.timestamp > CACHE_TTL_MS) return null;
		return data.hint;
	} catch {
		return null;
	}
}

function writeCache(key: string, hint: string): void {
	try {
		const dir = dirname(CACHE_FILE);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const entry: CacheEntry = { key, hint, timestamp: Date.now() };
		writeFileSync(CACHE_FILE, JSON.stringify(entry), "utf-8");
	} catch {
		// Fail silently
	}
}

async function main(): Promise<void> {
	try {
		const chunks: Buffer[] = [];
		for await (const chunk of process.stdin) {
			chunks.push(chunk);
		}
		const raw = Buffer.concat(chunks).toString("utf-8");

		let input: HookInput;
		try {
			input = JSON.parse(raw);
		} catch {
			log("Failed to parse JSON input, passing through");
			process.exit(0);
			return;
		}

		log(
			`Session: ${input.session_id}, prompt length: ${input.prompt?.length ?? 0}`,
		);

		const transcriptPath = input.transcript_path;

		// --- Transcript size hint (cached) ---
		let sizeHint: string | null = null;
		if (transcriptPath && existsSync(transcriptPath)) {
			const stats = statSync(transcriptPath);
			const sizeMB = stats.size / (1024 * 1024);
			log(`Transcript size: ${sizeMB.toFixed(2)} MB`);

			const cacheKey = getCacheKey(
				input.session_id || "unknown",
				stats.size,
				stats.mtimeMs,
			);
			const cachedHint = readCache(cacheKey);
			if (cachedHint) {
				sizeHint = cachedHint;
			} else if (sizeMB > 2) {
				sizeHint =
					sizeMB > 5
						? `[cortex] Session transcript is ${sizeMB.toFixed(1)}MB. Context is very large. Prefer concise responses and avoid re-reading files already in context.`
						: `[cortex] Session transcript is ${sizeMB.toFixed(1)}MB. Context is growing. Be concise where possible.`;
				writeCache(cacheKey, sizeHint);
			}
		}

		// --- Session status line ---
		let statusLine: string | null = null;
		try {
			const sessionStatsFile = join(
				homedir(),
				".cortex",
				"session-stats.json",
			);
			if (existsSync(sessionStatsFile)) {
				const sessionData = JSON.parse(
					readFileSync(sessionStatsFile, "utf-8"),
				);
				const sessionId = input.session_id || "unknown";
				if (
					sessionData.sessionId === sessionId &&
					sessionData.outputsCompressed > 0
				) {
					const saved =
						sessionData.totalTokensBefore - sessionData.totalTokensAfter;
					const savedStr =
						saved >= 1000 ? `${(saved / 1000).toFixed(1)}K` : String(saved);
					const avgReduction =
						sessionData.totalTokensBefore > 0
							? Math.round(
									((sessionData.totalTokensBefore -
										sessionData.totalTokensAfter) /
										sessionData.totalTokensBefore) *
										100,
								)
							: 0;
					const transcriptSize =
						transcriptPath && existsSync(transcriptPath)
							? `${(statSync(transcriptPath).size / (1024 * 1024)).toFixed(1)}MB`
							: "N/A";

					let toolBreakdown = "";
					if (
						sessionData.perTool &&
						typeof sessionData.perTool === "object"
					) {
						const toolParts: string[] = [];
						for (const [tool, data] of Object.entries(sessionData.perTool)) {
							const td = data as {
								compressed: number;
								tokensBefore: number;
								tokensAfter: number;
							};
							if (td.compressed > 0) {
								const toolSaved = td.tokensBefore - td.tokensAfter;
								const toolSavedStr =
									toolSaved >= 1000
										? `${(toolSaved / 1000).toFixed(0)}K`
										: String(toolSaved);
								toolParts.push(`${tool}:${td.compressed}/${toolSavedStr}`);
							}
						}
						if (toolParts.length > 0) {
							toolBreakdown = ` | ${toolParts.join(" ")}`;
						}
					}

					statusLine = `[cortex] Session: ${transcriptSize} | ${sessionData.outputsCompressed} compressed (${avgReduction}% avg) | ~${savedStr} saved${toolBreakdown}`;
				}
			}
		} catch {
			// ignore
		}

		// --- Combine and output ---
		const parts = [statusLine, sizeHint].filter(Boolean);
		if (parts.length > 0) {
			const combined = parts.join("\n");
			const output = JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "UserPromptSubmit",
					additionalContext: combined,
				},
			});
			process.stdout.write(output);
		}

		process.exit(0);
	} catch (error) {
		log(
			`Error: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(0);
	}
}

main();
