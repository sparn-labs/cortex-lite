/**
 * Native binding loader for cortex-engine.
 *
 * Loads the napi-rs native addon with a JS fallback for environments
 * where the native addon isn't available.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
	ConsolidateResult,
	EngineConfig,
	EngineStats,
	MemoryEntry,
	PruneResult,
} from "./types.js";

export interface NativeEngine {
	optimize(entries: MemoryEntry[], budget?: number): PruneResult;
	consolidate(entries: MemoryEntry[]): ConsolidateResult;
	countTokens(text: string): number;
	countTokensBatch(texts: string[]): number[];
	detectBtsp(content: string): boolean;
	hashContent(content: string): string;
	calculateScore(entry: MemoryEntry, currentTime?: number): number;
	classifyState(score: number, isBtsp: boolean): string;
	reset(): void;
	getStats(): EngineStats;
}

/**
 * Map TS MemoryEntry (isBTSP) to Rust napi format (isBtsp) and back.
 */
// biome-ignore lint/suspicious/noExplicitAny: napi interop
function toNapi(entry: MemoryEntry): any {
	return {
		id: entry.id,
		content: entry.content,
		hash: entry.hash,
		timestamp: entry.timestamp,
		score: entry.score,
		ttl: entry.ttl,
		state: entry.state,
		accessCount: entry.accessCount,
		tags: entry.tags,
		isBtsp: entry.isBTSP,
	};
}

// biome-ignore lint/suspicious/noExplicitAny: napi interop
function fromNapi(entry: any): MemoryEntry {
	return {
		id: entry.id,
		content: entry.content,
		hash: entry.hash,
		timestamp: entry.timestamp,
		score: entry.score,
		ttl: entry.ttl,
		state: entry.state,
		accessCount: entry.accessCount,
		tags: entry.tags,
		isBTSP: entry.isBtsp ?? entry.isBTSP ?? false,
	};
}

/**
 * Create a native engine instance.
 * Attempts to load the Rust napi-rs addon, falls back to JS implementation.
 */
export function createNativeEngine(config?: EngineConfig): NativeEngine {
	try {
		const nativeAddonPath = join(
			import.meta.dirname ?? __dirname,
			"..",
			"crates",
			"cortex-engine",
			"cortex-engine.linux-x64-gnu.node",
		);

		// biome-ignore lint/suspicious/noExplicitAny: dynamic native require
		const native = require(nativeAddonPath) as any;
		const engine = new native.CortexEngine(
			config
				? {
						tokenBudget: config.tokenBudget,
						defaultTtl: config.defaultTTL,
						decayThreshold: config.decayThreshold,
						activeThreshold: config.activeThreshold,
						readyThreshold: config.readyThreshold,
						fullOptimizationInterval: config.fullOptimizationInterval,
						recencyBoostMinutes: config.recencyBoostMinutes,
						recencyBoostMultiplier: config.recencyBoostMultiplier,
					}
				: undefined,
		);

		return {
			optimize: (entries, budget) => {
				const result = engine.optimize(entries.map(toNapi), budget ?? null);
				return {
					...result,
					kept: result.kept.map(fromNapi),
					removed: result.removed.map(fromNapi),
				};
			},
			consolidate: (entries) => {
				const result = engine.consolidate(entries.map(toNapi));
				return {
					...result,
					kept: result.kept.map(fromNapi),
					removed: result.removed.map(fromNapi),
				};
			},
			countTokens: (text) => engine.countTokens(text),
			countTokensBatch: (texts) => engine.countTokensBatch(texts),
			detectBtsp: (content) => engine.detectBtsp(content),
			hashContent: (content) => engine.hashContent(content),
			calculateScore: (entry, currentTime) =>
				engine.calculateScore(toNapi(entry), currentTime ?? null),
			classifyState: (score, isBtsp) => engine.classifyState(score, isBtsp),
			reset: () => engine.reset(),
			getStats: () => engine.getStats(),
		};
	} catch {
		// Fallback to JS implementation
		return createJSFallbackEngine(config);
	}
}

/**
 * Pure JS fallback engine (slower but no native deps).
 */
