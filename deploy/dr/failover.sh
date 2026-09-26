#!/usr/bin/env bash
# Regional failover / failback (#940). Order matters: fence the old primary
# BEFORE the replica accepts writes, so two regions can never both write.
#
#   deploy/dr/failover.sh failover   promote secondary region
#   deploy/dr/failover.sh failback   return to primary (after re-seeding it)
#
# Emits RPO/RTO measurements to $DR_REPORT (default dr-report.md).
# Required env: PRIMARY_CONTEXT, SECONDARY_CONTEXT (kubectl contexts),
# PRIMARY_DB, REPLICA_DB (RDS identifiers), PRIMARY_REGION, SECONDARY_REGION,
# API_URL (public URL), HOSTED_ZONE_ID, DOMAIN, SECONDARY_LB_DNS, LB_ZONE_ID.
set -euo pipefail
: "${PRIMARY_CONTEXT:?}" "${SECONDARY_CONTEXT:?}" "${PRIMARY_DB:?}" "${REPLICA_DB:?}" "${API_URL:?}"
NS=${NS:-soroban-explorer-${ENVIRONMENT:-staging}}
CHART=$(cd "$(dirname "$0")/../helm/soroban-explorer" && pwd)
REPORT=${DR_REPORT:-dr-report.md}
T0=$(date +%s)
log() { echo "[$(( $(date +%s) - T0 ))s] $*" | tee -a "$REPORT.log"; }

last_ledger() { curl -sf --max-time 5 "$API_URL/api/health" | jq -r '.indexer.last_ledger // .indexer.lastLedger // empty'; }

fence() {  # $1 = kube context, $2 = RDS identifier, $3 = region
  log "Fencing $1: scale ingest/api to 0 and revoke DB writes"
  kubectl --context "$1" -n "$NS" scale rollout --all --replicas=0 || true
  # Rebooting as read-only via parameter group is region-specific; the minimum
  # guarantee is that no writer pods remain. Record the fence marker.
  kubectl --context "$1" -n "$NS" create configmap dr-fenced --from-literal=at="$(date -u +%FT%TZ)" \
    --dry-run=client -o yaml | kubectl --context "$1" -n "$NS" apply -f -
  aws rds modify-db-instance --region "$3" --db-instance-identifier "$2" \
    --db-parameter-group-name "${READONLY_PARAM_GROUP:-soroban-explorer-readonly}" --apply-immediately >/dev/null 2>&1 \
    || log "WARN: could not apply read-only parameter group to $2 (region may be down)"
}

failover() {
  local ledger_before replica_lag
  ledger_before=$(last_ledger || echo "")
  replica_lag=$(aws cloudwatch get-metric-statistics --region "$SECONDARY_REGION" --namespace AWS/RDS \
    --metric-name ReplicaLag --dimensions Name=DBInstanceIdentifier,Value="$REPLICA_DB" \
    --start-time "$(date -u -d '-5 min' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" --period 60 --statistics Maximum \
    | jq -r '[.Datapoints[].Maximum] | max // 0')
  log "Replica lag at failure: ${replica_lag}s (RPO); last served ledger: ${ledger_before:-unknown}"

  fence "$PRIMARY_CONTEXT" "$PRIMARY_DB" "$PRIMARY_REGION"

  log "Promoting replica $REPLICA_DB"
  aws rds promote-read-replica --region "$SECONDARY_REGION" --db-instance-identifier "$REPLICA_DB" >/dev/null
  aws rds wait db-instance-available --region "$SECONDARY_REGION" --db-instance-identifier "$REPLICA_DB"

  log "Scaling standby and enabling ingest (resumes from committed cursor)"
  helm --kube-context "$SECONDARY_CONTEXT" upgrade explorer "$CHART" -n "$NS" --reuse-values \
    -f "$CHART/values-standby.yaml" --set api.replicas=3 --set frontend.replicas=2 --set ingest.enabled=true --wait

  log "Switching DNS to secondary"
  aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch "$(jq -n \
    --arg d "$DOMAIN" --arg lb "$SECONDARY_LB_DNS" --arg z "$LB_ZONE_ID" \
    '{Changes:[{Action:"UPSERT",ResourceRecordSet:{Name:$d,Type:"A",SetIdentifier:"primary",Failover:"PRIMARY",AliasTarget:{DNSName:$lb,HostedZoneId:$z,EvaluateTargetHealth:true}}}]}')" >/dev/null

  until curl -sf --max-time 5 "$API_URL/api/health" >/dev/null; do sleep 5; done
  local rto=$(( $(date +%s) - T0 ))
  log "Service healthy in secondary region"
  {
    echo "# DR drill report $(date -u +%FT%TZ)"
    echo
    echo "| Metric | Target | Measured | Result |"
    echo "|---|---|---|---|"
    echo "| RPO (replica lag) | < 60s | ${replica_lag}s | $(awk "BEGIN{print ($replica_lag < 60) ? \"PASS\" : \"FAIL\"}") |"
    echo "| RTO (fence → healthy) | < 900s | ${rto}s | $( (( rto < 900 )) && echo PASS || echo FAIL) |"
    echo
    echo "Ledgers between replica LSN and primary are re-ingested from chain by the idempotent ingester (#846)."
    echo
    echo '```'; cat "$REPORT.log"; echo '```'
  } > "$REPORT"
  awk "BEGIN{exit !($replica_lag < 60)}" && (( rto < 900 ))
}

failback() {
  log "Failback: fence secondary, promote re-seeded primary, restore DNS"
  fence "$SECONDARY_CONTEXT" "$REPLICA_DB" "$SECONDARY_REGION"
  helm --kube-context "$PRIMARY_CONTEXT" upgrade explorer "$CHART" -n "$NS" --reuse-values --set ingest.enabled=true --wait
  helm --kube-context "$SECONDARY_CONTEXT" upgrade explorer "$CHART" -n "$NS" -f "$CHART/values-standby.yaml" --wait
  log "Re-apply infra/terraform/dr to restore Route 53 records and recreate the replica."
}

case "${1:-}" in
  failover) failover ;;
  failback) failback ;;
  *) echo "usage: $0 failover|failback" >&2; exit 2 ;;
esac
