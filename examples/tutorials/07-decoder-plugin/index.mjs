// Tutorial 7 — write a decoder plugin.
// STATUS: in progress — the indexer cannot load external decoder plugins yet,
// so this tutorial is excluded from CI (see tutorials.json). The plugin itself
// is runnable: this script exercises it against fixtures, which is also how
// you would unit-test it. See docs/guides/adding-a-decoder.md for wiring a
// decoder into the indexer today.
import plugin from "./plugin.mjs";
import { check } from "../lib.mjs";

// #region fixtures
const fixtures = [
  { topics: ["ticket_purchased", "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW"], data: { amount: "100000000", numbers: [7, 14, 21] } },
  { topics: ["transfer", "GA…", "GB…"], data: { amount: "1" } },
];

const matched = fixtures.filter(plugin.match);
check(matched.length === 1, `plugin "${plugin.name}" matches only its own events`);
const text = plugin.describe(matched[0]);
check(text === "GABCDE…TUVW bought lottery ticket (numbers: 7, 14, 21) for 10 XLM", `decoded: ${text}`);
// #endregion fixtures
