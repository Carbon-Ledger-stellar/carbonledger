#!/usr/bin/env bash
# pre-commit hook: rustfmt --check over the contracts workspace.
# Formatting only (no compilation), so this stays fast regardless of cache state.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/contracts"
cargo fmt --all -- --check
