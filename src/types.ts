/**
 * Core types for cortex-lite — mirrors Rust napi types.
 */

export type ConfidenceState = "silent" | "ready" | "active";

export interface MemoryEntry {
	id: string;
	content: string;
	hash: string;
	timestamp: number;
	score: number;
	ttl: number;
	state: ConfidenceState;
	accessCount: number;
	tags: string[];
	isBTSP: boolean;
}

export interface PruneResult {
	kept: MemoryEntry[];
	removed: MemoryEntry[];
	originalTokens: number;
	prunedTokens: number;
	budgetUtilization: number;
}

export interface ConsolidateResult {
	kept: MemoryEntry[];
	removed: MemoryEntry[];
	entriesBefore: number;
	entriesAfter: number;
	decayedRemoved: number;
	duplicatesRemoved: number;
	compressionRatio: number;
	durationMs: number;
}

export interface EngineConfig {
	tokenBudget?: number;
	defaultTTL?: number;
	decayThreshold?: number;
	activeThreshold?: number;
	readyThreshold?: number;
	fullOptimizationInterval?: number;
	recencyBoostMinutes?: number;
	recencyBoostMultiplier?: number;
}

export interface EngineStats {
	cachedEntries: number;
	uniqueTerms: number;
	totalDocuments: number;
	updateCount: number;
}

export type BlockType = "conversation" | "tool" | "result" | "other";

export interface StateDistribution {
	active: number;
	ready: number;
	silent: number;
	total: number;
}

export interface CostStats {
	model: string; // Resolved model ID
	inputTokens: number; // Total input tokens this session
	outputTokens: number; // Total output tokens this session
	inputCost: number; // $ accumulated input cost
	outputCost: number; // $ accumulated output cost
	totalCost: number; // $ inputCost + outputCost
}
