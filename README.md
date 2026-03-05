# Cortex Lite

Lightweight context optimization for Claude Code, powered by a native Rust engine. Pure context compression — no CLI, no persistence, just fast hooks and a programmatic API.

## Why Lite?

| | cortex | cortex-lite | cortex-developer-edition |
|---|--------|-------------|--------------------------|
| Purpose | Code scanning (quality, security, compliance) | **Context compression** | Context optimization + code analysis |
| Token counting | JS | **Rust (tiktoken-rs)** | JS (gpt-tokenizer) |
| Runtime deps | 6 | **1 (zod)** | 14 |
| Persistence | None | In-memory | SQLite |
| CLI | 8 commands | None | 21 commands |
| Hooks | None | **Built-in** | Built-in |
| Daemon | None | **Built-in** | Built-in |

If you just want **fast context compression** for Claude Code with zero overhead, this is it.

## Install

```bash
npm install @sparn/cortex-lite
```

The package ships a prebuilt native addon for Linux x64. On unsupported platforms, it falls back to a pure JS implementation automatically.

## How It Works

Cortex Lite runs as Claude Code hooks — no CLI, no config files, no manual steps.

### Post-tool compression

After every tool call (Bash, Read, Grep, Glob, WebFetch), the hook checks the output size. If it's above threshold (2000-3000 tokens depending on tool type), it generates a content-aware summary:

- **Test results** — pass/fail counts, failing test names
- **TypeScript errors** — grouped by code (`TS2304(12), TS7006(3)`)
- **Lint output** — aggregated by rule
- **Git diffs** — changed file list
- **JSON** — structure summary (array length, keys)
- **Code files** — imports, exports, functions, types

Typical reduction: **60-90%** on verbose outputs.

Thresholds scale down adaptively as the session grows:

| Session size | Threshold multiplier |
|---|---|
| < 100K tokens | 1.0x |
| 100K-300K | 0.75x |
| 300K-500K | 0.5x |
| > 500K | 0.33x |

### Pre-prompt status

Before each prompt, a one-liner shows session health:

```
[cortex] Session: 45.2MB | 28 compressed (73% avg) | ~18.5K saved | $0.12 (sonnet) | Bash:8/4.2K Read:12/7.8K
```

When the session exceeds 2MB, it hints Claude to stay concise. Past 5MB, the hint gets stronger.

### Background daemon

A lightweight watcher monitors `.jsonl` session files in `~/.claude/projects/`. On changes, it incrementally reads new lines, ingests them into the optimization pipeline, and auto-prunes when the token count exceeds the threshold (default: 60K).

## Native Rust Engine

The core compute runs in Rust via [napi-rs](https://napi.rs). Everything hot is native:

```
tokenize    → tiktoken-rs (cl100k_base, exact Claude token counts)
hash        → SHA-256
score       → exponential decay + access bonus + recency boost
detect BTSP → compiled regex (errors, stack traces, conflicts)
prune       → TF-IDF × score × state priority, budget-constrained
consolidate → hash dedup + cosine similarity ≥ 0.85
```

### Scoring model

Each memory entry gets a score combining:

- **Time decay**: exponential fade over TTL (default 24h)
- **Access bonus**: `log(access_count + 1) × 0.1` — frequently referenced entries stay relevant
- **BTSP protection**: Errors/stack traces always score ≥ 0.9 — never pruned accidentally
- **Recency boost**: Entries < 30 min old get up to 1.3x multiplier

### Pruning strategy

Two-phase budget fitting:

1. **BTSP phase** — Include error/issue entries up to 80% of budget (chronological order)
2. **Regular phase** — Rank remaining by `TF-IDF × score × state_multiplier`, greedily fit to budget

State multipliers: BTSP/active = 2.0, ready = 1.0, silent = 0.5.

## Programmatic API

```typescript
import { createPipeline, createNativeEngine } from '@sparn/cortex-lite';

// High-level: ingest context, auto-optimize
const pipeline = createPipeline({ tokenBudget: 40000 });
const result = pipeline.ingest(sessionTranscript, 'claude-code');
console.log(`${result.originalTokens} → ${result.prunedTokens} tokens`);

// Low-level: direct engine access
const engine = createNativeEngine();
engine.countTokens('Hello world');           // 2
engine.countTokensBatch(['a', 'b', 'c']);    // [1, 1, 1]
engine.detectBtsp('Error: ENOENT');          // true
engine.hashContent('data');                  // sha256 hex
```

### Pipeline

```typescript
interface Pipeline {
  ingest(context: string, format?: 'claude-code' | 'generic'): PruneResult;
  optimize(budget?: number): PruneResult;
  consolidate(): ConsolidateResult;
  getEntries(): MemoryEntry[];
  getTokenCount(): number;
  getStats(): PipelineStats;
  clear(): void;
}
```

### Engine

```typescript
interface NativeEngine {
  optimize(entries: MemoryEntry[], budget?: number): PruneResult;
  consolidate(entries: MemoryEntry[]): ConsolidateResult;
  countTokens(text: string): number;
  countTokensBatch(texts: string[]): number[];
  detectBtsp(content: string): boolean;
  hashContent(content: string): string;
  calculateScore(entry: MemoryEntry, currentTime?: number): number;
  classifyState(score: number, isBtsp: boolean): string;
  reset(): void;
  getStats(): EngineStats;
}
```

## Configuration

Pass config to `createPipeline()` or `createNativeEngine()`. All fields optional with sane defaults:

```typescript
createPipeline({
  tokenBudget: 40000,           // Max tokens to keep (1K-200K)
  defaultTTL: 24,               // Hours before full decay
  decayThreshold: 0.95,         // Decay level that triggers removal
  activeThreshold: 0.7,         // Score above = "active" state
  readyThreshold: 0.3,          // Score above = "ready" state
  recencyBoostMinutes: 30,      // Window for recency bonus
  recencyBoostMultiplier: 1.3,  // Max boost factor
  autoOptimizeThreshold: 60000, // Auto-prune above this token count
  debounceMs: 5000,             // Daemon file watch debounce
});
```

## See Also

| Package | What it does |
|---|---|
| [`@sparn/cortex`](https://github.com/sparn-labs/cortex) | Simple code scanning CLI — quality, security, and compliance checks with zero setup |
| [`@sparn/cortex-developer-edition`](https://github.com/sparn-labs/cortex-developer-edition) | Full context optimization + code analysis for AI coding agents (21 CLI commands, MCP server, dependency graphs, search) |

## Development

```bash
# Prerequisites: Rust toolchain (cargo, napi-rs)
git clone https://github.com/sparn-labs/cortex-lite.git
cd cortex-lite
npm install
npm run build:native    # Compile Rust → .node addon
npm run build:ts        # Compile TypeScript → dist/
npm run build           # Both
npm test
npm run lint
```

## License

MIT
