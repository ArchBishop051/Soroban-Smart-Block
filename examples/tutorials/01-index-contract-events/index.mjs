// Tutorial 1 — index your own contract's events.
// Point the indexer at your network (SOROBAN_RPC_URL), deploy/invoke your
// contract, then read its decoded events back from the explorer API.
import { API_URL, api, check } from "../lib.mjs";

// #region health
const health = await fetch(`${API_URL}/health`);
check(health.ok, "indexer is up");
// #endregion health

// #region events
const contract = process.env.CONTRACT_ID; // your contract's C… address, optional
const query = new URLSearchParams({ limit: "10", ...(contract ? { contract } : {}) });
const { data: events, next_cursor } = await api(`/events?${query}`);
check(Array.isArray(events), `fetched ${events.length} recent event(s)${contract ? ` for ${contract}` : ""}`);
for (const ev of events) {
  console.log(`  #${ev.seq} ledger ${ev.ledger} ${ev.function}: ${ev.description}`);
}
// #endregion events

// #region paginate
// Keyset pagination: pass next_cursor back as after_seq to walk older events.
if (next_cursor) {
  const older = await api(`/events?${new URLSearchParams({ ...Object.fromEntries(query), after_seq: String(next_cursor) })}`);
  check(older.data.every((ev) => ev.seq < next_cursor), "older page is strictly before the cursor");
} else {
  check(true, "all events fit on one page");
}
// #endregion paginate
