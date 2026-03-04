#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "Building native addon..."
bash scripts/build-native.sh

echo "Building TypeScript..."
npx tsup

echo "Running tests..."
npx vitest run

echo "Publishing to private registry..."
npm publish --registry https://repository.sparn.dev

echo "Published successfully!"
