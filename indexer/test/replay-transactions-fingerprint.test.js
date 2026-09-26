import { diffRows } from "../src/replay/diff.js";
import { digestRows } from "../src/replay/canonical.js";
import { calculateFeeBreakdown } from "../src/transactions.js";
import { classifyProtocol } from "../src/wasmFingerprint.js";

test("replay diffs are field-level and deterministic", () => {
  const before = [{ ledger: 1, description: "old" }];
  const after = [{ ledger: 1, description: "new" }];
  expect(diffRows(before, after).changed[0].fields.description).toEqual({ before: "old", after: "new" });
  expect(digestRows(after)).toBe(digestRows([{ description: "new", ledger: 1 }]));
});

test("fee breakdown exposes the charged fee", () => {
  expect(calculateFeeBreakdown({ inclusionFee: 2, resourceFee: 5, refundableFeeCharged: 3, refundAmount: 1 }).charged_fee).toBe(9);
});

test("fingerprint classifier respects confidence threshold", () => {
  const fingerprint = { simhash: "0".repeat(64) };
  expect(classifyProtocol({ fingerprint, labelled: [{ protocol_type: "token", simhash: "0".repeat(64) }] }).protocol_type_inferred).toBe("token");
});
