import { diffRows } from "./diff.js";
import { digestRows } from "./canonical.js";
import { loadFixtures, recordFixture } from "./fixtureSource.js";

export class EphemeralReplayStore {
  constructor() { this.rows = []; }
  async insert(row) { this.rows.push(row); }
  async all() { return this.rows.slice(); }
}

export async function replayRange({ from, to, source = "fixture", fixtureDir, decoder = (record) => record, ingest, record = false, store = new EphemeralReplayStore() }) {
  if (source !== "fixture") throw new Error(`Replay source '${source}' requires an explicit adapter`);
  const records = await loadFixtures(fixtureDir, Number(from), Number(to));
  for (const input of records) {
    const output = await decoder(input);
    const rows = Array.isArray(output) ? output : [output];
    for (const row of rows) if (row != null) await (ingest ? ingest(row, store) : store.insert(row));
    if (record) await recordFixture(fixtureDir, input.ledger ?? input.ledger_sequence, input);
  }
  const rows = await store.all();
  return { from: Number(from), to: Number(to), rows, rowCount: rows.length, digest: digestRows(rows), store };
}

export async function diffAgainstProduction({ rows, db, from, to }) {
  const production = await db.getReplayRows(from, to);
  return diffRows(rows, production, ["ledger", "tx_hash", "contract_id", "id"]);
}
