/**
 * Data lineage (#945).
 *
 * Every ingest batch (live poll, backfill, replay, re-decode, reconcile) gets
 * one `lineage_batches` row recording where the data came from and which code
 * produced it. Events reference the batch that first wrote them via
 * `events.lineage_batch_id`; later writes append `lineage_events` rows instead
 * of overwriting, so the full chain for any event can be reconstructed.
 */
import { randomUUID } from "node:crypto";
import { trace } from "@opentelemetry/api";
import { pool } from "./db.js";
import { logger } from "./logger.js";

export const RUN_TYPES = ["live", "backfill", "replay", "redecode", "reconcile"];
export const CODE_VERSION = process.env.GIT_SHA || process.env.SOURCE_COMMIT || "unknown";
export const DECODER_VERSIONS = { decoder: process.env.npm_package_version || "unknown" };

/** Hide credentials embedded in a provider URL before it is persisted or served. */
export function redactSource(source) {
  try {
    const url = new URL(source);
    url.username = "";
    url.password = "";
    url.search = "";
    return url.toString();
  } catch {
    return String(source ?? "unknown");
  }
}

/**
 * Create a lineage batch and tag the active span with its ID.
 * @returns {Promise<{ id: number, runId: string }>}
 */
export async function startLineageBatch(
  { runType, runId = randomUUID(), source, ledgerFrom = null, ledgerTo = null },
  query = (...args) => pool.query(...args),
) {
  if (!RUN_TYPES.includes(runType)) throw new Error(`unknown lineage run type: ${runType}`);
  const { rows } = await query(
    `INSERT INTO lineage_batches (run_type, run_id, source, ledger_from, ledger_to, code_version, decoder_versions)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [runType, runId, redactSource(source), ledgerFrom, ledgerTo, CODE_VERSION, JSON.stringify(DECODER_VERSIONS)],
  );
  const id = Number(rows[0].id);
  trace.getActiveSpan()?.setAttribute("lineage.id", id);
  logger.info(`[lineage] batch ${id} started (${runType} run ${runId}, ledgers ${ledgerFrom ?? "?"}-${ledgerTo ?? "?"})`);
  return { id, runId };
}

/** Append a lineage event (re-decode, reconcile, ...) for an existing row. */
export async function recordLineageEvent(eventSeq, batchId, action, detail = {}, query = (...args) => pool.query(...args)) {
  await query(
    `INSERT INTO lineage_events (event_seq, batch_id, action, detail) VALUES ($1, $2, $3, $4)`,
    [eventSeq, batchId, action, JSON.stringify(detail)],
  );
  logger.info(`[lineage] batch ${batchId} ${action} event ${eventSeq}`);
}

function formatBatch(row, { full }) {
  const batch = {
    lineage_id: Number(row.id),
    run_type: row.run_type,
    code_version: row.code_version,
    decoder_versions: row.decoder_versions,
    created_at: row.created_at,
  };
  if (!full) return batch;
  return {
    ...batch,
    run_id: row.run_id,
    source: row.source,
    ledger_range: [row.ledger_from == null ? null : Number(row.ledger_from), row.ledger_to == null ? null : Number(row.ledger_to)],
  };
}

/**
 * Full provenance chain for an event: the origin batch followed by every
 * appended lineage event, oldest first. `full: false` omits run IDs, provider
 * sources and ledger ranges for the public summary.
 * @returns {Promise<object|null>} null when the event does not exist
 */
export async function getEventLineage(eventSeq, { full = false } = {}, query = (...args) => pool.query(...args)) {
  const { rows: events } = await query(
    `SELECT e.seq, e.lineage_batch_id, b.*
     FROM events e LEFT JOIN lineage_batches b ON b.id = e.lineage_batch_id
     WHERE e.seq = $1`,
    [eventSeq],
  );
  if (!events.length) return null;
  const origin = events[0];

  const { rows: history } = await query(
    `SELECT le.action, le.detail, le.created_at AS event_created_at, b.*
     FROM lineage_events le JOIN lineage_batches b ON b.id = le.batch_id
     WHERE le.event_seq = $1
     ORDER BY le.id ASC`,
    [eventSeq],
  );

  const chain = [
    origin.lineage_batch_id == null
      ? { action: "ingest", lineage: "legacy" }
      : { action: "ingest", ...formatBatch(origin, { full }) },
    ...history.map((row) => ({
      action: row.action,
      ...formatBatch(row, { full }),
      ...(full ? { detail: row.detail } : {}),
    })),
  ];
  return { event_seq: Number(eventSeq), lineage: origin.lineage_batch_id == null ? "legacy" : "tracked", chain };
}
