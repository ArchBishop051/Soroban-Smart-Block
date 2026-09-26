import { pool } from './db.js';

function bucketHour(value) {
  const date = new Date(value || Date.now());
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

/** Increment hourly rollups in the same transaction as event insertion. */
export async function upsertEventRollups(client, event) {
  if (!event?.contract_id) return;
  const hour = bucketHour(event.ledger_close_time || event.created_at);
  const caller = event.caller || event.source || null;
  const values = [event.contract_id, hour, event.fee_charged || 0, caller ? JSON.stringify([caller]) : '[]'];
  await client.query(`INSERT INTO rollup_contract_hourly (contract_id, hour, events, fee_sum, callers)
    VALUES ($1,$2,1,$3,$4::jsonb) ON CONFLICT (contract_id,hour) DO UPDATE SET events = rollup_contract_hourly.events + 1, fee_sum = rollup_contract_hourly.fee_sum + EXCLUDED.fee_sum, callers = (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(rollup_contract_hourly.callers || EXCLUDED.callers) value)`, values);
  await client.query(`INSERT INTO rollup_function_hourly (contract_id,function_name,hour,events,fee_sum,callers)
    VALUES ($1,$5,$2,1,$3,$4::jsonb) ON CONFLICT (contract_id,function_name,hour) DO UPDATE SET events = rollup_function_hourly.events + 1, fee_sum = rollup_function_hourly.fee_sum + EXCLUDED.fee_sum, callers = (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(rollup_function_hourly.callers || EXCLUDED.callers) value)`, [...values, event.function || 'unknown']);
}

export async function decrementEventRollups(client, event) {
  if (!event?.contract_id) return;
  const hour = bucketHour(event.ledger_close_time || event.created_at);
  await client.query('UPDATE rollup_contract_hourly SET events = GREATEST(events - 1, 0), fee_sum = fee_sum - $3 WHERE contract_id = $1 AND hour = $2', [event.contract_id, hour, event.fee_charged || 0]);
  await client.query('UPDATE rollup_function_hourly SET events = GREATEST(events - 1, 0), fee_sum = fee_sum - $4 WHERE contract_id = $1 AND function_name = $2 AND hour = $3', [event.contract_id, event.function || 'unknown', hour, event.fee_charged || 0]);
}

export async function getContractRollup(contractId, { from, to } = {}) {
  const params = [contractId];
  const filters = ['contract_id = $1'];
  if (from) { params.push(from); filters.push(`hour >= $${params.length}`); }
  if (to) { params.push(to); filters.push(`hour <= $${params.length}`); }
  const { rows } = await pool.query(`SELECT COALESCE(SUM(events),0)::bigint AS events, COALESCE(SUM(fee_sum),0) AS fee_sum, COALESCE(SUM(jsonb_array_length(callers)),0)::bigint AS caller_samples FROM rollup_contract_hourly WHERE ${filters.join(' AND ')}`, params);
  return rows[0];
}
