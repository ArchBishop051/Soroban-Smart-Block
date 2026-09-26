#!/usr/bin/env bash
set -euo pipefail

CONTRACT="${1:-soroban-explorer-contract}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASM_PATH="${ROOT_DIR}/target/wasm32-unknown-unknown/release/${CONTRACT}.wasm"
MANIFEST_PATH="${WASM_PATH}.build-manifest"

cargo build --locked --target wasm32-unknown-unknown --release -p "${CONTRACT}"

if [[ ! -f "${WASM_PATH}" ]]; then
  echo "WASM was not produced at ${WASM_PATH}" >&2
  exit 1
fi

cat > "${MANIFEST_PATH}" <<EOF
format= soroban-wasm-build-manifest-v1
contract=${CONTRACT}
git_commit=$(git -C "${ROOT_DIR}" rev-parse HEAD)
wasm_sha256=$(sha256sum "${WASM_PATH}" | awk '{print $1}')
cargo_lock_sha256=$(sha256sum "${ROOT_DIR}/Cargo.lock" | awk '{print $1}')
EOF
sed -i 's/^format= /format=/' "${MANIFEST_PATH}"
printf 'WASM: %s\nManifest: %s\n' "${WASM_PATH}" "${MANIFEST_PATH}"
cat "${MANIFEST_PATH}"
