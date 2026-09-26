import { logger } from "../logger.js";
/**
 * Asynchronous query jobs (#906).
 *
 * Heavy requests (e.g. a year of events for a busy contract) are submitted as
 * jobs instead of being served inline:
 *
 *   POST   /api/jobs                {type, params, format}  → 202 {id, status}
 *   GET    /api/jobs/:id            status, progress, partial flag
 *   GET    /api/jobs/:id/result     → short-lived signed download URL
 *   DELETE /api/jobs/:id            cancel
 *
 * Jobs run in this process with a bounded worker pool (`interactive` class),
 * so API workers only handle submit/poll. Each job reads one REPEATABLE READ
 * snapshot (db.iterateEventsSnapshot) and writes the result to the result
 * store. The store is the local filesystem by default
 * (`QUERY_JOBS_DIR`); mount object storage there in production.
 *
 * Per-tier quotas bound concurrency, rows and bytes; a job that hits its
 * row/byte quota stops with a partial result flagged as such. A job whose
 * API key is revoked mid-run is cancelled, and its result becomes
 * inaccessible (downloads require the owning, still-valid key).
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { once } from "events";
import { db } from "../db.js";

export const JOB_TYPES = new Set(["events_export"]);
export const FORMATS = new Set(["ndjson", "csv"]);

const RESULT_DIR = process.env.QUERY_JOBS_DIR || path.join(os.tmpdir(), "explorer-query-jobs");
const RETENTION_DAYS = Number(process.env.QUERY_JOBS_RETENTION_DAYS ?? 7);
const URL_TTL_SECONDS = Number(process.env.QUERY_JOBS_URL_TTL_SECONDS ?? 300);
const WORKERS = Number(process.env.QUERY_JOBS_WORKERS ?? 2);
const URL_SECRET = process.env.QUERY_JOBS_URL_SECRET || crypto.randomBytes(32).toString("hex");

/** Per-tier quotas. Unknown tiers get the `free` quota. */
export const TIER_QUOTAS = {
  free: { concurrent: 1, rows: 1_000_000, bytes: 256 * 1024 ** 2 },
  pro: { concurrent: 3, rows: 10_000_000, bytes: 4 * 1024 ** 3 },
  enterprise: { concurrent: 10, rows: 100_000_000, bytes: 40 * 1024 ** 3 },
};
export const quotaFor = (tier) => TIER_QUOTAS[tier] ?? TIER_QUOTAS.free;

const CSV_COLUMNS = ["seq", "ledger", "contract_id", "contract_name", "function", "description", "tx_hash", "created_at"];

