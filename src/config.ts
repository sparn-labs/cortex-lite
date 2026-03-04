/**
 * Configuration for cortex-lite with Zod validation.
 */

import { z } from "zod";
import type { EngineConfig } from "./types.js";

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
