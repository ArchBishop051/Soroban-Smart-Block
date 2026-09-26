/**
 * Asserts indexed + decoded output for every workload scenario against the
 * manifest written by `workloads/run.ts` (#946). Assertions are content-based
 * (contract, event name, minimum count) — never on ledger numbers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const BASE_URL = process.env.INDEXER_URL || "http://localhost:3001";
const MANIFEST = process.env.WORKLOAD_MANIFEST || new URL("../../workloads/manifest.json", import.meta.url).pathname;
const TIMEOUT_MS = Number(process.env.WORKLOAD_INDEX_TIMEOUT_MS || 120_000);

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

async function countMatching(contractId, event) {
  let matched = 0;
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${BASE_URL}/api/contracts/${contractId}/events?page=${page}&limit=100`);
    assert.equal(res.status, 200, `events for ${contractId} returned ${res.status}`);
    const { events } = await res.json();
    matched += events.filter((e) => e.function === event || JSON.stringify(e.raw_topics ?? "").includes(`"${event}"`)).length;
    if (events.length < 100) break;
  }
  return matched;
}

for (const exp of manifest.expectations) {
  test(`[${exp.scenario}] ${exp.contract} emits ≥${exp.count} "${exp.event}"`, async () => {
    assert.ok(exp.contract_id, `contract alias ${exp.contract} was never deployed`);
    const deadline = Date.now() + TIMEOUT_MS;
    let got = 0;
    while (Date.now() < deadline) {
      got = await countMatching(exp.contract_id, exp.event);
      if (got >= exp.count) return;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    assert.fail(`expected ≥${exp.count} "${exp.event}" events for ${exp.contract}, indexer has ${got}`);
  });
}

for (const s of manifest.skipped) {
  test(`[${s.scenario}] skipped: ${s.reason}`, { skip: s.reason }, () => {});
}
