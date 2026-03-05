#!/usr/bin/env node
/**
 * PostToolUse Hook - Compresses verbose tool output.
 * Adapted from @sparn/cortex: uses native engine for token counting.
 *
 * CRITICAL: Always exits 0 (never disrupts Claude Code).
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MODEL_ALIASES, MODEL_PRICING } from "../config.js";
import type { CostStats } from "../types.js";

const DEBUG = process.env["CORTEX_DEBUG"] === "true";
const LOG_FILE =
	process.env["CORTEX_LOG_FILE"] || join(homedir(), ".cortex-hook.log");

const PER_TOOL_THRESHOLD: Record<string, number> = {
	Bash: 2000,
	Read: 2500,
	Grep: 2000,
	Glob: 1500,
	WebFetch: 1500,
	WebSearch: 1000,
};
const BASE_THRESHOLD = 3000;

const SESSION_STATS_FILE = join(homedir(), ".cortex", "session-stats.json");

interface PerToolStats {
	compressed: number;
	tokensBefore: number;
	tokensAfter: number;
}

interface SessionStats {
	sessionId: string;
	outputsCompressed: number;
	totalTokensBefore: number;
	totalTokensAfter: number;
	lastUpdated: number;
	perTool?: Record<string, PerToolStats>;
	cost?: CostStats;
}

function detectModel(): string {
	return (
		process.env["CORTEX_MODEL"] ||
		process.env["CLAUDE_MODEL"] ||
		"claude-sonnet-4-6"
	);
}

function resolveModel(input: string): string {
	return MODEL_ALIASES[input.toLowerCase()] || input;
}

/** Estimate tokens (fast heuristic — no native dependency in hooks) */
function estimateTokens(text: string): number {
	const words = text.split(/\s+/).length;
	const chars = text.length / 4;
	return Math.max(words, Math.ceil(chars));
}

function log(message: string): void {
	if (DEBUG) {
		const timestamp = new Date().toISOString();
		appendFileSync(LOG_FILE, `[${timestamp}] [post-tool] ${message}\n`);
	}
}

function loadSessionStats(sessionId: string): SessionStats {
	try {
		if (existsSync(SESSION_STATS_FILE)) {
			const data = JSON.parse(
				readFileSync(SESSION_STATS_FILE, "utf-8"),
			) as SessionStats;
			if (data.sessionId === sessionId) return data;
		}
	} catch {
		// ignore
	}
	return {
		sessionId,
		outputsCompressed: 0,
		totalTokensBefore: 0,
		totalTokensAfter: 0,
		lastUpdated: Date.now(),
		perTool: {},
	};
}

function saveSessionStats(stats: SessionStats): void {
	try {
		const dir = join(homedir(), ".cortex");
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(SESSION_STATS_FILE, JSON.stringify(stats), "utf-8");
	} catch {
		// ignore
	}
}

export function getThreshold(
	toolName: string,
	stats: SessionStats,
): number {
	const base = PER_TOOL_THRESHOLD[toolName] ?? BASE_THRESHOLD;
	const total = stats.totalTokensBefore;
	const multiplier =
		total > 500000 ? 0.33 : total > 300000 ? 0.5 : total > 100000 ? 0.75 : 1.0;
	return Math.max(500, Math.floor(base * multiplier));
}

interface HookInput {
	session_id?: string;
	hook_event_name?: string;
	tool_name?: string;
	tool_use_id?: string;
	tool_input?: Record<string, unknown>;
	tool_response?: unknown;
}

function extractText(response: unknown): string {
	if (typeof response === "string") return response;
	if (response && typeof response === "object") return JSON.stringify(response);
	return String(response ?? "");
}

// ─── Compression strategies ───────────────────────────────────────

