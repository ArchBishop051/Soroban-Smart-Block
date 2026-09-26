import { decodeWithProtocol, protocolVersionFromLedger } from "../src/protocolReadiness.js";

test("unknown protocol arms are retained for deferred decoding", () => {
  expect(protocolVersionFromLedger({ protocolVersion: 23 })).toBe(23);
  const result = decodeWithProtocol(() => { throw new Error("unknown XDR arm"); }, { protocolVersion: 23, rawXdr: "fixture" });
  expect(result.degraded).toBe(true);
  expect(result.raw_xdr).toBe("fixture");
});
