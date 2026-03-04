import { describe, expect, it } from "vitest";
import { createPipeline } from "../../src/pipeline";

describe("Pipeline", () => {
	it("should create pipeline with defaults", () => {
		const pipeline = createPipeline();
		expect(pipeline.getEntries()).toHaveLength(0);
		expect(pipeline.getTokenCount()).toBe(0);
	});

	it("should ingest text context", () => {
		const pipeline = createPipeline();
		const result = pipeline.ingest(
			"User: Hello\nAssistant: Hi there! How can I help?",
		);
		expect(result.kept.length).toBeGreaterThan(0);
		expect(pipeline.getEntries().length).toBeGreaterThan(0);
	});

	it("should ingest JSONL context", () => {
		const pipeline = createPipeline();
		const jsonl = [
			JSON.stringify({ role: "user", content: "Hello" }),
			JSON.stringify({
				role: "assistant",
				content: "Hi! How can I help?",
			}),
		].join("\n");

		pipeline.ingest(jsonl);
		expect(pipeline.getEntries().length).toBe(2);
	});

	it("should detect BTSP entries on ingest", () => {
		const pipeline = createPipeline();
		pipeline.ingest(
			"User: I got an error\nAssistant: TypeError: Cannot read property 'foo' of undefined",
		);
		const btspEntries = pipeline
			.getEntries()
			.filter((e) => e.isBTSP);
		expect(btspEntries.length).toBeGreaterThan(0);
	});

	it("should optimize when threshold exceeded", () => {
		const pipeline = createPipeline({
			tokenBudget: 200,
			autoOptimizeThreshold: 500,
		});

		// Ingest lots of content to trigger auto-optimization
		const longText = "The quick brown fox jumps over the lazy dog. ".repeat(20);
		for (let i = 0; i < 10; i++) {
			pipeline.ingest(`User: Message ${i}. ${longText}`);
		}

		const stats = pipeline.getStats();
		expect(stats.optimizationCount).toBeGreaterThan(0);
	});

	it("should consolidate entries", () => {
		const pipeline = createPipeline();

		// Ingest duplicate content
		pipeline.ingest("User: Hello world\nAssistant: Hi!");
		pipeline.ingest("User: Hello world\nAssistant: Hi!");
		pipeline.ingest("User: Different message");

		const before = pipeline.getEntries().length;
		const result = pipeline.consolidate();
		expect(result.entriesBefore).toBe(before);
		expect(result.duplicatesRemoved).toBeGreaterThanOrEqual(0);
	});

	it("should clear all state", () => {
		const pipeline = createPipeline();
		pipeline.ingest("User: Hello");
		expect(pipeline.getEntries().length).toBeGreaterThan(0);

		pipeline.clear();
		expect(pipeline.getEntries()).toHaveLength(0);
		expect(pipeline.getTokenCount()).toBe(0);
	});

	it("should track pipeline stats", () => {
		const pipeline = createPipeline();
		pipeline.ingest("User: Test message");

		const stats = pipeline.getStats();
		expect(stats.totalIngested).toBeGreaterThan(0);
		expect(stats.currentEntries).toBeGreaterThan(0);
		expect(stats.currentTokens).toBeGreaterThan(0);
	});
});
