#!/usr/bin/env bash
# Install git hooks from scripts/ into .git/hooks/
set -euo pipefail
cp scripts/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
echo "Git hooks installed."
