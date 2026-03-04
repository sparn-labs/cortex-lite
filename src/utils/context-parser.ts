/**
 * Context Parser - Parses agent contexts into memory entries.
 * Copied from @sparn/cortex with native engine integration.
 */

import { randomUUID } from "node:crypto";
import type { BlockType, MemoryEntry } from "../types.js";

/**
 * Hash content using the native engine or fallback to crypto.
 */
function hashContent(content: string): string {
	const { createHash } = require("node:crypto");
	return createHash("sha256").update(content).digest("hex");
}

export function parseClaudeCodeContext(context: string): MemoryEntry[] {
	const firstNonEmpty = context.split("\n").find((line) => line.trim().length > 0);
	if (firstNonEmpty?.trim().startsWith("{")) {
		const jsonlEntries = parseJSONLContext(context);
		if (jsonlEntries.length > 0) return jsonlEntries;
	}

	const entries: MemoryEntry[] = [];
	const now = Date.now();
	const lines = context.split("\n");
	let currentBlock: string[] = [];
	let blockType: BlockType = "other";

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed.startsWith("User:") || trimmed.startsWith("Assistant:")) {
			if (currentBlock.length > 0) {
				entries.push(createEntry(currentBlock.join("\n"), blockType, now));
				currentBlock = [];
			}
			blockType = "conversation";
			currentBlock.push(line);
		} else if (
			trimmed.includes("<function_calls>") ||
			trimmed.includes("<invoke>") ||
			trimmed.includes("<tool_use>")
		) {
			if (currentBlock.length > 0) {
				entries.push(createEntry(currentBlock.join("\n"), blockType, now));
				currentBlock = [];
			}
			blockType = "tool";
			currentBlock.push(line);
		} else if (
			trimmed.includes("<function_results>") ||
			trimmed.includes("</function_results>")
		) {
			if (currentBlock.length > 0 && blockType !== "result") {
				entries.push(createEntry(currentBlock.join("\n"), blockType, now));
				currentBlock = [];
			}
			blockType = "result";
			currentBlock.push(line);
		} else if (currentBlock.length > 0) {
			currentBlock.push(line);
		} else if (trimmed.length > 0) {
			currentBlock.push(line);
			blockType = "other";
		}
	}

	if (currentBlock.length > 0) {
		entries.push(createEntry(currentBlock.join("\n"), blockType, now));
	}

	return entries.filter((e) => e.content.trim().length > 0);
}

export function createEntry(
	content: string,
	type: BlockType,
	baseTime: number,
): MemoryEntry {
	const tags: string[] = [type];

	let initialScore = 0.5;
	if (type === "conversation") initialScore = 0.8;
	if (type === "tool") initialScore = 0.7;
	if (type === "result") initialScore = 0.4;

	return {
		id: randomUUID(),
		content,
		hash: hashContent(content),
		timestamp: baseTime,
		score: initialScore,
		state: initialScore >= 0.7 ? "active" : initialScore >= 0.3 ? "ready" : "silent",
		ttl: 24 * 3600,
		accessCount: 0,
		tags,
		isBTSP: false,
	};
}

export interface JSONLMessage {
	role?: string;
	content?:
		| string
		| Array<{
				type: string;
				text?: string;
				name?: string;
				input?: unknown;
				content?: string | Array<{ type: string; text?: string }>;
			}>;
	type?: string;
	tool_use?: { name: string; input: unknown };
	tool_result?: { content: string | Array<{ type: string; text?: string }> };
}

export function parseJSONLLine(line: string): JSONLMessage | null {
	const trimmed = line.trim();
	if (trimmed.length === 0) return null;
	try {
		return JSON.parse(trimmed) as JSONLMessage;
	} catch {
		return null;
	}
}

function extractContent(content: JSONLMessage["content"]): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((block) => {
				if (block.type === "text" && block.text) return block.text;
				if (block.type === "tool_use" && block.name)
					return `[tool_use: ${block.name}]`;
				if (block.type === "tool_result") {
					if (typeof block.content === "string") return block.content;
					if (Array.isArray(block.content)) {
						return block.content
							.filter((c) => c.type === "text" && c.text)
							.map((c) => c.text)
							.join("\n");
					}
				}
				return "";
			})
			.filter((s) => s.length > 0)
			.join("\n");
	}
	return "";
}

function classifyJSONLMessage(msg: JSONLMessage): BlockType {
	if (Array.isArray(msg.content)) {
		const hasToolUse = msg.content.some((b) => b.type === "tool_use");
		const hasToolResult = msg.content.some((b) => b.type === "tool_result");
		if (hasToolUse) return "tool";
		if (hasToolResult) return "result";
	}
	if (msg.type === "tool_use" || msg.tool_use) return "tool";
	if (msg.type === "tool_result" || msg.tool_result) return "result";
	if (msg.role === "user" || msg.role === "assistant") return "conversation";
	return "other";
}

export function parseJSONLContext(context: string): MemoryEntry[] {
	const entries: MemoryEntry[] = [];
	const now = Date.now();
	const lines = context.split("\n");

	for (const line of lines) {
		const msg = parseJSONLLine(line);
		if (!msg) continue;

		const content = extractContent(msg.content);
		if (!content || content.trim().length === 0) continue;

		const blockType = classifyJSONLMessage(msg);
		entries.push(createEntry(content, blockType, now));
	}

	return entries;
}

export function parseGenericContext(context: string): MemoryEntry[] {
	const entries: MemoryEntry[] = [];
	const now = Date.now();
	const blocks = context.split(/\n\n+/);

	for (const block of blocks) {
		const trimmed = block.trim();
		if (trimmed.length === 0) continue;
		entries.push(createEntry(trimmed, "other", now));
	}

	return entries;
}
