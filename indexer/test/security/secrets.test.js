import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { encryptSecret, decryptSecret, rewrapSecret, isEncrypted, _setKeksForTest } from "../../src/secrets/index.js";

const k1 = crypto.randomBytes(32).toString("base64");
const k2 = crypto.randomBytes(32).toString("base64");

test("a simulated DB dump contains no plaintext webhook secrets", () => {
  _setKeksForTest({ SECRETS_KEK: k1 });
  const secrets = ["whsec_alpha_0123456789", "whsec_beta_abcdef"];
  const dump = secrets.map((s, i) => `INSERT INTO webhook_subscriptions (id, secret) VALUES (${i}, '${encryptSecret(s)}');`).join("\n");
  for (const s of secrets) assert.equal(dump.includes(s), false);
});

test("round-trips, passes legacy plaintext through, and survives KEK rotation", () => {
  _setKeksForTest({ SECRETS_KEK: k1 });
  const sealed = encryptSecret("s3cret");
  assert.ok(isEncrypted(sealed));
  assert.equal(decryptSecret(sealed), "s3cret");
  assert.equal(decryptSecret("legacy-plain"), "legacy-plain");

  _setKeksForTest({ SECRETS_KEK: k2, SECRETS_KEK_PREVIOUS: k1 });
  assert.equal(decryptSecret(sealed), "s3cret");
  const rewrapped = rewrapSecret(sealed);
  assert.notEqual(rewrapped, sealed);
  assert.equal(rewrapSecret(rewrapped), rewrapped);

  _setKeksForTest({ SECRETS_KEK: k2 });
  assert.equal(decryptSecret(rewrapped), "s3cret");
  assert.throws(() => decryptSecret(sealed));
});