export function summarizeBash(text: string, command: string): string {
	const lines = text.split("\n");

	if (/\d+ (pass|fail|skip)/i.test(text) || /Tests?:/i.test(text)) {
		const resultLines = lines.filter(
			(l) =>
				/(pass|fail|skip|error|Tests?:|Test Suites?:)/i.test(l) ||
				/^\s*(PASS|FAIL)\s/.test(l),
		);
		if (resultLines.length > 0) {
			return `[cortex] Test output summary (${lines.length} lines):\n${resultLines.slice(0, 15).join("\n")}`;
		}
	}

	if (/TS\d{4,5}:/.test(text)) {
		const errorCodes = new Map<string, number>();
		for (const line of lines) {
			const match = line.match(/TS(\d{4,5}):/);
			if (match?.[1]) {
				const code = `TS${match[1]}`;
				errorCodes.set(code, (errorCodes.get(code) || 0) + 1);
			}
		}
		const totalErrors = Array.from(errorCodes.values()).reduce(
			(a, b) => a + b,
			0,
		);
		const codesSummary = Array.from(errorCodes.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([code, count]) => `${code}(${count})`)
			.join(", ");
		return `[cortex] TypeScript: ${totalErrors} errors across ${errorCodes.size} codes: ${codesSummary}`;
	}

	if (
		/\d+ (problem|error|warning|issue)/i.test(text) ||
		/lint/i.test(command)
	) {
		const rules = new Map<string, number>();
		for (const line of lines) {
			const match = line.match(/\s([a-z][\w/.-]+)\s*$/);
			if (match?.[1]?.includes("/")) {
				rules.set(match[1], (rules.get(match[1]) || 0) + 1);
			}
		}
		if (rules.size > 0) {
			const rulesSummary = Array.from(rules.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([rule, count]) => `${rule}(${count})`)
				.join(", ");
			return `[cortex] Lint: ${lines.length} lines, ${rules.size} rules: ${rulesSummary}`;
		}
	}

	if (/npm\s+(warn|info|notice)|added\s+\d+\s+packages/i.test(text)) {
		const added = text.match(/added\s+(\d+)\s+packages?/i);
		const removed = text.match(/removed\s+(\d+)\s+packages?/i);
		const updated = text.match(/changed\s+(\d+)\s+packages?/i);
		const audit = text.match(/(\d+)\s+vulnerabilit/i);
		const parts = ["[cortex] npm:"];
		if (added) parts.push(`${added[1]} added`);
		if (removed) parts.push(`${removed[1]} removed`);
		if (updated) parts.push(`${updated[1]} changed`);
		if (audit) parts.push(`${audit[1]} vulnerabilities`);
		if (parts.length > 1) return parts.join(" ");
	}

	if (
		/(error|warning|failed)/i.test(text) &&
		!/(git log|git status|ls\s)/i.test(command)
	) {
		const errorLines = lines.filter((l) =>
			/(error|warning|failed|fatal)/i.test(l),
		);
		if (errorLines.length > 0) {
			return `[cortex] Build output summary (${errorLines.length} errors/warnings from ${lines.length} lines):\n${errorLines.slice(0, 10).join("\n")}`;
		}
	}

	if (/^diff --git/m.test(text)) {
		const files: string[] = [];
		for (const line of lines) {
			const match = line.match(/^diff --git a\/(.*?) b\/(.*)/);
			if (match?.[2]) files.push(match[2]);
		}
		return `[cortex] Git diff: ${files.length} files changed: ${files.join(", ")}`;
	}

	if (/^commit [0-9a-f]{40}/m.test(text) || /git\s+log/i.test(command)) {
		const commitMatches = text.match(/^commit [0-9a-f]{40}/gm);
		if (commitMatches && commitMatches.length > 0) {
			const count = commitMatches.length;
			const firstMsg = lines.find(
				(l) =>
					l.trim().length > 0 &&
					!l.startsWith("commit ") &&
					!l.startsWith("Author:") &&
					!l.startsWith("Date:") &&
					!l.startsWith("Merge:"),
			);
			return `[cortex] Git log: ${count} commits. Latest: ${(firstMsg || "").trim().substring(0, 100)}`;
		}
	}

	if (/git\s+status/i.test(command)) {
		const modified = lines.filter((l) =>
			/^\s*(modified|renamed|deleted):/i.test(l.trim()),
		);
		const untracked = lines.filter(
			(l) => l.trim().length > 0 && !l.startsWith("#") && /^\t[^\s]/.test(l),
		);
		const staged = lines.filter((l) =>
			/^\s*(new file|modified|deleted):/i.test(l.trim()),
		);
		const fileNames = [...modified, ...staged]
			.map((l) =>
				l
					.trim()
					.replace(/^(modified|renamed|deleted|new file):\s*/i, ""),
			)
			.slice(0, 15);
		return `[cortex] Git status: ${modified.length} modified, ${staged.length} staged, ${untracked.length} untracked. Files: ${fileNames.join(", ")}`;
	}

	if (/\b(ls|find)\b/i.test(command)) {
		const extMap = new Map<string, number>();
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const dotIdx = trimmed.lastIndexOf(".");
			const ext = dotIdx > 0 ? trimmed.substring(dotIdx) : "(no ext)";
			extMap.set(ext, (extMap.get(ext) || 0) + 1);
		}
		const extSummary = Array.from(extMap.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)
			.map(([ext, count]) => `${ext}(${count})`)
			.join(", ");
		return `[cortex] ${lines.length} files listed. By extension: ${extSummary}`;
	}

	const trimmed = text.trim();
	if (
		(trimmed.startsWith("{") || trimmed.startsWith("[")) &&
		trimmed.length > 1000
	) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				const sample =
					parsed.length > 0
						? Object.keys(parsed[0] || {})
								.slice(0, 5)
								.join(", ")
						: "";
				return `[cortex] JSON array: ${parsed.length} items${sample ? `. Keys: ${sample}` : ""}`;
			}
			const keys = Object.keys(parsed);
			return `[cortex] JSON object: ${keys.length} keys: ${keys.slice(0, 10).join(", ")}`;
		} catch {
			// Not valid JSON
		}
	}

	const head = lines.slice(0, 3).join(" | ");
	const tail =
		lines.length > 6 ? ` ... last: ${lines.slice(-2).join(" | ")}` : "";
	const errorCount = lines.filter((l) =>
		/error|exception|fail/i.test(l),
	).length;
	const errorNote =
		errorCount > 0 ? ` (${errorCount} error lines detected)` : "";
	return `[cortex] Command \`${command}\` produced ${lines.length} lines.${errorNote} First 3: ${head}${tail}`;
}

