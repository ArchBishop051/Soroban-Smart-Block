import { pool } from './db.js';
import { publish } from './wsEvents.js';
import { deliverWebhooksForEvent } from './webhookDelivery.js';
import { logger } from './logger.js';

/** Queue an event for post-commit fan-out. The stable event_id is the outbox id. */
export async function enqueueOutbox(client, event, { eventId = null } = {}) {
  const result = await client.query(
    `INSERT INTO indexer_outbox (event_id, topic, payload) VALUES (COALESCE($1, md5($3::text || clock_timestamp()::text)), $2, $3) RETURNING id, event_id`,
    [eventId, event.topic || 'event', JSON.stringify(event.payload || event)],
  );
  return result.rows[0];
}

export async function claimOutbox(limit = 100) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, event_id, topic, payload FROM indexer_outbox
       WHERE dispatched_at IS NULL AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')
       ORDER BY id ASC LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit],
    );
    if (rows.length) await client.query(`UPDATE indexer_outbox SET locked_at = NOW() WHERE id = ANY($1::bigint[])`, [rows.map((row) => row.id)]);
    await client.query('COMMIT');
    return rows;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function dispatchOutboxRow(row) {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  publish({ ...payload, event_id: row.event_id });
  await deliverWebhooksForEvent({ ...payload, event_id: row.event_id });
  await pool.query('UPDATE indexer_outbox SET dispatched_at = NOW(), locked_at = NULL WHERE id = $1 AND dispatched_at IS NULL', [row.id]);
}

export async function relayOutboxOnce({ limit = 100 } = {}) {
  const rows = await claimOutbox(limit);
  for (const row of rows) {
    try { await dispatchOutboxRow(row); } catch (error) { logger.error({ err: error.message, outbox_id: row.id }, 'outbox dispatch failed'); }
  }
  return rows.length;
}

export function startOutboxRelay({ intervalMs = 250 } = {}) {
  const timer = setInterval(() => relayOutboxOnce().catch((error) => logger.error({ err: error.message }, 'outbox relay failed')), intervalMs);
  return () => clearInterval(timer);
}
