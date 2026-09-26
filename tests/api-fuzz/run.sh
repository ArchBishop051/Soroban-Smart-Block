#!/usr/bin/env bash
# API contract testing + fuzzing against docs/api/openapi.yaml (#907).
#
#   tests/api-fuzz/run.sh fast   # PRs: few examples per operation, read APIs
#   tests/api-fuzz/run.sh deep   # nightly: many examples + stateful (OpenAPI links)
#
# Expects a seeded indexer at $API_BASE_URL started with
# OPENAPI_VALIDATE_RESPONSES=true (spec mismatches become 500s) and
# RATE_LIMITING_DISABLED=true (fuzz run only). Keys per scope:
#   FUZZ_API_KEY    regular key for authenticated read/write operations
#   FUZZ_ADMIN_KEY  admin key; /api/admin/* is only fuzzed when it is set
set -euo pipefail

PROFILE="${1:-fast}"
BASE_URL="${API_BASE_URL:-http://localhost:3001}"
SPEC="${SPEC_PATH:-docs/api/openapi.yaml}"
OUT="${FUZZ_REPORT_DIR:-tests/api-fuzz/reports}"
mkdir -p "$OUT"

case "$PROFILE" in
  fast) EXAMPLES=10; EXTRA=(--include-method GET) ;;
  deep) EXAMPLES=200; EXTRA=(--stateful=links) ;;
  *) echo "unknown profile: $PROFILE (fast|deep)" >&2; exit 2 ;;
esac

COMMON=(
  "$SPEC" --base-url "$BASE_URL"
  --checks all
  --hypothesis-max-examples "$EXAMPLES"
  --hypothesis-deadline 30000
  --hypothesis-derandomize
  --hypothesis-suppress-health-check=all
  # Long-lived streams cannot be fuzzed request/response style.
  --exclude-path-regex '/stream$'
)

AUTH=()
[ -n "${FUZZ_API_KEY:-}" ] && AUTH=(-H "X-API-Key: ${FUZZ_API_KEY}")

echo "── Public + key-scoped operations ($PROFILE)"
schemathesis run "${COMMON[@]}" "${EXTRA[@]}" "${AUTH[@]}" \
  --exclude-path-regex '^/api/admin' \
  --junit-xml "$OUT/api-$PROFILE.xml"

if [ -n "${FUZZ_ADMIN_KEY:-}" ]; then
  echo "── Admin operations ($PROFILE)"
  schemathesis run "${COMMON[@]}" "${EXTRA[@]}" \
    -H "X-API-Key: ${FUZZ_ADMIN_KEY}" \
    --include-path-regex '^/api/admin' \
    --junit-xml "$OUT/admin-$PROFILE.xml"
fi
