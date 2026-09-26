#!/usr/bin/env bash
# pre-commit hook: eslint over frontend/. Uses --no-install so a missing
# `npm install` fails fast with a clear message instead of npx silently
# reaching out to the network.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/frontend"
if [ ! -d node_modules/.bin ]; then
  echo "frontend/node_modules is missing — run 'npm install' in frontend/ first." >&2
  exit 1
fi
npx --no-install eslint --max-warnings=0 .
