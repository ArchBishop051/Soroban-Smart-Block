import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { db } from "../src/db.js";
import {
  submitJob,
  validateJobRequest,
  signedResultUrl,
  verifyResultUrl,
  TIER_QUOTAS,
} from "../src/jobs/queryJobs.js";

// In-memory stand-in for the query_jobs table and the events snapshot.
let jobs;
let keyActive;
let events;
beforeEach(() => {
  jobs = new Map();
  keyActive = true;
  events = Array.from({ length: 12 }, (_, i) => ({ seq: i + 1, ledger: 100 + i, contract_id: "CA", function: "swap", description: `e${i}` }));
  Object.assign(db, {
    getLastIndexedLedger: async () => 111,
    getQueryJobByIdempotencyKey: async (k, key) => [...jobs.values()].find((j) => j.api_key_id === k && j.idempotency_key === key) ?? null,
    countActiveQueryJobs: async (k) => [...jobs.values()].filter((j) => j.api_key_id === k && ["queued", "running"].includes(j.status)).length,
    createQueryJob: async (j) => {
      const row = { id: j.id, api_key_id: j.apiKeyId, tier: j.tier, type: j.type, params: j.params, format: j.format, idempotency_key: j.idempotencyKey ?? null, status: "queued", rows_written: 0, bytes_written: 0, partial: false };
      jobs.set(j.id, row);
      return row;
    },
    getQueryJob: async (id) => jobs.get(id) ?? null,
    updateQueryJob: async (id, fields) => Object.assign(jobs.get(id), fields),
    isApiKeyActive: async () => keyActive,
    async *iterateEventsSnapshot() {
      for (let i = 0; i < events.length; i += 5) yield events.slice(i, i + 5);
    },
  });
});

async function waitFor(id) {
  for (let i = 0; i < 200; i++) {
    const s = jobs.get(id).status;
    if (!["queued", "running"].includes(s)) return jobs.get(id);
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("job did not finish");
}

test("validates submissions", () => {
  assert.equal(validateJobRequest({ type: "events_export" }), null);
  assert.match(validateJobRequest({ type: "nope" }), /type/);
  assert.match(validateJobRequest({ type: "events_export", format: "xml" }), /format/);
  assert.match(validateJobRequest({ type: "events_export", params: { from_ledger: -1 } }), /from_ledger/);
});

test("signed result URLs expire and reject tampering", () => {
  const now = Date.now();
  const { url } = signedResultUrl("job-1", now);
  const q = new URL(url, "http://x").searchParams;
  assert.equal(verifyResultUrl("job-1", q.get("expires"), q.get("sig"), now), true);
  assert.equal(verifyResultUrl("job-2", q.get("expires"), q.get("sig"), now), false);
  assert.equal(verifyResultUrl("job-1", q.get("expires"), q.get("sig"), now + 3_600_000), false);
});

test("a job exports the whole snapshot and is idempotent", async () => {
  const { job, created } = await submitJob({ apiKeyId: "k1", tier: "pro", type: "events_export", idempotencyKey: "abc" });
  assert.equal(created, true);
  const done = await waitFor(job.id);
  assert.equal(done.status, "succeeded");
  assert.equal(done.rows_written, 12);
  assert.equal(done.snapshot_ledger, 111);
  assert.equal(fs.readFileSync(done.result_path, "utf-8").trim().split("\n").length, 12);

  const again = await submitJob({ apiKeyId: "k1", tier: "pro", type: "events_export", idempotencyKey: "abc" });
  assert.equal(again.created, false);
  assert.equal(again.job.id, job.id);
});

test("hitting the row quota stops with a partial result", async () => {
  const original = TIER_QUOTAS.free.rows;
  TIER_QUOTAS.free.rows = 7;
  try {
    const { job } = await submitJob({ apiKeyId: "k2", tier: "free", type: "events_export", format: "csv" });
    const done = await waitFor(job.id);
    assert.equal(done.status, "succeeded");
    assert.equal(done.partial, true);
    assert.equal(done.rows_written, 7);
    assert.equal(fs.readFileSync(done.result_path, "utf-8").trim().split("\n").length, 8); // header + 7
  } finally {
    TIER_QUOTAS.free.rows = original;
  }
});

test("revoking the key mid-run cancels the job and removes the result", async () => {
  let batches = 0;
  db.iterateEventsSnapshot = async function* () {
    for (let i = 0; i < events.length; i += 5) {
      if (++batches === 2) keyActive = false;
      yield events.slice(i, i + 5);
    }
  };
  const { job } = await submitJob({ apiKeyId: "k3", tier: "pro", type: "events_export" });
  const done = await waitFor(job.id);
  assert.equal(done.status, "cancelled");
  assert.match(done.error, /revoked/);
  assert.equal(done.result_path, null);
});

test("concurrent-job quota is enforced per tier", async () => {
  db.iterateEventsSnapshot = async function* () {
    await new Promise((r) => setTimeout(r, 50));
    yield events;
  };
  const { job } = await submitJob({ apiKeyId: "k4", tier: "free", type: "events_export" });
  await assert.rejects(submitJob({ apiKeyId: "k4", tier: "free", type: "events_export" }), { status: 429 });
  await waitFor(job.id);
});
