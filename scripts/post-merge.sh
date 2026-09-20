#!/usr/bin/env bash
set -euo pipefail

# Replit normally preserves installed dependencies across task merges.
# Avoid downloading the full lockfile on every merge; the package firewall may
# reject an unrelated legacy transitive dependency even when it is already
# installed and the merge introduced no dependency changes.
if [[ ! -d node_modules ]]; then
  npm ci --no-audit --no-fund
fi

if [[ ! -d frontend/node_modules ]]; then
  npm --prefix frontend ci --no-audit --no-fund
fi

# Compile both server and client so merge errors fail early.
npm run build