import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNarrative, extractMovements, netFlows } from "../src/narrative/index.js";

const addr = (c, p) => p + c.repeat(55);
const [ALICE, BOB, POOL1, POOL2] = [addr("A", "G"), addr("B", "G"), addr("P", "C"), addr("Q", "C")];
const [USDC, XLM, EURC, LP] = [addr("U", "C"), addr("X", "C"), addr("E", "C"), addr("L", "C")];

const transfer = (asset, from, to, amount) => ({ contract_id: asset, function: "transfer", raw_topics: ["transfer", from, to], raw_data: JSON.stringify(String(amount)) });
const mint = (asset, to, amount) => ({ contract_id: asset, function: "mint", raw_topics: ["mint", to], raw_data: JSON.stringify(String(amount)) });
const burn = (asset, from, amount) => ({ contract_id: asset, function: "burn", raw_topics: ["burn", from], raw_data: JSON.stringify(String(amount)) });

// Golden fixtures: [name, events, expected action, expected sentence (regex)]
const GOLDEN = [
  ["plain transfer", [transfer(USDC, ALICE, BOB, 10_000_000)], "transfer", /GAAA…AAAA sent 1 CUUU…UUUU to GBBB…BBBB/],
  ["mint", [mint(USDC, BOB, 25_000_000)], "mint", /2\.5 CUUU…UUUU minted to GBBB/],
  ["burn", [burn(USDC, ALICE, 5_000_000)], "burn", /burned 0\.5 CUUU/],
  ["single-hop swap", [transfer(USDC, ALICE, POOL1, 10_000_000), transfer(XLM, POOL1, ALICE, 90_000_000)], "swap", /swapped 1 CUUU…UUUU for 9 CXXX…XXXX/],
  [
    "multi-hop swap",
    [transfer(USDC, ALICE, POOL1, 10_000_000), transfer(XLM, POOL1, POOL2, 90_000_000), transfer(EURC, POOL2, ALICE, 9_000_000)],
    "swap",
    /swapped 1 CUUU…UUUU for 0\.9 CEEE…EEEE via 2 hops/,
  ],
  [
    "add liquidity",
    [transfer(USDC, ALICE, POOL1, 10_000_000), transfer(XLM, ALICE, POOL1, 90_000_000), mint(LP, ALICE, 30_000_000)],
    "liquidity_add",
    /added liquidity/,
  ],
  [
    "remove liquidity",
    [burn(LP, ALICE, 30_000_000), transfer(USDC, POOL1, ALICE, 10_000_000), transfer(XLM, POOL1, ALICE, 90_000_000)],
    "liquidity_remove",
    /removed liquidity/,
  ],
  ["lending supply", [{ contract_id: POOL1, function: "supply", raw_topics: ["supply", ALICE], raw_data: "{}" }], "supply", /supply on/],
  ["nft mint", [{ contract_id: POOL2, function: "mint_nft", raw_topics: ["mint", BOB], raw_data: "7" }], "nft_mint", /NFT #7/],
  [
    "circular arbitrage falls back to net flows",
    [transfer(USDC, ALICE, POOL1, 10), transfer(XLM, POOL1, POOL2, 20), transfer(USDC, POOL2, ALICE, 12)],
    "net_flows",
    /Net flows: .*GAAA…AAAA \+0\.0000002 CUUU/,
  ],
];

test(`golden narratives (${GOLDEN.length} fixtures)`, () => {
  for (const [name, events, action, sentence] of GOLDEN) {
    const n = buildNarrative(events);
    assert.equal(n.action, action, name);
    assert.match(n.sentence, sentence, `${name}: ${n.sentence}`);
  }
});

test("failed transactions say what was attempted", () => {
  const n = buildNarrative([transfer(USDC, ALICE, BOB, 1)], { failed: true, error: "insufficient balance" });
  assert.equal(n.action, "failed");
  assert.match(n.sentence, /Attempted transfer on CUUU…UUUU, failed: insufficient balance/);
});

test("net-flow invariant: per asset, deltas sum to minted − burned", () => {
  for (const [, events] of GOLDEN) {
    const moves = extractMovements(events);
    for (const [asset, byAddr] of Object.entries(netFlows(moves))) {
      const sum = Object.values(byAddr).reduce((a, b) => a + b, 0n);
      const minted = moves.filter((m) => m.asset === asset && !m.from).reduce((a, m) => a + m.amount, 0n);
      const burned = moves.filter((m) => m.asset === asset && !m.to).reduce((a, m) => a + m.amount, 0n);
      assert.equal(sum, minted - burned, asset);
    }
  }
});
