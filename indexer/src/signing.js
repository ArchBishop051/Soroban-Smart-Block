/**
 * Verifiable API responses (#904).
 *
 * `?signed=1` (or `Accept: application/vnd.soroban-explorer.signed+json`)
 * wraps a JSON response in an envelope:
 *
 *   { payload, ledger, issued_at, key_id, signature }
 *
 * `signature` is Ed25519 (base64url) over the RFC 8785 (JCS) canonical JSON
 * of `{ payload, ledger, issued_at, key_id }`.
 *
 * Keys come from the environment, which is populated from KMS / Vault at
 * deploy time — they are never read from a file on disk:
 *
 *   EXPLORER_SIGNING_KEY          base64 32-byte Ed25519 seed (active key)
 *   EXPLORER_SIGNING_KEY_ID       optional id (default: first 16 hex chars
 *                                 of sha256(public key))
 *   EXPLORER_SIGNING_KEY_NOT_BEFORE  optional ISO date the key became active
 *   EXPLORER_RETIRED_SIGNING_KEYS JSON array of
 *                                 { key_id, public_key, not_before?, not_after }
 *                                 kept published during rotation overlap
 *
 * Public keys are published at `/.well-known/explorer-keys.json`.
 */

import crypto from "crypto";

export const SIGNED_MEDIA_TYPE = "application/vnd.soroban-explorer.signed+json";

// DER prefix turning a raw 32-byte Ed25519 seed into a PKCS#8 private key.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
// DER prefix turning a raw 32-byte Ed25519 public key into SPKI.
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * RFC 8785 JSON Canonicalization Scheme.
 *
 * Object keys are sorted by UTF-16 code units and primitives are serialized
 * with ECMAScript `JSON.stringify`, as the RFC specifies. BigInt values
 * (i128 / u64 amounts) are serialized as decimal strings so large numbers are
 * never ambiguous.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JCS: non-finite numbers are not allowed");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined || typeof v === "function" ? "null" : canonicalize(v))).join(",")}]`;
  }
  if (typeof value === "object") {
    if (typeof value.toJSON === "function") return canonicalize(value.toJSON());
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined && typeof value[k] !== "function")
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  throw new TypeError(`JCS: unsupported type ${typeof value}`);
}

function rawPublicKey(publicKey) {
  return publicKey.export({ format: "der", type: "spki" }).subarray(-32);
}

function publicKeyFromRaw(b64) {
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(b64, "base64")]),
    format: "der",
    type: "spki",
  });
}

/**
 * Load the active signing key and retired public keys from the environment.
 * Returns `{ active: null, retired: [] }` when signing is not configured.
 */
export function loadSigningKeys(env = process.env) {
  let active = null;
  if (env.EXPLORER_SIGNING_KEY) {
    const seed = Buffer.from(env.EXPLORER_SIGNING_KEY, "base64");
    if (seed.length !== 32) throw new Error("EXPLORER_SIGNING_KEY must be a base64 32-byte Ed25519 seed");
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
      format: "der",
      type: "pkcs8",
    });
    const publicRaw = rawPublicKey(crypto.createPublicKey(privateKey));
    active = {
      keyId:
        env.EXPLORER_SIGNING_KEY_ID ||
        crypto.createHash("sha256").update(publicRaw).digest("hex").slice(0, 16),
      privateKey,
      publicKey: publicRaw.toString("base64"),
      notBefore: env.EXPLORER_SIGNING_KEY_NOT_BEFORE || null,
    };
  }
  const retired = env.EXPLORER_RETIRED_SIGNING_KEYS ? JSON.parse(env.EXPLORER_RETIRED_SIGNING_KEYS) : [];
  return { active, retired };
}

/** Body of `/.well-known/explorer-keys.json`. */
export function publishedKeys({ active, retired }) {
  const keys = [];
  if (active) {
    keys.push({
      key_id: active.keyId,
      alg: "Ed25519",
      public_key: active.publicKey,
      status: "active",
      not_before: active.notBefore,
      not_after: null,
    });
  }
  for (const k of retired) {
    keys.push({
      key_id: k.key_id,
      alg: "Ed25519",
      public_key: k.public_key,
      status: "retired",
      not_before: k.not_before ?? null,
      not_after: k.not_after ?? null,
    });
  }
  return { keys };
}

/**
 * Wrap `payload` in a signed envelope bound to `ledger`.
 * @param {unknown} payload
 * @param {number|null} ledger  last indexed ledger when the payload was computed
 * @param {{ active: object }} keys
 */
export function signEnvelope(payload, ledger, { active }, now = new Date()) {
  if (!active) throw new Error("Response signing is not configured");
  const unsigned = {
    payload: JSON.parse(canonicalize(payload)),
    ledger: ledger ?? null,
    issued_at: now.toISOString(),
    key_id: active.keyId,
  };
  const signature = crypto.sign(null, Buffer.from(canonicalize(unsigned)), active.privateKey);
  return { ...unsigned, signature: signature.toString("base64url") };
}

/**
 * Verify an envelope against published keys (`{ keys: [...] }`).
 *
 * @returns {{ valid: boolean, status: "active" | "retired" | "unknown_key" | "invalid" }}
 *   `retired` = the signature is valid but was made with a retired key.
 */
export function verifyEnvelope(envelope, published) {
  const { signature, ...unsigned } = envelope ?? {};
  const key = (published?.keys ?? []).find((k) => k.key_id === unsigned.key_id);
  if (!key) return { valid: false, status: "unknown_key" };
  let ok = false;
  try {
    ok = crypto.verify(
      null,
      Buffer.from(canonicalize(unsigned)),
      publicKeyFromRaw(key.public_key),
      Buffer.from(String(signature), "base64url"),
    );
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, status: "invalid" };
  return { valid: true, status: key.status === "retired" ? "retired" : "active" };
}

/** True when the request asks for a signed envelope. */
export function wantsSignedResponse(req) {
  return req.query?.signed === "1" || (req.get?.("accept") || "").includes(SIGNED_MEDIA_TYPE);
}
