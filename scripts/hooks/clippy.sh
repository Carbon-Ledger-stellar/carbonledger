#!/usr/bin/env bash
# pre-commit hook: cargo clippy over the contracts workspace.
#
# This compiles the workspace, so it's the slowest hook in the suite. It
# relies on cargo's incremental build cache (contracts/target/) to stay
# within the ~30s budget on a "typical changed file set" — a cold cache
# (first run, or after `cargo clean`) will be much slower. See
# docs/development-guidelines.md for that caveat.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/contracts"
cargo clippy --workspace --all-targets -- -D warnings
