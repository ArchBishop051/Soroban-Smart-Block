/**
 * Scenario library (#946). Each scenario appends steps and expectations to the
 * builder. Contracts that are not built in this repo (AMM, NFT, lending mock,
 * smart wallet, custom SEP-41) are supplied as WASM paths via environment
 * variables; when one is missing the scenario is recorded as skipped in the
 * manifest instead of failing the run.
 */
import { existsSync } from "node:fs";
import { WorkloadBuilder, type Workload } from "./dsl.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
export const WASM = {
  explorer: process.env.WORKLOAD_WASM_EXPLORER ?? `${ROOT}target/wasm32-unknown-unknown/release/soroban_explorer_contract.wasm`,
  ticket: process.env.WORKLOAD_WASM_TICKET ?? `${ROOT}contracts/ticket/target/wasm32-unknown-unknown/release/ticket.wasm`,
  token: process.env.WORKLOAD_WASM_TOKEN,
  amm: process.env.WORKLOAD_WASM_AMM,
  nft: process.env.WORKLOAD_WASM_NFT,
  lending: process.env.WORKLOAD_WASM_LENDING,
  wallet: process.env.WORKLOAD_WASM_WALLET,
  // Any contract exposing `upgrade(new_wasm_hash: BytesN<32>)`; upgraded to itself.
  upgradable: process.env.WORKLOAD_WASM_UPGRADABLE,
};

const has = (path?: string): path is string => Boolean(path && existsSync(path));

function setup(b: WorkloadBuilder) {
  b.begin("setup");
  for (const alias of ["admin", "alice", "bob", "carol", "sponsor"]) b.step({ kind: "account", alias });
  b.step({ kind: "sac", alias: "usdc", code: "USDC", issuer: "admin" });
  if (has(WASM.explorer)) b.step({ kind: "deploy", alias: "explorer", wasm: WASM.explorer, source: "admin" });
  if (has(WASM.ticket)) b.step({ kind: "deploy", alias: "ticket", wasm: WASM.ticket, source: "admin" });
}

function tokenLifecycle(b: WorkloadBuilder) {
  b.begin("token-lifecycle");
  const mint = b.int(1_000, 10_000) * 10_000_000;
  const xfer = Math.floor(mint / b.int(2, 5));
  b.step({ kind: "invoke", contract: "usdc", source: "admin", fn: "mint", args: { to: "alice", amount: mint } }).expect("usdc", "mint");
  b.step({ kind: "invoke", contract: "usdc", source: "alice", fn: "transfer", args: { from: "alice", to: "bob", amount: xfer } }).expect("usdc", "transfer");
  b.step({ kind: "invoke", contract: "usdc", source: "alice", fn: "approve", args: { from: "alice", spender: "carol", amount: xfer, expiration_ledger: 1_000_000 } }).expect("usdc", "approve");
  b.step({ kind: "invoke", contract: "usdc", source: "carol", fn: "transfer_from", args: { spender: "carol", from: "alice", to: "carol", amount: Math.floor(xfer / 2) } }).expect("usdc", "transfer");
  b.step({ kind: "invoke", contract: "usdc", source: "bob", fn: "burn", args: { from: "bob", amount: Math.floor(xfer / 4) } }).expect("usdc", "burn");
  if (has(WASM.token)) {
    b.step({ kind: "deploy", alias: "sep41", wasm: WASM.token, source: "admin" });
    b.step({ kind: "invoke", contract: "sep41", source: "admin", fn: "initialize", args: { admin: "admin", decimal: 7, name: "Workload", symbol: "WRK" } });
    b.step({ kind: "invoke", contract: "sep41", source: "admin", fn: "mint", args: { to: "alice", amount: mint } }).expect("sep41", "mint");
  } else b.skip("WORKLOAD_WASM_TOKEN not set: custom SEP-41 token steps skipped (SAC covers SEP-41)");
}

function failures(b: WorkloadBuilder) {
  b.begin("failures");
  // Insufficient balance, missing auth, and unknown function — each must fail without being indexed as success.
  b.step({ kind: "invoke", contract: "usdc", source: "carol", fn: "transfer", args: { from: "carol", to: "bob", amount: 10 ** 15 }, expectFailure: true });
  b.step({ kind: "invoke", contract: "usdc", source: "bob", fn: "mint", args: { to: "bob", amount: 1 }, expectFailure: true });
  b.step({ kind: "invoke", contract: "usdc", source: "bob", fn: "does_not_exist", args: {}, expectFailure: true });
}

