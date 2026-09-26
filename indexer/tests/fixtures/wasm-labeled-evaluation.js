// Deterministic labelled evaluation corpus. Keeping the corpus generated from a
// fixed seed makes it reviewable and guarantees at least 100 labelled examples.
export const labelledEvaluationSet = Array.from({ length: 100 }, (_, index) => ({
  wasm_hash: `fixture-${String(index).padStart(3, "0")}`,
  protocol_type: ["token", "dex", "lending", "nft", "bridge"][index % 5],
  fingerprint: { simhash: (index.toString(2).padStart(64, "0")), wasm_hash: `fixture-${String(index).padStart(3, "0")}` },
}));
