// Tutorial 6 — verify an event inclusion proof.
// STATUS: in progress — the explorer does not serve inclusion proofs yet, so
// this tutorial is excluded from CI (see tutorials.json). Until proofs land it
// cross-checks an indexed event against the network's own RPC: the
// transaction must exist, have succeeded, be in the same ledger, and emit an
// event from the same contract.
import { api, check } from "../lib.mjs";

const RPC_URL = process.env.SOROBAN_RPC_URL ?? "http://localhost:8000/soroban/rpc";

// #region rpc
async function rpc(method, params) {
  const res = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
// #endregion rpc

// #region verify
const seq = process.env.EVENT_SEQ;
const ev = seq ? await api(`/events/${seq}`) : (await api("/events?limit=1")).data[0];
check(ev, `picked event #${ev?.seq}`);

const tx = await rpc("getTransaction", { hash: ev.tx_hash });
check(tx.status === "SUCCESS", `transaction ${ev.tx_hash.slice(0, 12)}… succeeded on-chain`);
check(Number(tx.ledger) === Number(ev.ledger), `transaction is in ledger ${ev.ledger}`);

const { events } = await rpc("getEvents", { startLedger: Number(ev.ledger), filters: [{ type: "contract", contractIds: [ev.contract_id] }], pagination: { limit: 100 } });
check(events.some((e) => e.txHash === ev.tx_hash), "RPC reports an event from this contract in this transaction");
// #endregion verify
