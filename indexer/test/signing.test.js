import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { canonicalize, loadSigningKeys, publishedKeys, signEnvelope, verifyEnvelope } from "../src/signing.js";

const seed = () => crypto.randomBytes(32).toString("base64");

// RFC 8785 §3.2.2 — serialization of primitives.
test("JCS: RFC 8785 primitive vector", () => {
  const input = JSON.parse(
    '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
      '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
  );
  assert.equal(
    canonicalize(input),
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
      '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  );
});

// RFC 8785 §3.2.3 — property sorting by UTF-16 code units.
test("JCS: RFC 8785 sorting vector", () => {
  const input = JSON.parse(
    '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh",' +
      '"1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control",' +
      '"\\u00f6":"Latin Small Letter O With Diaeresis"}',
  );
  assert.equal(
    canonicalize(input),
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control",' +
      '"ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign",' +
      '"😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
  );
});

test("JCS: bigint amounts serialize as decimal strings", () => {
  assert.equal(canonicalize({ amount: 170141183460469231731687303715884105727n }), '{"amount":"170141183460469231731687303715884105727"}');
});

test("sign in the API, verify with published keys", () => {
  const keys = loadSigningKeys({ EXPLORER_SIGNING_KEY: seed() });
  const envelope = JSON.parse(JSON.stringify(signEnvelope({ data: [{ seq: 1, amount: 10n }] }, 123, keys)));
  assert.deepEqual(verifyEnvelope(envelope, publishedKeys(keys)), { valid: true, status: "active" });
  assert.equal(envelope.ledger, 123);
});

test("tampering with any field fails verification", () => {
  const keys = loadSigningKeys({ EXPLORER_SIGNING_KEY: seed() });
  const published = publishedKeys(keys);
  const envelope = signEnvelope({ data: [{ seq: 1, description: "swap" }] }, 5, keys);
  for (const mutate of [
    (e) => (e.payload.data[0].seq = 2),
    (e) => (e.payload.data[0].description = "swaq"),
    (e) => (e.ledger = 6),
    (e) => (e.issued_at = new Date(0).toISOString()),
    (e) => (e.signature = e.signature.slice(0, -2) + (e.signature.endsWith("AA") ? "AB" : "AA")),
  ]) {
    const copy = structuredClone(envelope);
    mutate(copy);
    assert.equal(verifyEnvelope(copy, published).valid, false);
  }
});

test("retired key verifies as retired; unknown key is distinguished", () => {
  const old = loadSigningKeys({ EXPLORER_SIGNING_KEY: seed(), EXPLORER_SIGNING_KEY_ID: "k1" });
  const envelope = signEnvelope({ ok: true }, 1, old);
  const rotated = loadSigningKeys({
    EXPLORER_SIGNING_KEY: seed(),
    EXPLORER_SIGNING_KEY_ID: "k2",
    EXPLORER_RETIRED_SIGNING_KEYS: JSON.stringify([{ key_id: "k1", public_key: old.active.publicKey, not_after: "2030-01-01T00:00:00Z" }]),
  });
  assert.deepEqual(verifyEnvelope(envelope, publishedKeys(rotated)), { valid: true, status: "retired" });
  assert.deepEqual(verifyEnvelope(envelope, { keys: [] }), { valid: false, status: "unknown_key" });
});

test("signing overhead stays under 1 ms for a typical page", () => {
  const keys = loadSigningKeys({ EXPLORER_SIGNING_KEY: seed() });
  const page = { data: Array.from({ length: 20 }, (_, i) => ({ seq: i, contract_id: "C".repeat(56), description: "x".repeat(80) })) };
  signEnvelope(page, 1, keys); // warm up
  const start = process.hrtime.bigint();
  for (let i = 0; i < 100; i++) signEnvelope(page, 1, keys);
  const perCallMs = Number(process.hrtime.bigint() - start) / 1e6 / 100;
  assert.ok(perCallMs < 1, `signing took ${perCallMs.toFixed(3)} ms`);
});
