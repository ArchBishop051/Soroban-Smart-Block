// Per-ledger network metrics (#921): Soroban tx count, TPS, close time,
// inclusion-fee percentiles, resource utilization vs. per-ledger limits and a
// surge flag. Limits come from each ledger's config settings, never constants.

export const RANGES = { "1h": 3600, "24h": 86400, "7d": 604800 };

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function ratio(used, limit) {
  return limit > 0 ? Math.min(1, used / limit) : null;
}

// ledger: { sequence, closed_at, prev_closed_at, txs: [{ inclusion_fee, instructions,
// read_bytes, write_bytes }], limits: { tx_count, instructions, read_bytes, write_bytes } }
export function computeLedgerMetrics(ledger) {
  const txs = ledger.txs || [];
  const limits = ledger.limits || {};
  const fees = txs.map((t) => Number(t.inclusion_fee) || 0).sort((a, b) => a - b);
  const sum = (k) => txs.reduce((acc, t) => acc + (Number(t[k]) || 0), 0);
  const closeTime = ledger.prev_closed_at
    ? (new Date(ledger.closed_at) - new Date(ledger.prev_closed_at)) / 1000
    : null;
  const utilization = {
    tx_count: ratio(txs.length, limits.tx_count),
    instructions: ratio(sum("instructions"), limits.instructions),
    read_bytes: ratio(sum("read_bytes"), limits.read_bytes),
    write_bytes: ratio(sum("write_bytes"), limits.write_bytes),
  };
  const maxUtil = Math.max(0, ...Object.values(utilization).filter((v) => v !== null));
  return {
    ledger: ledger.sequence,
    closed_at: ledger.closed_at,
    tx_count: txs.length,
    close_time: closeTime,
    tps: closeTime > 0 ? txs.length / closeTime : null,
    fees: { p10: percentile(fees, 10), p50: percentile(fees, 50), p90: percentile(fees, 90), p99: percentile(fees, 99) },
    utilization,
    surge: maxUtil >= 0.9,
  };
}

// Recommended inclusion fee: p90 of recent ledgers' p50 values (p90 during surge).
export function recommendFee(metrics) {
  if (!metrics.length) return null;
  const surge = metrics.some((m) => m.surge);
  const key = surge ? "p90" : "p50";
  const vals = metrics.map((m) => m.fees[key]).filter((v) => v !== null).sort((a, b) => a - b);
  return { fee: percentile(vals, 90), surge };
}

// Staleness: seconds between now and the newest indexed ledger close.
export function staleness(metrics, now = Date.now()) {
  if (!metrics.length) return null;
  return Math.max(0, (now - new Date(metrics[metrics.length - 1].closed_at)) / 1000);
}

export async function getNetworkMetrics(pool, range = "1h") {
  const secs = RANGES[range] ?? RANGES["1h"];
  const { rows } = await pool.query(
    `SELECT t.ledger AS sequence, MAX(t.created_at) AS closed_at,
            json_agg(json_build_object('inclusion_fee', t.inclusion_fee,
              'read_bytes', t.footprint_read_bytes, 'write_bytes', t.footprint_write_bytes)) AS txs,
            (SELECT c.limits FROM ledger_config_settings c WHERE c.ledger <= t.ledger
              ORDER BY c.ledger DESC LIMIT 1) AS limits
       FROM transactions t
      WHERE t.created_at >= NOW() - ($1 || ' seconds')::interval
      GROUP BY t.ledger ORDER BY t.ledger ASC`,
    [String(secs)],
  );
  const metrics = rows.map((r, i) => computeLedgerMetrics({ ...r, prev_closed_at: rows[i - 1]?.closed_at }));
  return { range, metrics, recommended: recommendFee(metrics.slice(-50)), staleness_seconds: staleness(metrics) };
}
