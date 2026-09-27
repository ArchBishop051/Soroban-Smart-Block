import { EventMmr, hashLeaf } from "./mmr.js";

/** Rebuild the local commitment from a repeatable snapshot and compare it. */
export async function reconcileEventCommitment({ db, fetchRoot, limit = 1000 }) {
  const mmr = new EventMmr();
  let after = 0;
  for (;;) {
    const { rows } = await db.query(
      "SELECT seq, contract_id, function, ledger, description, raw_data FROM events WHERE seq > $1 ORDER BY seq ASC LIMIT $2",
      [after, limit],
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      const payload = JSON.stringify([row.seq, row.contract_id, row.function, row.ledger, row.description, row.raw_data]);
      mmr.append(hashLeaf(payload));
      after = row.seq;
    }
  }
  const local = mmr.root();
  const remote = await fetchRoot();
  const ok = local.root === remote.root && local.leafCount === Number(remote.leafCount);
  if (!ok) await db.query("UPDATE events SET integrity = 'suspect' WHERE seq <= $1", [Math.min(local.leafCount, Number(remote.leafCount))]);
  return { ok, local, remote };
}
