import { StrKey, scValToNative } from "@stellar/stellar-sdk";

function encodeXdr(value) {
  try { return Buffer.from(value.toXDR()).toString("base64"); } catch { return value == null ? null : typeof value === "string" ? value : JSON.stringify(value); }
}
function native(value) {
  try { return scValToNative(value); } catch { return value; }
}
function entryParts(entry) {
  const data = entry?.data?.()?.contractData?.() ?? entry?.contractData ?? entry;
  if (!data) return null;
  const contract = data.contract?.() ?? data.contract;
  const rawContract = contract?.contractId?.() ?? contract?.contractId ?? data.contract_id;
  let contractId = rawContract;
  try { if (rawContract instanceof Uint8Array || Buffer.isBuffer(rawContract)) contractId = StrKey.encodeContract(rawContract); } catch { /* malformed fixture */ }
  const key = data.key?.() ?? data.key;
  const value = data.val?.() ?? data.value;
  const durability = data.durability?.()?.name ?? data.durability ?? "persistent";
  return { contract_id: contractId, key, value, durability: String(durability).replace(/^temporary$/i, "temporary").replace(/^persistent$/i, "persistent"), key_xdr: encodeXdr(key), value_xdr: encodeXdr(value), decoded_key: native(key), decoded_value: native(value) };
}

/** Convert transaction-meta LedgerEntryChanges into temporal state versions. */
export function extractStateVersions({ ledger, txHash = null, txIndex = 0, txMeta, changes = txMeta?.v3?.()?.sorobanMeta?.()?.changedEntries?.() ?? [] } = {}) {
  const versions = [];
  for (const change of changes) {
    const kind = change?.switch?.()?.name ?? change?.type;
    const entry = kind === "ledgerEntryState" ? change.state?.() ?? change.entry : kind === "ledgerEntryCreated" ? change.created?.() ?? change.entry : kind === "ledgerEntryUpdated" ? change.updated?.() ?? change.entry : kind === "ledgerEntryRemoved" ? change.removed?.() ?? change.entry : null;
    const parts = entryParts(entry);
    if (!parts?.contract_id || !parts.key_xdr) continue;
    versions.push({ ...parts, ledger_from: Number(ledger), ledger_to: null, tx_hash: txHash, tx_index: txIndex, change_type: kind === "ledgerEntryRemoved" ? "removed" : kind === "ledgerEntryCreated" ? "created" : "updated", value_xdr: kind === "ledgerEntryRemoved" ? null : parts.value_xdr });
  }
  // Last write in a ledger is the visible value; preserve earlier writes with
  // tx_index so replay and audit consumers can still inspect intermediate data.
  return versions;
}

export function applyStateVersions(history, versions) {
  const next = history.map((row) => ({ ...row }));
  for (const version of versions) {
    const open = next.find((row) => row.contract_id === version.contract_id && row.key_xdr === version.key_xdr && row.ledger_to == null);
    if (open && Number(open.ledger_from) <= Number(version.ledger_from)) open.ledger_to = Number(version.ledger_from) - 1;
    next.push({ ...version });
  }
  return next;
}

export function snapshotAt(history, contractId, ledger, prefix = "") {
  const target = Number(ledger);
  const visible = new Map();
  for (const row of history.filter((entry) => entry.contract_id === contractId && Number(entry.ledger_from) <= target && (entry.ledger_to == null || Number(entry.ledger_to) >= target)).sort((a, b) => Number(a.ledger_from) - Number(b.ledger_from) || Number(a.tx_index || 0) - Number(b.tx_index || 0))) {
    if (prefix && !String(row.decoded_key ?? row.key_xdr).startsWith(prefix)) continue;
    visible.set(row.key_xdr, row);
  }
  return [...visible.values()].filter((row) => row.change_type !== "removed");
}

export function evictionVersion({ contract_id, key_xdr, durability = "temporary", ledger, tx_hash = null, expiry_ledger = null }) {
  return { contract_id, key_xdr, durability, ledger_from: Number(ledger), ledger_to: expiry_ledger == null ? Number(ledger) : Number(expiry_ledger), value_xdr: null, decoded_key: null, decoded_value: null, tx_hash, tx_index: 0, change_type: "evicted" };
}
