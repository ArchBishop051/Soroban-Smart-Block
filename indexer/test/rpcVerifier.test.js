import { canonicalDigest, verifyRpcRange } from "../src/rpcVerifier.js";

test("quorum selects the majority response and exposes a stable digest", async () => {
  const events = [{ id: "1", ledger: 10, xdr: "a" }];
  const result = await verifyRpcRange({ mode: "quorum", quorum: 2, request: {}, providers: [async () => events, async () => events, async () => [{ id: "1", ledger: 10, xdr: "tampered" }]] });
  expect(result.events).toEqual(events);
  expect(result.dissenting).toBe(1);
  expect(canonicalDigest(events)).toHaveLength(64);
});
