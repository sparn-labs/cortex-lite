/**
 * Configuration for cortex-lite with Zod validation.
 */

import { z } from "zod";
import type { EngineConfig } from "./types.js";

export interface ModelPricing {
	inputPerMillion: number; // $ per 1M input tokens
	outputPerMillion: number; // $ per 1M output tokens
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
	// Claude 4.x / Opus
	"claude-opus-4-6": { inputPerMillion: 15, outputPerMillion: 75 },
	"claude-opus-4-5-20250620": { inputPerMillion: 15, outputPerMillion: 75 },
	// Claude 4.x / Sonnet
	"claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15 },
	"claude-sonnet-4-5-20241022": { inputPerMillion: 3, outputPerMillion: 15 },
	// Claude 4.x / Haiku
	"claude-haiku-4-5-20251001": { inputPerMillion: 0.8, outputPerMillion: 4 },
	// Claude 3.5
	"claude-3-5-sonnet-20241022": { inputPerMillion: 3, outputPerMillion: 15 },
	"claude-3-5-haiku-20241022": { inputPerMillion: 0.8, outputPerMillion: 4 },
	// GPT-4o
	"gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
	"gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
	// Gemini
	"gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10 },
	"gemini-2.5-flash": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

export const MODEL_ALIASES: Record<string, string> = {
	opus: "claude-opus-4-6",
	sonnet: "claude-sonnet-4-6",
	haiku: "claude-haiku-4-5-20251001",
	gpt4o: "gpt-4o",
	"gpt4o-mini": "gpt-4o-mini",
	"gemini-pro": "gemini-2.5-pro",
	"gemini-flash": "gemini-2.5-flash",
};

export const CortexLiteConfigSchema = z.object({
	tokenBudget: z.number().min(1000).max(200000).default(40000),
	defaultTTL: z.number().min(0.1).max(720).default(24),
	decayThreshold: z.number().min(0).max(1).default(0.95),
	activeThreshold: z.number().min(0).max(1).default(0.7),
	readyThreshold: z.number().min(0).max(1).default(0.3),
	fullOptimizationInterval: z.number().min(1).max(1000).default(50),
	recencyBoostMinutes: z.number().min(0).max(1440).default(30),
	recencyBoostMultiplier: z.number().min(1).max(5).default(1.3),
	autoOptimizeThreshold: z.number().min(1000).max(500000).default(60000),
	debounceMs: z.number().min(100).max(30000).default(5000),
	verbose: z.boolean().default(false),
	model: z.string().optional(),
});

export type CortexLiteConfig = z.infer<typeof CortexLiteConfigSchema>;

export const DEFAULT_CONFIG: CortexLiteConfig = CortexLiteConfigSchema.parse({});

export function toEngineConfig(config: CortexLiteConfig): EngineConfig {
	return {
		tokenBudget: config.tokenBudget,
		defaultTTL: config.defaultTTL,
		decayThreshold: config.decayThreshold,
		activeThreshold: config.activeThreshold,
		readyThreshold: config.readyThreshold,
		fullOptimizationInterval: config.fullOptimizationInterval,
		recencyBoostMinutes: config.recencyBoostMinutes,
		recencyBoostMultiplier: config.recencyBoostMultiplier,
	};
}
