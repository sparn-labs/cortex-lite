/**
 * @sparn/cortex-lite — Lightweight context optimization engine.
 *
 * Core compression pipeline with Rust-powered compute via napi-rs.
 */

// Types
export type {
	MemoryEntry,
	PruneResult,
	ConsolidateResult,
	EngineConfig,
	EngineStats,
	ConfidenceState,
	BlockType,
	StateDistribution,
	CostStats,
} from "./types.js";

// Config
export {
	CortexLiteConfigSchema,
	DEFAULT_CONFIG,
	MODEL_PRICING,
	MODEL_ALIASES,
	type CortexLiteConfig,
	type ModelPricing,
} from "./config.js";

// Pipeline
export { createPipeline, type Pipeline, type PipelineStats } from "./pipeline.js";

// Native engine (direct access)
export { createNativeEngine, type NativeEngine } from "./native.js";

// Utils
export {
	parseClaudeCodeContext,
	parseJSONLContext,
	parseGenericContext,
	createEntry,
} from "./utils/context-parser.js";
export { createLogger, type Logger, type LogLevel } from "./utils/logger.js";
