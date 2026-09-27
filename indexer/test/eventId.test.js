import { test } from "node:test";
import assert from "node:assert/strict";
import { toid, formatEventId, parseEventId, eventIdFromRpc, EVENT_ID_RE } from "../src/eventId.js";

test("formats IDs like Soroban RPC getEvents", () => {
  // Ledger 1, tx 1, op 0, event 0 → TOID 4294971392.
  assert.equal(formatEventId(toid(1, 1, 0), 0), "0000000004294971392-0000000000");
  assert.match(formatEventId(toid(52_000_000, 12, 3), 7), EVENT_ID_RE);
});

test("round-trips chain position", () => {
  const id = formatEventId(toid(52_000_000, 1234, 7), 42);
  assert.deepEqual(parseEventId(id), { ledger: 52_000_000, txOrder: 1234, opIndex: 7, eventIndex: 42 });
  assert.equal(parseEventId("12"), null);
});

test("re-deriving from the same chain data gives identical IDs", () => {
  const ev = { ledger: 100, txOrder: 3, opIndex: 0, eventIndex: 1 };
  assert.equal(eventIdFromRpc(ev), eventIdFromRpc({ ...ev }));
});

test("prefers the RPC-provided id and sorts in chain order", () => {
  assert.equal(eventIdFromRpc({ id: "0000000004294971392-0000000000", ledger: 9 }), "0000000004294971392-0000000000");
  const ids = [formatEventId(toid(10, 2, 0), 0), formatEventId(toid(9, 5, 0), 3), formatEventId(toid(10, 1, 0), 9)];
  assert.deepEqual([...ids].sort(), [ids[1], ids[2], ids[0]]);
  assert.equal(eventIdFromRpc({ ledger: 1 }), null);
});
