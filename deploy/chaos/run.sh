#!/usr/bin/env bash
# Runs the staging chaos suite (#939) one experiment at a time and checks each
# steady-state hypothesis from hypotheses.json. Writes a Markdown report to
# $REPORT (default chaos-report.md); exits non-zero if any hypothesis fails.
#
#   deploy/chaos/run.sh            run all experiments
#   deploy/chaos/run.sh <name>     run one experiment
#   deploy/chaos/run.sh abort      delete every running experiment (abort switch)
set -euo pipefail

NS=soroban-explorer-staging
DIR=$(cd "$(dirname "$0")" && pwd)
API=${API_URL:?API_URL must point at the staging API}
PROM=${PROM_URL:-http://prometheus.monitoring:9090}
REPORT=${REPORT:-chaos-report.md}
LOCK=chaos-lock    # ConfigMap: presence blocks deploys; a running rollout blocks chaos

[[ $(kubectl config view --minify -o jsonpath='{..namespace}') == "$NS" ]] || kubectl config set-context --current --namespace "$NS" >/dev/null

abort() {
  kubectl delete -f "$DIR/experiments.yaml" --ignore-not-found --wait=false
  kubectl delete configmap "$LOCK" -n "$NS" --ignore-not-found
}
[[ ${1:-} == abort ]] && { abort; exit 0; }
trap abort EXIT INT TERM

# Scheduling lock: never overlap with a deploy.
if kubectl argo rollouts list rollouts -n "$NS" 2>/dev/null | grep -qE 'Progressing|Paused'; then
  echo "A rollout is in progress in $NS; skipping chaos run." | tee "$REPORT"; trap - EXIT; exit 0
fi
kubectl create configmap "$LOCK" -n "$NS" --from-literal=owner="${GITHUB_RUN_ID:-local}"

h() { jq -r --arg e "$1" --arg k "$2" '.experiments[$e][$k] // .defaults[$k] // empty' "$DIR/hypotheses.json"; }
lag() { curl -sf "$API/api/health" | jq -r '.indexer.ledger_lag // 0'; }
gaps() { curl -sf "$API/api/gaps" | jq -r '.open // .unresolved // 0'; }
errors_5xx() { curl -sf "$PROM/api/v1/query" --data-urlencode "query=sum(increase(http_requests_total{namespace=\"$NS\",status=~\"5..\"}[$1s]))/clamp_min(sum(increase(http_requests_total{namespace=\"$NS\"}[$1s])),1)*100" | jq -r '.data.result[0].value[1] // 0'; }

run_one() {
  local name=$1 start wait recover maxlag budget ok=PASS notes=()
  wait=$(h "$name" waitSeconds); wait=${wait:-$(h "$name" settleSeconds)}
  recover=$(h "$name" recoverSeconds); maxlag=$(h "$name" maxLagLedgers); budget=$(h "$name" maxErrorBudgetPct)
  local gaps_before; gaps_before=$(gaps)
  start=$(date +%s)
  [[ $(h "$name" load) == true ]] && { k6 run -q --duration "${wait}s" "$DIR/../../e2e/test/load/baseline.js" >/dev/null 2>&1 & }
  yq "select(.metadata.name == \"$name\")" "$DIR/experiments.yaml" | kubectl apply -f -
  sleep "$wait"
  yq "select(.metadata.name == \"$name\")" "$DIR/experiments.yaml" | kubectl delete -f - --ignore-not-found
  wait || true

  # Hypothesis 1: ingest lag recovers within recoverSeconds.
  local deadline=$(( $(date +%s) + recover )) l
  until l=$(lag 2>/dev/null) && (( l <= maxlag )); do
    (( $(date +%s) > deadline )) && { ok=FAIL; notes+=("lag ${l:-?} > $maxlag after ${recover}s"); break; }
    sleep 10
  done
  # Hypothesis 2: no data loss — reconciliation finds no new unresolved gaps.
  local g; g=$(gaps)
  (( g > gaps_before )) && { ok=FAIL; notes+=("unresolved gaps grew $gaps_before -> $g"); }
  # Hypothesis 3: 5xx impact within the error budget allowance.
  local e; e=$(errors_5xx $(( $(date +%s) - start )))
  awk "BEGIN{exit !($e > $budget)}" && { ok=FAIL; notes+=("5xx ${e}% > ${budget}%"); }

  echo "| $name | $ok | $(( $(date +%s) - start ))s | ${notes[*]:-} |" >> "$REPORT"
  [[ $ok == PASS ]]
}

echo -e "# Chaos report $(date -u +%FT%TZ)\n\n| Experiment | Result | Duration | Notes |\n|---|---|---|---|" > "$REPORT"
failed=0
names=${1:-$(yq -N '.metadata.name' "$DIR/experiments.yaml")}
for n in $names; do run_one "$n" || failed=1; done
exit $failed
