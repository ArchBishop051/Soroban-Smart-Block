/**
 * Canonical event IDs (#892), compatible with Soroban RPC getEvents:
 *
 *   <TOID, 19 digits>-<event index within the operation, 10 digits>
 *   TOID = ledger << 32 | transaction order << 12 | operation index
 *
 * Derived purely from chain position, so independent indexers — and
 * re-indexing — produce the same IDs. The network is part of the lookup key,
 * not of the ID. Zero padding makes IDs sort in chain order as strings.
 */

export const EVENT_ID_RE = /^\d{19}-\d{10}$/;

/** TOID for (ledger, 1-based transaction order, operation index). */
export function toid(ledger, txOrder, opIndex = 0) {
  if (!Number.isInteger(ledger) || ledger < 0 || ledger > 0x7fffffff) throw new RangeError("ledger out of range");
  if (!Number.isInteger(txOrder) || txOrder < 0 || txOrder > 0xfffff) throw new RangeError("transaction order out of range");
  if (!Number.isInteger(opIndex) || opIndex < 0 || opIndex > 0xfff) throw new RangeError("operation index out of range");
  return (BigInt(ledger) << 32n) | (BigInt(txOrder) << 12n) | BigInt(opIndex);
}

export function formatEventId(toidValue, eventIndex) {
  if (!Number.isInteger(eventIndex) || eventIndex < 0) throw new RangeError("event index out of range");
  return `${BigInt(toidValue).toString().padStart(19, "0")}-${String(eventIndex).padStart(10, "0")}`;
}

export function parseEventId(id) {
  if (!EVENT_ID_RE.test(String(id))) return null;
  const [t, idx] = id.split("-");
  const value = BigInt(t);
  return {
    ledger: Number(value >> 32n),
    txOrder: Number((value >> 12n) & 0xfffffn),
    opIndex: Number(value & 0xfffn),
    eventIndex: Number(idx),
  };
}

/**
 * Event ID for a raw Soroban RPC event: RPC's own `id` when present (it is
 * computed from chain data), else derived from its position fields.
 */
export function eventIdFromRpc(ev) {
  if (typeof ev?.id === "string" && EVENT_ID_RE.test(ev.id)) return ev.id;
  const { ledger, txOrder, opIndex, eventIndex } = ev ?? {};
  if ([ledger, txOrder, eventIndex].every(Number.isInteger)) {
    return formatEventId(toid(ledger, txOrder, opIndex ?? 0), eventIndex);
  }
  return null;
}
