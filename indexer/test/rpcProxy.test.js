import test from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_RPC_METHODS, proxyRpcRequest, singleFlight } from "../src/rpcProxy.js";

test("coalesces concurrent identical RPC work", async () => {
  let calls = 0;
  const load = () => singleFlight("rpc-test", async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { value: 1 };
  });
  const [first, second] = await Promise.all([load(), load()]);
  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
  assert.equal(calls, 1);
});

test("does not allow transaction submission through the RPC proxy", async () => {
  assert.equal(ALLOWED_RPC_METHODS.has("sendTransaction"), false);
  await assert.rejects(proxyRpcRequest("sendTransaction", {}), { statusCode: 403 });
});

test("requires bounded ledger-entry requests", async () => {
  await assert.rejects(proxyRpcRequest("getLedgerEntries", { keys: [] }), { statusCode: 400 });
});

test("requires a starting ledger for event queries", async () => {
  await assert.rejects(proxyRpcRequest("getEvents", {}), { statusCode: 400 });
});