export function summarizeFileRead(text: string, filePath: string): string {
	const lines = text.split("\n");
	const tokens = estimateTokens(text);
	const ext = filePath.split(".").pop()?.toLowerCase() || "";

	if (ext === "json") {
		const trimmed = text.trim();
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return `[cortex] File ${filePath}: JSON array with ${parsed.length} items, ~${tokens} tokens.`;
			}
			const keys = Object.keys(parsed);
			return `[cortex] File ${filePath}: JSON object with ${keys.length} keys: ${keys.slice(0, 12).join(", ")}. ~${tokens} tokens.`;
		} catch {
			// fall through
		}
	}

	if (ext === "yaml" || ext === "yml") {
		const topKeys = lines
			.filter((l) => /^[a-zA-Z_][\w-]*:/.test(l))
			.map((l) => l.split(":")[0]);
		if (topKeys.length > 0) {
			return `[cortex] File ${filePath}: YAML with ${topKeys.length} top-level keys: ${topKeys.slice(0, 12).join(", ")}. ${lines.length} lines, ~${tokens} tokens.`;
		}
	}

	if (ext === "md" || ext === "mdx") {
		const headings = lines
			.filter((l) => /^#{1,4}\s/.test(l))
			.map((l) => l.trim().substring(0, 60));
		return `[cortex] File ${filePath}: Markdown, ${lines.length} lines, ~${tokens} tokens. Headings: ${headings.slice(0, 10).join(" | ") || "(none)"}`;
	}

	const exports = lines.filter((l) => /^export\s/.test(l.trim()));
	const functions = lines.filter((l) => /function\s+\w+/.test(l));
	const classes = lines.filter((l) => /class\s+\w+/.test(l));
	const interfaces = lines.filter((l) =>
		/(?:interface|type)\s+\w+/.test(l),
	);
	const imports = lines.filter((l) => /^import\s/.test(l.trim()));

	const parts = [
		`[cortex] File ${filePath}: ${lines.length} lines, ~${tokens} tokens.`,
	];

	if (imports.length > 0) parts.push(`${imports.length} imports.`);
	if (exports.length > 0) {
		parts.push(
			`Exports: ${exports
				.slice(0, 5)
				.map((e) => e.trim().substring(0, 60))
				.join("; ")}`,
		);
	}
	if (functions.length > 0) {
		parts.push(
			`Functions: ${functions
				.slice(0, 5)
				.map((f) => f.trim().substring(0, 40))
				.join(", ")}`,
		);
	}
	if (classes.length > 0) {
		parts.push(
			`Classes: ${classes.map((c) => c.trim().substring(0, 40)).join(", ")}`,
		);
	}
	if (interfaces.length > 0) {
		parts.push(
			`Types: ${interfaces
				.slice(0, 5)
				.map((i) => i.trim().substring(0, 40))
				.join(", ")}`,
		);
	}

	return parts.join(" ");
}

