#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CRATE_DIR="$PROJECT_DIR/crates/cortex-engine"

source "$HOME/.cargo/env" 2>/dev/null || true

echo "Building cortex-engine native addon (release)..."
cd "$CRATE_DIR"

# Build with napi-rs
npx napi build --platform --release --strip

echo "Native addon built successfully."
ls -la "$CRATE_DIR"/*.node 2>/dev/null || echo "Warning: No .node file found"
