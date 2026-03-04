import { describe, expect, it } from "vitest";
import { createNativeEngine } from "../../src/native";
import type { MemoryEntry } from "../../src/types";

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: `test-${Math.random().toString(36).slice(2)}`,
		content: overrides.content ?? "test content for entry",
		hash: overrides.hash ?? "abc123",
		timestamp: overrides.timestamp ?? Date.now(),
		score: overrides.score ?? 0.8,
		ttl: overrides.ttl ?? 86400,
		state: overrides.state ?? "active",
		accessCount: overrides.accessCount ?? 0,
		tags: overrides.tags ?? [],
		isBTSP: overrides.isBTSP ?? false,
	};
}

describe("NativeEngine", () => {
	const engine = createNativeEngine();

	it("should count tokens", () => {
		const count = engine.countTokens("Hello, world!");
		expect(count).toBeGreaterThan(0);
		expect(typeof count).toBe("number");
	});

	it("should count tokens in batch", () => {
		const counts = engine.countTokensBatch(["Hello", "world", "test"]);
		expect(counts).toHaveLength(3);
		expect(counts.every((c) => c > 0)).toBe(true);
	});

	it("should detect BTSP patterns", () => {
		expect(engine.detectBtsp("TypeError: Cannot read property")).toBe(true);
		expect(engine.detectBtsp("  at Module._compile (node:internal/modules/cjs/loader:1376:14)")).toBe(true);
		expect(engine.detectBtsp("ENOENT: no such file")).toBe(true);
		expect(engine.detectBtsp("<<<<<<< HEAD")).toBe(true);
		expect(engine.detectBtsp("Everything is fine")).toBe(false);
		expect(engine.detectBtsp("Normal log message")).toBe(false);
	});

	it("should hash content deterministically", () => {
		const hash1 = engine.hashContent("test content");
		const hash2 = engine.hashContent("test content");
		const hash3 = engine.hashContent("different content");
		expect(hash1).toBe(hash2);
		expect(hash1).not.toBe(hash3);
		expect(hash1.length).toBe(64); // SHA-256 hex
	});

	it("should classify confidence states", () => {
		expect(engine.classifyState(0.8, false)).toBe("active");
		expect(engine.classifyState(0.5, false)).toBe("ready");
		expect(engine.classifyState(0.1, false)).toBe("silent");
		expect(engine.classifyState(0.1, true)).toBe("active"); // BTSP always active
	});

	it("should calculate score with decay", () => {
		const entry = makeEntry({
			score: 1.0,
			timestamp: Date.now() - 3600 * 1000, // 1 hour ago
			ttl: 86400,
		});
		const score = engine.calculateScore(entry);
		expect(score).toBeGreaterThan(0);
		expect(score).toBeLessThanOrEqual(1.0);
	});

	it("should optimize entries to fit budget", () => {
		const entries = Array.from({ length: 50 }, (_, i) =>
			makeEntry({
				content: `Entry ${i} with some content that takes tokens to represent. This is a test entry for budget pruning.`,
				hash: `hash-${i}`,
				score: Math.random(),
				state: Math.random() > 0.5 ? "active" : "ready",
			}),
		);

		const result = engine.optimize(entries, 5000);
		expect(result.kept.length).toBeLessThanOrEqual(entries.length);
		expect(result.kept.length + result.removed.length).toBe(entries.length);
		expect(result.prunedTokens).toBeLessThanOrEqual(5000);
		expect(result.budgetUtilization).toBeGreaterThan(0);
	});

	it("should consolidate entries", () => {
		const entries = [
			makeEntry({ content: "unique content A", hash: "hash-a" }),
			makeEntry({ content: "unique content A", hash: "hash-a" }), // duplicate
			makeEntry({ content: "unique content B", hash: "hash-b" }),
			makeEntry({
				content: "old content",
				hash: "hash-old",
				timestamp: Date.now() - 365 * 24 * 3600 * 1000, // 1 year ago
				ttl: 1, // very short TTL
			}),
		];

		const result = engine.consolidate(entries);
		expect(result.entriesAfter).toBeLessThan(result.entriesBefore);
		expect(result.duplicatesRemoved).toBeGreaterThanOrEqual(1);
	});

	it("should reset engine state", () => {
		engine.reset();
		const stats = engine.getStats();
		expect(stats.cachedEntries).toBe(0);
		expect(stats.updateCount).toBe(0);
	});
});
