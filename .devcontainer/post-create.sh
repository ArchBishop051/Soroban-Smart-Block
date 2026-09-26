#!/usr/bin/env bash
# Runs once after the dev container is created. Every step is non-fatal so a
# flaky network or a single failing install never leaves the codespace in
# recovery mode; failures are summarised at the end instead.
set -u
cd "$(dirname "$0")/.."

failed=()
step() {
  local name="$1"; shift
  echo "▶ $name"
  if ! "$@"; then
    echo "✖ $name failed"
    failed+=("$name")
  fi
}

[ -f .env ] || cp .env.example .env

step "npm ci (root)"     npm ci --prefer-offline --no-audit --no-fund
step "npm ci (indexer)"  npm ci --prefer-offline --no-audit --no-fund --prefix indexer
step "npm ci (frontend)" npm ci --prefer-offline --no-audit --no-fund --prefix frontend
step "cargo fetch"       cargo fetch

if [ ${#failed[@]} -gt 0 ]; then
  echo "⚠ Setup finished with failures: ${failed[*]} — re-run .devcontainer/post-create.sh"
else
  echo "✅ Setup complete. Run: make dev"
fi
