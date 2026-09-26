import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startLineageBatch, recordLineageEvent, getEventLineage, redactSource } from "../src/lineage.js";
import { runReDecodeBatch } from "../src/reDecodeWorker.js";

// Minimal in-memory stand-in for the three lineage tables so the full
// live → re-decode → reconcile chain can be exercised without Postgres.
function fakeStore() {
  const batches = [];
  const lineageEvents = [];
  const events = new Map();
  const query = async (sql, params) => {
    if (sql.includes("INSERT INTO lineage_batches")) {
      const [run_type, run_id, source, ledger_from, ledger_to, code_version, decoder_versions] = params;
      const row = { id: batches.length + 1, run_type, run_id, source, ledger_from, ledger_to, code_version, decoder_versions: JSON.parse(decoder_versions), created_at: new Date() };
      batches.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes("INSERT INTO lineage_events")) {
      const [event_seq, batch_id, action, detail] = params;
      lineageEvents.push({ id: lineageEvents.length + 1, event_seq, batch_id, action, detail: JSON.parse(detail), created_at: new Date() });
      return { rows: [] };
    }
    if (sql.includes("FROM events e")) {
      const ev = events.get(params[0]);
      if (!ev) return { rows: [] };
      const batch = batches.find((b) => b.id === ev.lineage_batch_id) ?? {};
      return { rows: [{ ...batch, seq: ev.seq, lineage_batch_id: ev.lineage_batch_id ?? null }] };
    }
    if (sql.includes("FROM lineage_events le")) {
      return {
        rows: lineageEvents
          .filter((le) => le.event_seq === params[0])
          .map((le) => ({ ...batches.find((b) => b.id === le.batch_id), action: le.action, detail: le.detail })),
      };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  return { query, events };
}

describe("lineage", () => {
  it("returns the full chain across live → re-decode → reconcile", async () => {
    const { query, events } = fakeStore();

    const live = await startLineageBatch({ runType: "live", source: "https://user:secret@rpc.example/?key=abc", ledgerFrom: 10, ledgerTo: 12 }, query);
    events.set(7, { seq: 7, lineage_batch_id: live.id });

    await runReDecodeBatch({
      dbModule: {
        getEventsNeedingRedecode: async () => [{ seq: 7, contract_id: "C1", ledger: 11, tx_hash: "tx", raw_topics: "[]", raw_data: null, abi_version: 1 }],
        getContractMeta: async () => ({ abi_version: 2 }),
        updateRedecodedEvent: async () => {},
      },
      decodeFn: async () => ({ function: "transfer", description: "d" }),
      lineage: {
        startLineageBatch: (opts) => startLineageBatch(opts, query),
        recordLineageEvent: (...args) => recordLineageEvent(...args, query),
      },
    });

    const reconcile = await startLineageBatch({ runType: "reconcile", source: "reconciler" }, query);
    await recordLineageEvent(7, reconcile.id, "reconcile", { matched: true }, query);

    const full = await getEventLineage(7, { full: true }, query);
    assert.equal(full.lineage, "tracked");
    assert.deepEqual(full.chain.map((s) => [s.action, s.run_type]), [["ingest", "live"], ["redecode", "redecode"], ["reconcile", "reconcile"]]);
    assert.equal(full.chain[0].source, "https://rpc.example/");
    assert.deepEqual(full.chain[0].ledger_range, [10, 12]);
    assert.deepEqual(full.chain[1].detail, { from_abi_version: 1, to_abi_version: 2 });

    const summary = await getEventLineage(7, {}, query);
    assert.equal(summary.chain[0].source, undefined);
    assert.equal(summary.chain[0].run_id, undefined);
  });

  it("reports rows written before lineage existed as legacy", async () => {
    const { query, events } = fakeStore();
    events.set(1, { seq: 1, lineage_batch_id: null });
    const result = await getEventLineage(1, {}, query);
    assert.equal(result.lineage, "legacy");
    assert.deepEqual(result.chain, [{ action: "ingest", lineage: "legacy" }]);
  });

  it("returns null for unknown events and rejects unknown run types", async () => {
    const { query } = fakeStore();
    assert.equal(await getEventLineage(99, {}, query), null);
    await assert.rejects(startLineageBatch({ runType: "bogus", source: "x" }, query), /unknown lineage run type/);
    assert.equal(redactSource("not a url"), "not a url");
  });
});
