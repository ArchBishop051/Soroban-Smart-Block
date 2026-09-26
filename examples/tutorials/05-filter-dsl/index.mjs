// Tutorial 5 — query with the filter DSL.
// Server-side filters (contract, fn, type) narrow what the API returns; the
// same DSL used by `soroban-explorer tui` refines results client-side:
//   fn:transfer !contract:CDA2 ledger>=1200 swap
import { api, check } from "../lib.mjs";
import { compileFilter } from "../../../packages/cli/src/tui/filter.js";

// #region server-side
const fn = process.env.FN ?? "transfer";
const { data } = await api(`/events?${new URLSearchParams({ fn, limit: "50" })}`);
check(data.every((ev) => ev.function === fn), `server-side fn=${fn} returned ${data.length} matching event(s)`);
// #endregion server-side

// #region dsl
const dsl = process.env.FILTER ?? "!fn:approve seq>=1";
const matches = compileFilter(dsl);
const recent = (await api("/events?limit=100")).data;
const filtered = recent.filter(matches);
check(filtered.every(matches), `DSL "${dsl}" kept ${filtered.length}/${recent.length} event(s)`);
// #endregion dsl