function explorerAbi(b: WorkloadBuilder) {
  b.begin("explorer-registry");
  if (!has(WASM.explorer)) return void b.skip("explorer WASM not built");
  b.step({ kind: "invoke", contract: "explorer", source: "admin", fn: "init", args: { admin: "admin", max_events: 1000 } });
  b.step({ kind: "invoke", contract: "explorer", source: "admin", fn: "pause", args: { caller: "admin" } }).expect("explorer", "paused");
  b.step({ kind: "invoke", contract: "explorer", source: "admin", fn: "unpause", args: { caller: "admin" } }).expect("explorer", "unpaused");
}

function ticketFlow(b: WorkloadBuilder) {
  b.begin("ticket");
  if (!has(WASM.ticket)) return void b.skip("ticket WASM not built");
  b.step({ kind: "invoke", contract: "ticket", source: "admin", fn: "initialize", args: { admin: "admin", event_name: "Workload", max_tickets: 100, price: 10, max_resale_price: 20 } });
  b.step({ kind: "invoke", contract: "ticket", source: "admin", fn: "mint_ticket", args: { organizer: "admin", recipient: "alice" } });
}

function upgradeAndTtl(b: WorkloadBuilder) {
  b.begin("upgrade");
  if (has(WASM.upgradable)) {
    b.step({ kind: "deploy", alias: "upgradable", wasm: WASM.upgradable, source: "admin" });
    b.step({ kind: "upgrade", contract: "upgradable", wasm: WASM.upgradable, source: "admin" });
  } else b.skip("WORKLOAD_WASM_UPGRADABLE not set");

  b.begin("ttl-restore");
  if (!has(WASM.explorer)) return void b.skip("explorer WASM not built");
  b.step({ kind: "extend", contract: "explorer", source: "admin", ledgers: b.int(1_000, 5_000) });
  b.step({ kind: "restore", contract: "explorer", source: "admin" });
}

function feeBumpAndMultiAuth(b: WorkloadBuilder) {
  b.begin("fee-bump-multi-auth");
  // Sponsor pays the fee for alice's transfer; transfer_from needs both spender and owner authorisation.
  b.step({ kind: "invoke", contract: "usdc", source: "alice", fn: "transfer", args: { from: "alice", to: "carol", amount: 1_000 }, feeBump: "sponsor" }).expect("usdc", "transfer");
}

function optionalFleet(b: WorkloadBuilder) {
  const fleet: [string, string | undefined, string, Record<string, string | number>, string][] = [
    ["amm-swaps", WASM.amm, "swap", { to: "alice", amount: 1_000 }, "swap"],
    ["nft", WASM.nft, "mint", { to: "alice" }, "mint"],
    ["lending", WASM.lending, "deposit", { from: "alice", amount: 1_000 }, "deposit"],
    ["smart-wallet", WASM.wallet, "execute", { caller: "alice" }, "execute"],
  ];
  for (const [scenario, wasm, fn, args, event] of fleet) {
    b.begin(scenario);
    if (!has(wasm)) {
      b.skip(`WASM for ${scenario} not provided`);
      continue;
    }
    b.step({ kind: "deploy", alias: scenario, wasm, source: "admin" });
    b.step({ kind: "invoke", contract: scenario, source: "alice", fn, args }).expect(scenario, event);
  }
}

function burst(b: WorkloadBuilder) {
  b.begin("burst");
  const n = b.int(20, 40);
  for (let i = 0; i < n; i++) {
    b.step({ kind: "invoke", contract: "usdc", source: "admin", fn: "mint", args: { to: i % 2 ? "bob" : "carol", amount: b.int(1, 1_000) } });
  }
  b.expect("usdc", "mint", n);
}

export function buildWorkload(seed: number): Workload {
  const b = new WorkloadBuilder(seed);
  for (const scenario of [setup, tokenLifecycle, failures, explorerAbi, ticketFlow, upgradeAndTtl, feeBumpAndMultiAuth, optionalFleet, burst]) {
    scenario(b);
  }
  return b.build();
}