function createJSFallbackEngine(config?: EngineConfig): NativeEngine {
	const tokenBudget = config?.tokenBudget ?? 40000;
	const defaultTTL = config?.defaultTTL ?? 24;
	const decayThreshold = config?.decayThreshold ?? 0.95;
	const activeThreshold = config?.activeThreshold ?? 0.7;
	const readyThreshold = config?.readyThreshold ?? 0.3;
	const recencyBoostMinutes = config?.recencyBoostMinutes ?? 30;
	const recencyBoostMultiplier = config?.recencyBoostMultiplier ?? 1.3;

	function estimateTokens(text: string): number {
		const words = text.split(/\s+/).length;
		const chars = text.length / 4;
		return Math.max(words, Math.ceil(chars));
	}

	function hashContent(content: string): string {
		return createHash("sha256").update(content).digest("hex");
	}

	const btspPatterns = [
		/\b(error|exception|failure|fatal|critical|panic)\b/i,
		/\b(TypeError|ReferenceError|SyntaxError|RangeError|URIError)\b/,
		/\bENOENT|EACCES|ECONNREFUSED|ETIMEDOUT\b/,
		/^\s+at\s+.*\(.*:\d+:\d+\)/m,
		/^\s+at\s+.*\.[a-zA-Z]+:\d+/m,
		/^new file mode \d+$/m,
		/^--- \/dev\/null$/m,
		/^<<<<<<< /m,
		/^=======$/m,
		/^>>>>>>> /m,
	];

	function detectBtsp(content: string): boolean {
		return btspPatterns.some((p) => p.test(content));
	}

	function calculateDecay(ageSeconds: number, ttl: number): number {
		if (ttl === 0) return 1;
		if (ageSeconds <= 0) return 0;
		return Math.max(0, Math.min(1, 1 - Math.exp(-ageSeconds / ttl)));
	}

	function calculateScore(
		entry: MemoryEntry,
		currentTime?: number,
	): number {
		const now = currentTime ?? Date.now();
		const ageSeconds = Math.max(0, (now - entry.timestamp) / 1000);
		const decay = calculateDecay(ageSeconds, entry.ttl);
		let score = entry.score * (1 - decay);

		if (entry.accessCount > 0) {
			score = Math.min(1.0, score + Math.log(entry.accessCount + 1) * 0.1);
		}
		if (entry.isBTSP) {
			score = Math.max(score, 0.9);
		}

		const recencyWindowMs = recencyBoostMinutes * 60 * 1000;
		if (!entry.isBTSP && recencyWindowMs > 0) {
			const ageMs = now - entry.timestamp;
			if (ageMs >= 0 && ageMs < recencyWindowMs) {
				score *=
					1 + (recencyBoostMultiplier - 1) * (1 - ageMs / recencyWindowMs);
			}
		}
		return Math.max(0, Math.min(1, score));
	}

	function classifyState(score: number, isBtsp: boolean): string {
		if (isBtsp || score >= activeThreshold) return "active";
		if (score >= readyThreshold) return "ready";
		return "silent";
	}

	function optimize(
		entries: MemoryEntry[],
		budget?: number,
	): PruneResult {
		const b = budget ?? tokenBudget;
		if (entries.length === 0) {
			return {
				kept: [],
				removed: [],
				originalTokens: 0,
				prunedTokens: 0,
				budgetUtilization: 0,
			};
		}

		const originalTokens = entries.reduce(
			(sum, e) => sum + estimateTokens(e.content),
			0,
		);

		const btsp = entries.filter((e) => e.isBTSP);
		const regular = entries.filter((e) => !e.isBTSP);

		let includedBtsp: MemoryEntry[] = [];
		let btspTokens = 0;
		const sortedBtsp = [...btsp].sort((a, b) => b.timestamp - a.timestamp);
		for (const entry of sortedBtsp) {
			const tokens = estimateTokens(entry.content);
			if (btspTokens + tokens <= b * 0.8) {
				includedBtsp.push(entry);
				btspTokens += tokens;
			}
		}
		if (includedBtsp.length === 0 && sortedBtsp.length > 0) {
			includedBtsp = [sortedBtsp[0]!];
			btspTokens = estimateTokens(sortedBtsp[0]!.content);
		}

		const scored = regular.map((entry) => ({
			entry,
			score: calculateScore(entry),
			tokens: estimateTokens(entry.content),
		}));
		scored.sort((a, b) => b.score - a.score);

		const kept = [...includedBtsp];
		const removed = btsp.filter(
			(e) => !includedBtsp.some((b) => b.id === e.id),
		);
		let currentTokens = btspTokens;

		for (const item of scored) {
			if (currentTokens + item.tokens <= b) {
				kept.push(item.entry);
				currentTokens += item.tokens;
			} else {
				removed.push(item.entry);
			}
		}

		return {
			kept,
			removed,
			originalTokens,
			prunedTokens: currentTokens,
			budgetUtilization: b > 0 ? currentTokens / b : 0,
		};
	}

	function consolidate(entries: MemoryEntry[]): ConsolidateResult {
		const start = Date.now();
		const originalCount = entries.length;
		const now = Date.now();

		const nonDecayed = entries.filter((entry) => {
			const ageSeconds = (now - entry.timestamp) / 1000;
			return calculateDecay(ageSeconds, entry.ttl) < decayThreshold;
		});
		const decayedRemoved = originalCount - nonDecayed.length;

		// Simple dedup by hash
		const seen = new Map<string, MemoryEntry>();
		let duplicatesRemoved = 0;
		for (const entry of nonDecayed) {
			const existing = seen.get(entry.hash);
			if (existing) {
				if (entry.score > existing.score) {
					seen.set(entry.hash, entry);
				}
				duplicatesRemoved++;
			} else {
				seen.set(entry.hash, entry);
			}
		}

		const kept = Array.from(seen.values());
		const keptIds = new Set(kept.map((e) => e.id));
		const removed = entries.filter((e) => !keptIds.has(e.id));

		return {
			kept,
			removed,
			entriesBefore: originalCount,
			entriesAfter: kept.length,
			decayedRemoved,
			duplicatesRemoved,
			compressionRatio:
				originalCount > 0 ? kept.length / originalCount : 0,
			durationMs: Date.now() - start,
		};
	}

	return {
		optimize,
		consolidate,
		countTokens: estimateTokens,
		countTokensBatch: (texts) => texts.map(estimateTokens),
		detectBtsp,
		hashContent,
		calculateScore,
		classifyState,
		reset: () => {},
		getStats: () => ({
			cachedEntries: 0,
			uniqueTerms: 0,
			totalDocuments: 0,
			updateCount: 0,
		}),
	};
}