export function summarizeSearch(text: string, pattern: string): string {
	const lines = text.split("\n").filter((l) => l.trim().length > 0);
	const fileMap = new Map<string, number>();

	for (const line of lines) {
		const match = line.match(/^(.*?):\d+:/);
		if (match?.[1]) {
			fileMap.set(match[1], (fileMap.get(match[1]) || 0) + 1);
		}
	}

	if (fileMap.size > 0) {
		const summary = Array.from(fileMap.entries())
			.slice(0, 5)
			.map(([f, c]) => `${f} (${c})`)
			.join(", ");
		return `[cortex] Search for "${pattern}": ${lines.length} matches across ${fileMap.size} files. Top files: ${summary}`;
	}

	return `[cortex] Search for "${pattern}": ${lines.length} result lines`;
}

export function summarizeGlob(text: string): string {
	const lines = text.split("\n").filter((l) => l.trim().length > 0);
	const dirMap = new Map<string, number>();

	for (const line of lines) {
		const parts = line.trim().split("/");
		const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
		dirMap.set(dir, (dirMap.get(dir) || 0) + 1);
	}

	const dirSummary = Array.from(dirMap.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([dir, count]) => `${dir}/ (${count})`)
		.join(", ");

	return `[cortex] Glob: ${lines.length} files across ${dirMap.size} directories. Top: ${dirSummary}`;
}

