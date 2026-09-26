/**
 * Smart-wallet (contract account) decoding (#898).
 *
 * - Detection: a contract whose ABI exposes `__check_auth` plus signer
 *   management functions, or that emits signer/policy events.
 * - Events: signer and policy add/update/remove events in two shapes seen in
 *   open-source wallets: a namespaced first topic (passkey-kit style,
 *   e.g. ["sw_v1", "add_signer", key]) and plain names (["signer_added", key]).
 * - Auth credentials: classify the signature an address credential carried
 *   (ed25519, secp256r1/WebAuthn, multi-signer) and parse WebAuthn
 *   clientDataJSON for the relying-party origin and challenge.
 *
 * The explorer shows what the chain accepted; it never re-verifies signatures.
 */

const SIGNER_FNS = ["add_signer", "remove_signer", "update_signer", "add_policy", "remove_policy"];

/** True if the contract ABI looks like a smart wallet. */
export function isSmartWalletAbi(functions = []) {
  const names = new Set(functions.map((f) => (typeof f === "string" ? f : f?.name)));
  return names.has("__check_auth") && SIGNER_FNS.some((n) => names.has(n));
}

const ACTIONS = {
  add_signer: ["signer", "added"],
  signer_added: ["signer", "added"],
  update_signer: ["signer", "updated"],
  set_signer: ["signer", "updated"],
  signer_updated: ["signer", "updated"],
  remove_signer: ["signer", "removed"],
  signer_removed: ["signer", "removed"],
  add_policy: ["policy", "added"],
  policy_added: ["policy", "added"],
  remove_policy: ["policy", "removed"],
  policy_removed: ["policy", "removed"],
};

/** Signer type from its native representation (enum variants decode as [Variant, ...]). */
function signerType(value) {
  const tag = Array.isArray(value) ? String(value[0]) : value && typeof value === "object" ? Object.keys(value)[0] : null;
  if (!tag) return "unknown";
  const t = tag.toLowerCase();
  if (t.includes("secp256r1") || t.includes("webauthn") || t.includes("passkey")) return "secp256r1";
  if (t.includes("ed25519")) return "ed25519";
  if (t.includes("policy")) return "policy";
  return t;
}

function findExpiration(value) {
  if (!value || typeof value !== "object") return null;
  for (const [k, v] of Object.entries(value)) {
    if (/expir/i.test(k) && (typeof v === "number" || typeof v === "string")) return Number(v);
    const nested = typeof v === "object" ? findExpiration(v) : null;
    if (nested !== null) return nested;
  }
  return null;
}

const keyId = (v) => (typeof v === "string" ? v : Array.isArray(v) ? String(v[1] ?? v[0]) : JSON.stringify(v ?? null)).slice(0, 128);

/**
 * Decode a smart-wallet signer/policy event from native topics/data.
 * @returns {{ subject: "signer"|"policy", action: "added"|"updated"|"removed", key: string, type: string, expiration: number|null, description: string } | null}
 */
export function decodeSmartWalletEvent(topics, data) {
  if (!Array.isArray(topics) || topics.length < 1) return null;
  // Namespaced (e.g. "sw_v1") or plain event name.
  const nameIdx = ACTIONS[String(topics[0])] ? 0 : topics.length > 1 && ACTIONS[String(topics[1])] ? 1 : -1;
  if (nameIdx < 0) return null;
  const [subject, action] = ACTIONS[String(topics[nameIdx])];
  const keyValue = topics[nameIdx + 1] ?? data;
  if (keyValue === undefined || keyValue === null) return null;
  const type = subject === "policy" ? "policy" : signerType(data ?? keyValue);
  const key = keyId(keyValue);
  const expiration = findExpiration(data);
  const shortKey = key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key;
  return {
    subject,
    action,
    key,
    type,
    expiration,
    description: `Smart wallet ${subject} ${shortKey}${type !== "unknown" && subject === "signer" ? ` (${type})` : ""} ${action}${expiration ? `, expires at ledger ${expiration}` : ""}`,
  };
}

/** Current signers/policies from a wallet's events (oldest first); remove then re-add is handled. */
export function deriveWalletState(decodedWalletEvents) {
  const signers = new Map();
  const policies = new Map();
  for (const e of decodedWalletEvents) {
    const map = e.subject === "policy" ? policies : signers;
    if (e.action === "removed") map.delete(e.key);
    else map.set(e.key, { key: e.key, type: e.type, expiration: e.expiration, since_ledger: e.ledger ?? null });
  }
  return { signers: [...signers.values()], policies: [...policies.values()] };
}

function toBuffer(v) {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === "string" && /^[A-Za-z0-9+/=]+$/.test(v)) return Buffer.from(v, "base64");
  return null;
}

/**
 * Classify the signature carried by an address credential (native ScVal).
 * @returns {{ type: string, key_id?: string, webauthn?: { type: string, origin: string, challenge: string } | null, signers?: number }}
 */
export function classifyCredentialSignature(signature) {
  if (signature === null || signature === undefined) return { type: "none" };
  if (Array.isArray(signature)) {
    // Vec of signatures: multi-signer auth; classify each.
    return { type: "multi", signers: signature.length, parts: signature.map(classifyCredentialSignature) };
  }
  const buf = toBuffer(signature);
  if (buf) return { type: buf.length === 64 ? "ed25519" : "bytes", length: buf.length };
  if (typeof signature === "object") {
    const keys = Object.keys(signature);
    const cdj = signature.client_data_json ?? signature.clientDataJSON;
    if (cdj !== undefined && (signature.authenticator_data !== undefined || signature.authenticatorData !== undefined)) {
      let webauthn = null;
      const raw = toBuffer(cdj);
      try {
        const parsed = JSON.parse((raw ?? Buffer.from(String(cdj))).toString("utf8"));
        webauthn = { type: String(parsed.type ?? ""), origin: String(parsed.origin ?? ""), challenge: String(parsed.challenge ?? "") };
      } catch {
        webauthn = null;
      }
      const id = signature.id ?? signature.key_id;
      return { type: "secp256r1", ...(id !== undefined ? { key_id: keyId(id) } : {}), webauthn };
    }
    if (keys.length === 1) return { ...classifyCredentialSignature(signature[keys[0]]), variant: keys[0] };
  }
  return { type: "unknown" };
}
