/**
 * Pipeline orchestrator - parse context → Rust optimize → manage entries.
 */

import { type CortexLiteConfig, DEFAULT_CONFIG, toEngineConfig } from "./config.js";
import { type NativeEngine, createNativeEngine } from "./native.js";
import type { ConsolidateResult, MemoryEntry, PruneResult } from "./types.js";
import { parseClaudeCodeContext, parseGenericContext } from "./utils/context-parser.js";

export interface Pipeline {
	/** Ingest raw context and optimize */
	ingest(context: string, format?: "claude-code" | "generic"): PruneResult;

	/** Optimize current entries to fit budget */
	optimize(budget?: number): PruneResult;

	/** Consolidate: remove decayed + merge duplicates */
	consolidate(): ConsolidateResult;

	/** Get all current entries */
	getEntries(): MemoryEntry[];

	/** Get current token count */
	getTokenCount(): number;

	/** Clear all entries and reset engine */
	clear(): void;

	/** Get underlying engine for direct access */
	getEngine(): NativeEngine;

	/** Get pipeline statistics */
	getStats(): PipelineStats;
}

export interface PipelineStats {
	totalIngested: number;
	currentEntries: number;
	currentTokens: number;
	budgetUtilization: number;
	optimizationCount: number;
}

export function createPipeline(config?: Partial<CortexLiteConfig>): Pipeline {
	const fullConfig = { ...DEFAULT_CONFIG, ...config };
	const engine = createNativeEngine(toEngineConfig(fullConfig));

	let entries: MemoryEntry[] = [];
	let totalIngested = 0;
	let optimizationCount = 0;
	let lastBudgetUtilization = 0;

	function ingest(
		context: string,
		format: "claude-code" | "generic" = "claude-code",
	): PruneResult {
		const parsed =
			format === "claude-code"
				? parseClaudeCodeContext(context)
				: parseGenericContext(context);

		// Detect BTSP and mark entries
		for (const entry of parsed) {
			if (engine.detectBtsp(entry.content)) {
				entry.isBTSP = true;
				entry.score = 1.0;
				entry.state = "active";
				entry.ttl = 365 * 24 * 3600;
				if (!entry.tags.includes("btsp")) {
					entry.tags.push("btsp");
				}
			}
		}

		entries.push(...parsed);
		totalIngested += parsed.length;

		// Auto-optimize if over threshold
		const tokenCount = getTokenCount();
		if (tokenCount >= fullConfig.autoOptimizeThreshold) {
			return optimize();
		}

		return {
			kept: entries,
			removed: [],
			originalTokens: tokenCount,
			prunedTokens: tokenCount,
			budgetUtilization: fullConfig.tokenBudget > 0 ? tokenCount / fullConfig.tokenBudget : 0,
		};
	}

	function optimize(budget?: number): PruneResult {
		const result = engine.optimize(entries, budget);
		entries = result.kept;
		lastBudgetUtilization = result.budgetUtilization;
		optimizationCount++;
		return result;
	}

	function consolidate(): ConsolidateResult {
		const result = engine.consolidate(entries);
		entries = result.kept;
		return result;
	}

	function getEntries(): MemoryEntry[] {
		return entries;
	}

	function getTokenCount(): number {
		if (entries.length === 0) return 0;
		const tokens = engine.countTokensBatch(entries.map((e) => e.content));
		return tokens.reduce((sum, t) => sum + t, 0);
	}

	function clear(): void {
		entries = [];
		engine.reset();
		totalIngested = 0;
		optimizationCount = 0;
		lastBudgetUtilization = 0;
	}

	function getEngine(): NativeEngine {
		return engine;
	}

	function getStats(): PipelineStats {
		return {
			totalIngested,
			currentEntries: entries.length,
			currentTokens: getTokenCount(),
			budgetUtilization: lastBudgetUtilization,
			optimizationCount,
		};
	}

	return {
		ingest,
		optimize,
		consolidate,
		getEntries,
		getTokenCount,
		clear,
		getEngine,
		getStats,
	};
}