export function summarizeWebFetch(text: string, url: string): string {
	const lines = text.split("\n");
	const headings = lines
		.filter((l) => /^#{1,4}\s/.test(l))
		.map((l) => l.trim().substring(0, 80));
	const linkCount = (text.match(/\[.*?\]\(.*?\)/g) || []).length;
	const codeBlockCount = (text.match(/```/g) || []).length / 2;

	const parts = [`[cortex] WebFetch ${url}: ${lines.length} lines.`];
	if (headings.length > 0) {
		parts.push(`Outline: ${headings.slice(0, 8).join(" | ")}`);
	}
	if (linkCount > 0) parts.push(`${linkCount} links.`);
	if (codeBlockCount > 0)
		parts.push(`${Math.floor(codeBlockCount)} code blocks.`);

	return parts.join(" ");
}

export function summarizeWebSearch(text: string, query: string): string {
	const lines = text.split("\n");
	const titles: string[] = [];

	for (const line of lines) {
		const linkMatch = line.match(
			/^\s*(?:[-*\d.]+\s*)?\[(.+?)\]\(.*?\)/,
		);
		if (linkMatch?.[1]) {
			titles.push(linkMatch[1].substring(0, 80));
			continue;
		}
		const boldMatch = line.match(
			/^\s*(?:[-*\d.]+\s*)?\*\*(.+?)\*\*/,
		);
		if (boldMatch?.[1]) {
			titles.push(boldMatch[1].substring(0, 80));
			continue;
		}
		const headingMatch = line.match(/^#{1,3}\s+(.+)/);
		if (headingMatch?.[1]) {
			titles.push(headingMatch[1].substring(0, 80));
		}
	}

	if (titles.length > 0) {
		return `[cortex] WebSearch "${query}": ${titles.length} results. Top: ${titles.slice(0, 5).join(" | ")}`;
	}

	return `[cortex] WebSearch "${query}": ${lines.length} lines of results`;
}

// ─── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
	try {
		const chunks: Buffer[] = [];
		for await (const chunk of process.stdin) {
			chunks.push(chunk);
		}
		const raw = Buffer.concat(chunks).toString("utf-8");

		let input: HookInput;
		try {
			input = JSON.parse(raw);
		} catch {
			log("Failed to parse JSON input");
			process.exit(0);
			return;
		}

		const toolName = input.tool_name ?? "unknown";
		const text = extractText(input.tool_response);
		const tokens = estimateTokens(text);

		log(`Tool: ${toolName}, response tokens: ~${tokens}`);

		const sessionId = input.session_id || "unknown";
		const stats = loadSessionStats(sessionId);
		const threshold = getThreshold(toolName, stats);

		if (tokens < threshold) {
			log(`Under threshold (${threshold}), no summary needed`);
			process.exit(0);
			return;
		}

		let summary = "";

		switch (toolName) {
			case "Bash": {
				const command = String(input.tool_input?.["command"] ?? "");
				summary = summarizeBash(text, command);
				break;
			}
			case "Read": {
				const filePath = String(input.tool_input?.["file_path"] ?? "");
				summary = summarizeFileRead(text, filePath);
				break;
			}
			case "Grep": {
				const pattern = String(input.tool_input?.["pattern"] ?? "");
				summary = summarizeSearch(text, pattern);
				break;
			}
			case "Glob":
				summary = summarizeGlob(text);
				break;
			case "WebFetch": {
				const url = String(input.tool_input?.["url"] ?? "");
				summary = summarizeWebFetch(text, url);
				break;
			}
			case "WebSearch": {
				const query = String(input.tool_input?.["query"] ?? "");
				summary = summarizeWebSearch(text, query);
				break;
			}
			default: {
				const lineCount = text.split("\n").length;
				summary = `[cortex] ${toolName} output: ${lineCount} lines, ~${tokens} tokens`;
				break;
			}
		}

		if (summary) {
			const summaryTokens = estimateTokens(summary);
			const reduction =
				tokens > 0 ? ((tokens - summaryTokens) / tokens) * 100 : 0;

			const compressionLine = `[cortex] ${toolName} output: ${tokens}→${summaryTokens} tokens (${reduction.toFixed(0)}% reduction)`;

			stats.outputsCompressed += 1;
			stats.totalTokensBefore += tokens;
			stats.totalTokensAfter += summaryTokens;
			stats.lastUpdated = Date.now();

			if (!stats.perTool) stats.perTool = {};
			if (!stats.perTool[toolName]) {
				stats.perTool[toolName] = {
					compressed: 0,
					tokensBefore: 0,
					tokensAfter: 0,
				};
			}
			stats.perTool[toolName].compressed += 1;
			stats.perTool[toolName].tokensBefore += tokens;
			stats.perTool[toolName].tokensAfter += summaryTokens;

			// --- Cost tracking ---
			const model = resolveModel(detectModel());
			const pricing = MODEL_PRICING[model];
			if (!stats.cost) {
				stats.cost = {
					model,
					inputTokens: 0,
					outputTokens: 0,
					inputCost: 0,
					outputCost: 0,
					totalCost: 0,
				};
			}
			stats.cost.model = model;
			// Compressed output = input tokens Claude reads
			stats.cost.inputTokens += summaryTokens;
			if (pricing) {
				stats.cost.inputCost +=
					(summaryTokens / 1_000_000) * pricing.inputPerMillion;
				stats.cost.totalCost =
					stats.cost.inputCost + stats.cost.outputCost;
			}

			saveSessionStats(stats);

			log(`Summary: ${summary.substring(0, 100)}`);
			const fullContext = `${compressionLine}\n${summary}`;
			const output = JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PostToolUse",
					additionalContext: fullContext,
				},
			});
			process.stdout.write(output);
		}

		process.exit(0);
	} catch (error) {
		log(
			`Error: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(0);
	}
}

main();
