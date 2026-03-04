/**
 * File Tracker - Incremental file reading with byte position tracking.
 * Copied from @sparn/cortex (no changes needed).
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";

export interface FilePosition {
	path: string;
	position: number;
	partialLine: string;
	lastModified: number;
	lastSize: number;
}

export interface FileTracker {
	readNewLines(filePath: string): string[];
	getPosition(filePath: string): FilePosition | null;
	resetPosition(filePath: string): void;
	clearAll(): void;
	getTrackedFiles(): string[];
}

export function createFileTracker(): FileTracker {
	const positions = new Map<string, FilePosition>();

	function readNewLines(filePath: string): string[] {
		try {
			const stats = statSync(filePath);
			const currentSize = stats.size;
			const currentModified = stats.mtimeMs;

			let pos = positions.get(filePath);

			if (!pos) {
				pos = {
					path: filePath,
					position: 0,
					partialLine: "",
					lastModified: currentModified,
					lastSize: 0,
				};
				positions.set(filePath, pos);
			}

			if (currentSize < pos.lastSize || currentSize === pos.position) {
				if (currentSize < pos.lastSize) {
					pos.position = 0;
					pos.partialLine = "";
				}
				return [];
			}

			const bytesToRead = currentSize - pos.position;
			const buffer = Buffer.alloc(bytesToRead);
			const fd = openSync(filePath, "r");
			try {
				readSync(fd, buffer, 0, bytesToRead, pos.position);
			} finally {
				closeSync(fd);
			}

			const newContent = (pos.partialLine + buffer.toString("utf-8")).split("\n");
			const partialLine = newContent.pop() || "";

			pos.position = currentSize;
			pos.partialLine = partialLine;
			pos.lastModified = currentModified;
			pos.lastSize = currentSize;

			return newContent.filter((line) => line.trim().length > 0);
		} catch {
			return [];
		}
	}

	function getPosition(filePath: string): FilePosition | null {
		return positions.get(filePath) || null;
	}

	function resetPosition(filePath: string): void {
		positions.delete(filePath);
	}

	function clearAll(): void {
		positions.clear();
	}

	function getTrackedFiles(): string[] {
		return Array.from(positions.keys());
	}

	return {
		readNewLines,
		getPosition,
		resetPosition,
		clearAll,
		getTrackedFiles,
	};
}
