import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFileTracker } from "../../src/daemon/file-tracker";

describe("FileTracker", () => {
	const testDir = join(tmpdir(), `cortex-lite-test-${Date.now()}`);
	const testFile = join(testDir, "test.jsonl");

	beforeAll(() => {
		mkdirSync(testDir, { recursive: true });
		writeFileSync(testFile, "", "utf-8");
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("should read new lines incrementally", () => {
		const tracker = createFileTracker();

		// First read — empty file
		const lines1 = tracker.readNewLines(testFile);
		expect(lines1).toHaveLength(0);

		// Append content
		writeFileSync(
			testFile,
			'{"role":"user","content":"Hello"}\n{"role":"assistant","content":"Hi"}\n',
			"utf-8",
		);

		const lines2 = tracker.readNewLines(testFile);
		expect(lines2).toHaveLength(2);
		expect(lines2[0]).toContain("Hello");

		// Append more
		writeFileSync(
			testFile,
			'{"role":"user","content":"Hello"}\n{"role":"assistant","content":"Hi"}\n{"role":"user","content":"How are you?"}\n',
			"utf-8",
		);

		const lines3 = tracker.readNewLines(testFile);
		expect(lines3).toHaveLength(1);
		expect(lines3[0]).toContain("How are you?");
	});

	it("should handle file truncation", () => {
		const tracker = createFileTracker();

		writeFileSync(testFile, "line1\nline2\n", "utf-8");
		tracker.readNewLines(testFile);

		// Truncate file
		writeFileSync(testFile, "new\n", "utf-8");
		const lines = tracker.readNewLines(testFile);
		// Should detect truncation and return empty (resets position)
		expect(lines).toHaveLength(0);
	});

	it("should track multiple files", () => {
		const tracker = createFileTracker();
		const file2 = join(testDir, "test2.jsonl");
		writeFileSync(file2, "line1\n", "utf-8");

		tracker.readNewLines(testFile);
		tracker.readNewLines(file2);

		expect(tracker.getTrackedFiles()).toHaveLength(2);

		tracker.resetPosition(file2);
		expect(tracker.getTrackedFiles()).toHaveLength(1);

		tracker.clearAll();
		expect(tracker.getTrackedFiles()).toHaveLength(0);
	});
});
