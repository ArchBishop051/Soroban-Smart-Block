import { pool } from "../db.js";
import config from "../config.js";

const PRIORITY = { live: 40, interactive: 30, maintenance: 20, bulk: 10 };
const WEIGHTS = { live: 8, interactive: 4, maintenance: 2, bulk: 1 };

export function allocateResourceBudgets(total, weights = WEIGHTS) {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(weights).map(([name, weight]) => [name, Math.max(1, Math.floor((Number(total) * weight) / sum))]));
}

export async function enqueueJob({ kind, payload = {}, priorityClass = "maintenance", priority_class, tenantId = null, tenant_id, idempotencyKey = null, idempotency_key, maxAttempts = 3, availableAt = new Date() }) {
  priorityClass = priority_class ?? priorityClass;
  tenantId = tenant_id ?? tenantId;
  idempotencyKey = idempotency_key ?? idempotencyKey;
  if (!PRIORITY[priorityClass]) throw new Error(`unknown priority class: ${priorityClass}`);
  const { rows } = await pool.query(`INSERT INTO jobs (kind,payload,priority_class,tenant_id,idempotency_key,max_attempts,available_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO UPDATE SET payload=EXCLUDED.payload RETURNING *`, [kind, payload, priorityClass, tenantId, idempotencyKey, maxAttempts, availableAt]);
  return rows[0];
}

export async function claimJob(workerId, classes = Object.keys(PRIORITY)) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE jobs SET status='queued', heartbeat_at=NULL WHERE status='running' AND heartbeat_at < NOW() - ($1 * INTERVAL '1 millisecond')", [config.JOB_HEARTBEAT_MS]);
    const { rows } = await client.query(`SELECT * FROM jobs WHERE status='queued' AND available_at <= NOW() AND priority_class = ANY($1) ORDER BY CASE priority_class WHEN 'live' THEN 40 WHEN 'interactive' THEN 30 WHEN 'maintenance' THEN 20 ELSE 10 END DESC, CASE WHEN priority_class = 'interactive' THEN COALESCE(tenant_id, '') ELSE '' END, created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`, [classes]);
    if (!rows.length) { await client.query("COMMIT"); return null; }
    const { rows: claimed } = await client.query("UPDATE jobs SET status='running', attempts=attempts+1, heartbeat_at=NOW(), worker_id=$2, started_at=COALESCE(started_at,NOW()) WHERE id=$1 RETURNING *", [rows[0].id, workerId]);
    await client.query("COMMIT");
    return claimed[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function heartbeatJob(id, progress) { await pool.query("UPDATE jobs SET heartbeat_at=NOW(), progress=COALESCE($2, progress) WHERE id=$1 AND status='running'", [id, progress ?? null]); }
export async function completeJob(id) { await pool.query("UPDATE jobs SET status='completed', progress=100, finished_at=NOW(), heartbeat_at=NULL WHERE id=$1", [id]); }
export async function failJob(id, error, retry = true) { await pool.query("UPDATE jobs SET status=CASE WHEN $2 AND attempts < max_attempts THEN 'queued' ELSE 'failed' END, error=$3, available_at=NOW() + (LEAST(attempts, 8) * INTERVAL '1 minute'), heartbeat_at=NULL WHERE id=$1", [id, retry, String(error?.message ?? error)]); }
export async function cancelJob(id) { await pool.query("UPDATE jobs SET status='cancelled', finished_at=NOW(), heartbeat_at=NULL WHERE id=$1 AND status IN ('queued','running')", [id]); }
export async function listJobs({ status, limit = 100 } = {}) { const params = []; const where = status ? "WHERE status=$1" : ""; if (status) params.push(status); params.push(Math.min(Number(limit) || 100, 500)); const { rows } = await pool.query(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params); return rows; }

export function startJobWorker({ workerId = `worker-${process.pid}`, handler, intervalMs = 250 } = {}) {
  if (typeof handler !== "function") throw new Error("job worker requires a handler");
  let stopped = false;
  const tick = async () => { if (stopped) return; const job = await claimJob(workerId); if (!job) return; try { await handler(job, (progress) => heartbeatJob(job.id, progress)); await completeJob(job.id); } catch (error) { await failJob(job.id, error); } };
  const timer = setInterval(() => tick().catch(() => {}), intervalMs); timer.unref?.();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
