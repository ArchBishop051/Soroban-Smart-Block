#!/usr/bin/env bash
# Build the in-browser Soroban host (#925) and emit wasm-bindgen JS glue.
#   ./build.sh          → frontend/public/sandbox-host (served at /sandbox-host/)
#   ./build.sh nodejs   → parity/pkg (for the parity test)
# Requires: rustup target wasm32-unknown-unknown, wasm-bindgen-cli 0.2.129.
set -euo pipefail
cd "$(dirname "$0")"

TARGET="${1:-web}"
# Download size budget for the raw .wasm (gzip is ~1/3 of this).
MAX_WASM_BYTES="${MAX_WASM_BYTES:-3145728}" # 3 MiB

cargo build --release --target wasm32-unknown-unknown
WASM=target/wasm32-unknown-unknown/release/soroban_sandbox_host.wasm

if [ "$TARGET" = "nodejs" ]; then
  OUT=parity/pkg
else
  OUT=../../frontend/public/sandbox-host
fi
wasm-bindgen --target "$TARGET" --out-dir "$OUT" "$WASM"
# The nodejs glue is CommonJS; mark it so under the repo's "type": "module".
[ "$TARGET" = "nodejs" ] && echo '{ "type": "commonjs" }' > "$OUT/package.json"

SIZE=$(wc -c < "$OUT/soroban_sandbox_host_bg.wasm")
echo "sandbox-host wasm: $SIZE bytes (budget $MAX_WASM_BYTES)"
if [ "$SIZE" -gt "$MAX_WASM_BYTES" ]; then
  echo "error: sandbox-host wasm exceeds the download size budget" >&2
  exit 1
fi