function csvRow(row) {
  return (
    CSV_COLUMNS.map((c) => {
      const v = row[c];
      if (v == null) return "";
      const s = v instanceof Date ? v.toISOString() : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",") + "\n"
  );
}

/**
 * Validate a submission body. Returns an error string or null.
 * @param {{ type?: string, format?: string, params?: object }} body
 */
export function validateJobRequest(body) {
  if (!body || !JOB_TYPES.has(body.type)) return `type must be one of: ${[...JOB_TYPES].join(", ")}`;
  if (body.format !== undefined && !FORMATS.has(body.format)) return `format must be one of: ${[...FORMATS].join(", ")}`;
  const p = body.params ?? {};
  for (const k of ["from_ledger", "to_ledger"]) {
    if (p[k] !== undefined && (!Number.isInteger(p[k]) || p[k] < 0)) return `params.${k} must be a non-negative integer`;
  }
  if (p.contract !== undefined && typeof p.contract !== "string") return "params.contract must be a string";
  return null;
}

// ── Signed result URLs ───────────────────────────────────────────────────────

function urlSignature(id, expires) {
  return crypto.createHmac("sha256", URL_SECRET).update(`${id}.${expires}`).digest("base64url");
}

/** Relative, short-lived signed download URL for a finished job. */
export function signedResultUrl(id, now = Date.now()) {
  const expires = Math.floor(now / 1000) + URL_TTL_SECONDS;
  return { url: `/api/jobs/${id}/download?expires=${expires}&sig=${urlSignature(id, expires)}`, expires_at: new Date(expires * 1000).toISOString() };
}

export function verifyResultUrl(id, expires, sig, now = Date.now()) {
  if (!expires || !sig || Number(expires) * 1000 < now) return false;
  const expected = Buffer.from(urlSignature(id, Number(expires)));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// ── Runner ───────────────────────────────────────────────────────────────────

const queue = [];
let running = 0;
const cancelled = new Set();

/** Public view of a job row. */
export function jobView(job) {
  return {
    id: job.id,
    type: job.type,
    format: job.format,
    params: job.params,
    status: job.status,
    progress: { rows: Number(job.rows_written), bytes: Number(job.bytes_written) },
    partial: job.partial,
    snapshot_ledger: job.snapshot_ledger == null ? null : Number(job.snapshot_ledger),
    error: job.error,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    expires_at: job.expires_at,
  };
}

/**
 * Submit a job. Returns `{ job, created }`; an existing job is returned when
 * the same idempotency key is reused. Throws `{ status: 429 }` when the
 * tier's concurrent-job quota is exhausted.
 */
export async function submitJob({ apiKeyId, tier, type, params = {}, format = "ndjson", idempotencyKey }) {
  if (idempotencyKey) {
    const existing = await db.getQueryJobByIdempotencyKey(apiKeyId, idempotencyKey);
    if (existing) return { job: existing, created: false };
  }
  if ((await db.countActiveQueryJobs(apiKeyId)) >= quotaFor(tier).concurrent) {
    throw Object.assign(new Error("Concurrent job quota exceeded for this tier"), { status: 429 });
  }
  const job = await db.createQueryJob({ id: crypto.randomUUID(), apiKeyId, tier, type, params, format, idempotencyKey });
  if (!job) {
    // Lost a race with a concurrent submission using the same idempotency key.
    return { job: await db.getQueryJobByIdempotencyKey(apiKeyId, idempotencyKey), created: false };
  }
  queue.push(job.id);
  pump();
  return { job, created: true };
}

export async function cancelJob(id) {
  const job = await db.getQueryJob(id);
  if (!job || !["queued", "running"].includes(job.status)) return job;
  cancelled.add(id);
  if (job.status === "queued") {
    await db.updateQueryJob(id, { status: "cancelled", finished_at: new Date() });
  }
  return db.getQueryJob(id);
}

function pump() {
  while (running < WORKERS && queue.length) {
    const id = queue.shift();
    running++;
    runJob(id)
      .catch((err) => logger.error(`[jobs] ${id} crashed: ${err.message}`))
      .finally(() => {
        running--;
        pump();
      });
  }
}

async function runJob(id) {
  const job = await db.getQueryJob(id);
  if (!job || job.status !== "queued" || cancelled.has(id)) return;

  const quota = quotaFor(job.tier);
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const resultPath = path.join(RESULT_DIR, `${id}.${job.format === "csv" ? "csv" : "ndjson"}`);
  await db.updateQueryJob(id, {
    status: "running",
    started_at: new Date(),
    result_path: resultPath,
    snapshot_ledger: await db.getLastIndexedLedger().catch(() => null),
  });

  const out = fs.createWriteStream(resultPath);
  let rows = 0;
  let bytes = 0;
  let stopReason = null; // "cancelled" | "revoked" | "quota"

  const write = async (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (!out.write(chunk)) await once(out, "drain");
  };

  try {
    if (job.format === "csv") await write(CSV_COLUMNS.join(",") + "\n");
    const { contract, from_ledger: fromLedger, to_ledger: toLedger } = job.params ?? {};
    for await (const batch of db.iterateEventsSnapshot({ contract, fromLedger, toLedger })) {
      if (cancelled.has(id)) { stopReason = "cancelled"; break; }
      if (!(await db.isApiKeyActive(job.api_key_id))) { stopReason = "revoked"; break; }
      for (const row of batch) {
        if (rows >= quota.rows || bytes >= quota.bytes) { stopReason = "quota"; break; }
        await write(job.format === "csv" ? csvRow(row) : JSON.stringify(row) + "\n");
        rows++;
      }
      await db.updateQueryJob(id, { rows_written: rows, bytes_written: bytes });
      if (stopReason) break;
    }
    out.end();
    await once(out, "finish");

    const finishedAt = new Date();
    if (stopReason === "cancelled" || stopReason === "revoked") {
      fs.rmSync(resultPath, { force: true });
      await db.updateQueryJob(id, {
        status: "cancelled",
        error: stopReason === "revoked" ? "API key revoked while the job was running" : null,
        rows_written: rows,
        bytes_written: bytes,
        result_path: null,
        finished_at: finishedAt,
      });
    } else {
      await db.updateQueryJob(id, {
        status: "succeeded",
        partial: stopReason === "quota",
        error: stopReason === "quota" ? "Row or byte quota reached; result is partial" : null,
        rows_written: rows,
        bytes_written: bytes,
        finished_at: finishedAt,
        expires_at: new Date(finishedAt.getTime() + RETENTION_DAYS * 86_400_000),
      });
    }
  } catch (err) {
    out.destroy();
    fs.rmSync(resultPath, { force: true });
    await db.updateQueryJob(id, { status: "failed", error: err.message, finished_at: new Date(), result_path: null });
  } finally {
    cancelled.delete(id);
  }
}

/** Delete results past their retention window. */
export async function sweepExpiredJobs() {
  for (const job of await db.listExpiredQueryJobs()) {
    if (job.result_path) fs.rmSync(job.result_path, { force: true });
    await db.updateQueryJob(job.id, { status: "expired", result_path: null });
  }
}

/**
 * Resume after a restart: jobs that were running are marked failed (their
 * snapshot is gone) and queued jobs are re-enqueued. Then start the hourly
 * retention sweep.
 */
export async function startQueryJobMaintenance(intervalMs = 3_600_000) {
  for (const { id } of await db.listQueryJobsByStatus("running")) {
    await db.updateQueryJob(id, { status: "failed", error: "Interrupted by a restart; resubmit the job", finished_at: new Date() });
  }
  for (const { id } of await db.listQueryJobsByStatus("queued")) queue.push(id);
  pump();

  const timer = setInterval(() => sweepExpiredJobs().catch((err) => logger.warn(`[jobs] sweep failed: ${err.message}`)), intervalMs);
  timer.unref?.();
  return timer;
}
