/**
 * Session Watcher - Monitor Claude Code session files for changes.
 * Simplified from @sparn/cortex: uses Rust engine directly, no KV memory.
 */

import {
	type FSWatcher,
	readdirSync,
	statSync,
	watch,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CortexLiteConfig } from "../config.js";
import { type Pipeline, createPipeline } from "../pipeline.js";
import { createFileTracker } from "./file-tracker.js";

export interface SessionStats {
	sessionId: string;
	totalTokens: number;
	optimizedTokens: number;
	reduction: number;
	entryCount: number;
	budgetUtilization: number;
}

export interface SessionWatcherConfig {
	config: CortexLiteConfig;
	onOptimize?: (sessionId: string, stats: SessionStats) => void;
	onError?: (error: Error) => void;
}

export interface SessionWatcher {
	start(): Promise<void>;
	stop(): void;
	getStats(): SessionStats[];
	getSessionStats(sessionId: string): SessionStats | null;
	optimizeSession(sessionId: string): void;
}

export function createSessionWatcher(
	watcherConfig: SessionWatcherConfig,
): SessionWatcher {
	const { config, onOptimize, onError } = watcherConfig;

	const pipelines = new Map<string, Pipeline>();
	const fileTracker = createFileTracker();
	const watchers: FSWatcher[] = [];
	const debounceTimers = new Map<string, NodeJS.Timeout>();

	function getProjectsDir(): string {
		return join(homedir(), ".claude", "projects");
	}

	function getSessionId(filePath: string): string {
		const filename = filePath.split(/[/\\]/).pop() || "";
		return filename.replace(/\.jsonl$/, "");
	}

	function getPipeline(sessionId: string): Pipeline {
		let pipeline = pipelines.get(sessionId);
		if (!pipeline) {
			pipeline = createPipeline(config);
			pipelines.set(sessionId, pipeline);
		}
		return pipeline;
	}

	function handleFileChange(filePath: string): void {
		const existingTimer = debounceTimers.get(filePath);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const timer = setTimeout(() => {
			try {
				const newLines = fileTracker.readNewLines(filePath);
				if (newLines.length === 0) return;

				const content = newLines.join("\n");
				const sessionId = getSessionId(filePath);
				const pipeline = getPipeline(sessionId);

				pipeline.ingest(content);

				const stats = pipeline.getStats();
				if (stats.currentTokens >= config.autoOptimizeThreshold) {
					pipeline.optimize();

					if (onOptimize) {
						onOptimize(sessionId, computeSessionStats(sessionId, pipeline));
					}
				}
			} catch (error) {
				if (onError) {
					onError(error instanceof Error ? error : new Error(String(error)));
				}
			} finally {
				debounceTimers.delete(filePath);
			}
		}, config.debounceMs);

		debounceTimers.set(filePath, timer);
	}

	function findJsonlFiles(dir: string): string[] {
		const files: string[] = [];
		try {
			const entries = readdirSync(dir);
			for (const entry of entries) {
				const fullPath = join(dir, entry);
				const stat = statSync(fullPath);
				if (stat.isDirectory()) {
					files.push(...findJsonlFiles(fullPath));
				} else if (entry.endsWith(".jsonl")) {
					files.push(fullPath);
				}
			}
		} catch {
			// Directory might not exist
		}
		return files;
	}

	function computeSessionStats(
		sessionId: string,
		pipeline: Pipeline,
	): SessionStats {
		const stats = pipeline.getStats();
		return {
			sessionId,
			totalTokens: stats.totalIngested,
			optimizedTokens: stats.currentTokens,
			reduction:
				stats.totalIngested > 0
					? (stats.totalIngested - stats.currentTokens) / stats.totalIngested
					: 0,
			entryCount: stats.currentEntries,
			budgetUtilization: stats.budgetUtilization,
		};
	}

	async function start(): Promise<void> {
		const projectsDir = getProjectsDir();

		try {
			const projectsWatcher = watch(
				projectsDir,
				{ recursive: true },
				(_eventType, filename) => {
					if (filename?.endsWith(".jsonl")) {
						handleFileChange(join(projectsDir, filename));
					}
				},
			);
			watchers.push(projectsWatcher);
		} catch {
			// Recursive watch not supported — fallback to per-dir
			const jsonlFiles = findJsonlFiles(projectsDir);
			const watchedDirs = new Set<string>();

			for (const file of jsonlFiles) {
				const dir = dirname(file);
				if (!watchedDirs.has(dir)) {
					const watcher = watch(
						dir,
						{ recursive: false },
						(_eventType, filename) => {
							if (filename?.endsWith(".jsonl")) {
								handleFileChange(join(dir, filename));
							}
						},
					);
					watchers.push(watcher);
					watchedDirs.add(dir);
				}
			}
		}
	}

	function stop(): void {
		for (const watcher of watchers) {
			watcher.close();
		}
		watchers.length = 0;

		for (const timer of debounceTimers.values()) {
			clearTimeout(timer);
		}
		debounceTimers.clear();
		pipelines.clear();
		fileTracker.clearAll();
	}

	function getStats(): SessionStats[] {
		const stats: SessionStats[] = [];
		for (const [sessionId, pipeline] of pipelines.entries()) {
			stats.push(computeSessionStats(sessionId, pipeline));
		}
		return stats;
	}

	function getSessionStats(sessionId: string): SessionStats | null {
		const pipeline = pipelines.get(sessionId);
		if (!pipeline) return null;
		return computeSessionStats(sessionId, pipeline);
	}

	function optimizeSession(sessionId: string): void {
		const pipeline = pipelines.get(sessionId);
		if (!pipeline) return;
		pipeline.optimize();
		if (onOptimize) {
			onOptimize(sessionId, computeSessionStats(sessionId, pipeline));
		}
	}

	return {
		start,
		stop,
		getStats,
		getSessionStats,
		optimizeSession,
	};
}
