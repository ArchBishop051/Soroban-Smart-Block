/**
 * Secrets provider + envelope encryption (#929).
 *
 * Providers (SECRETS_PROVIDER):
 *   env   — (default, dev only) reads secrets from process.env.
 *   vault — HashiCorp Vault KV v2 at VAULT_ADDR / VAULT_TOKEN / VAULT_SECRET_PATH.
 *
 * Envelope encryption for secrets stored in Postgres (webhook secrets etc.):
 * each value gets a random 256-bit data key (DEK); the value is sealed with
 * AES-256-GCM under the DEK, and the DEK is wrapped under the key-encryption
 * key (KEK). The stored string carries the KEK version so old ciphertext stays
 * decryptable during rotation:
 *
 *   enc:v1:<kekVersion>:<wrappedDek>:<iv>:<tag>:<ciphertext>   (base64 fields)
 *
 * KEKs come from SECRETS_KEK (current) and SECRETS_KEK_PREVIOUS (comma
 * separated, still decryptable), each base64 of 32 bytes — or the same keys
 * under the Vault secret. With no KEK configured (local dev) values are stored
 * as-is so development keeps working with zero cloud dependencies.
 */
import crypto from "crypto";
import { logger } from "../logger.js";

const PREFIX = "enc:v1:";
/** How long fetched secrets remain usable if the provider becomes unreachable. */
const CACHE_TTL_MS = Number(process.env.SECRETS_CACHE_TTL_MS ?? 15 * 60 * 1000);

let secrets = {};
let fetchedAt = 0;
let keks = new Map(); // version -> Buffer
let currentKekVersion = null;

function kekVersion(key) {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
}

async function fetchVault() {
  const addr = process.env.VAULT_ADDR;
  const token = process.env.VAULT_TOKEN;
  const path = process.env.VAULT_SECRET_PATH ?? "secret/data/soroban-indexer";
  if (!addr || !token) throw new Error("SECRETS_PROVIDER=vault requires VAULT_ADDR and VAULT_TOKEN");
  const res = await fetch(`${addr.replace(/\/$/, "")}/v1/${path}`, {
    headers: { "X-Vault-Token": token },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Vault responded ${res.status} for ${path}`);
  const body = await res.json();
  return body?.data?.data ?? {};
}

function loadKeks(source) {
  const next = new Map();
  let current = null;
  const all = [source.SECRETS_KEK, ...String(source.SECRETS_KEK_PREVIOUS ?? "").split(",")]
    .map((k) => (k ?? "").trim())
    .filter(Boolean);
  for (const b64 of all) {
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) throw new Error("SECRETS_KEK values must be base64-encoded 32-byte keys");
    const v = kekVersion(key);
    next.set(v, key);
    current ??= v;
  }
  keks = next;
  currentKekVersion = current;
}

/** Fetch secrets from the configured provider. Throws (fail fast) on boot errors. */
export async function initSecrets() {
  const provider = process.env.SECRETS_PROVIDER ?? "env";
  if (provider === "env") {
    if (process.env.NODE_ENV === "production" && !process.env.SECRETS_KEK) {
      logger.warn("[secrets] env provider in production without SECRETS_KEK — DB secrets stored unencrypted");
    }
    secrets = { ...process.env };
  } else if (provider === "vault") {
    secrets = await fetchVault();
  } else {
    throw new Error(`Unknown SECRETS_PROVIDER "${provider}"`);
  }
  fetchedAt = Date.now();
  loadKeks({ ...process.env, ...secrets });
}

/** Re-fetch secrets (on rotation). Keeps cached values within CACHE_TTL_MS if the provider is down. */
export async function refreshSecrets() {
  try {
    await initSecrets();
  } catch (err) {
    if (Date.now() - fetchedAt > CACHE_TTL_MS) throw err;
    logger.warn(`[secrets] refresh failed, using cached secrets: ${err.message}`);
  }
}

export function getSecret(name) {
  return secrets[name] ?? process.env[name];
}

export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

function gcm(mode, key, iv, input, tag) {
  const c = mode === "enc" ? crypto.createCipheriv("aes-256-gcm", key, iv) : crypto.createDecipheriv("aes-256-gcm", key, iv);
  if (tag) c.setAuthTag(tag);
  const out = Buffer.concat([c.update(input), c.final()]);
  return mode === "enc" ? { out, tag: c.getAuthTag() } : { out };
}

/** Seal `plaintext` under a fresh DEK wrapped by the current KEK. No KEK → returned unchanged (dev). */
export function encryptSecret(plaintext) {
  if (plaintext == null || !currentKekVersion) return plaintext;
  const kek = keks.get(currentKekVersion);
  const dek = crypto.randomBytes(32);
  const dekIv = crypto.randomBytes(12);
  const wrapped = gcm("enc", kek, dekIv, dek);
  const iv = crypto.randomBytes(12);
  const sealed = gcm("enc", dek, iv, Buffer.from(String(plaintext), "utf8"));
  const wrappedDek = Buffer.concat([dekIv, wrapped.tag, wrapped.out]).toString("base64");
  return `${PREFIX}${currentKekVersion}:${wrappedDek}:${iv.toString("base64")}:${sealed.tag.toString("base64")}:${sealed.out.toString("base64")}`;
}

function unwrapDek(version, wrappedDek) {
  const kek = keks.get(version);
  if (!kek) throw new Error(`No KEK loaded for version ${version}`);
  const buf = Buffer.from(wrappedDek, "base64");
  return gcm("dec", kek, buf.subarray(0, 12), buf.subarray(28), buf.subarray(12, 28)).out;
}

/** Open a value produced by encryptSecret. Legacy plaintext values pass through unchanged. */
export function decryptSecret(value) {
  if (!isEncrypted(value)) return value;
  const [version, wrappedDek, iv, tag, ct] = value.slice(PREFIX.length).split(":");
  const dek = unwrapDek(version, wrappedDek);
  return gcm("dec", dek, Buffer.from(iv, "base64"), Buffer.from(ct, "base64"), Buffer.from(tag, "base64")).out.toString("utf8");
}

/** Re-wrap a value under the current KEK (or encrypt legacy plaintext). Idempotent. */
export function rewrapSecret(value) {
  if (value == null || !currentKekVersion) return value;
  if (isEncrypted(value) && value.slice(PREFIX.length).startsWith(`${currentKekVersion}:`)) return value;
  return encryptSecret(decryptSecret(value));
}

/**
 * Key rotation job: re-wrap every webhook secret under the current KEK.
 * Processes rows one at a time and only touches rows not yet on the current
 * version, so a crash mid-rotation is resumed by simply running it again.
 */
export async function rotateWebhookSecrets(pool) {
  if (!currentKekVersion) return 0;
  const { rows } = await pool.query(
    `SELECT id, secret FROM webhook_subscriptions WHERE secret IS NOT NULL AND secret NOT LIKE $1`,
    [`${PREFIX}${currentKekVersion}:%`],
  );
  for (const row of rows) {
    await pool.query(`UPDATE webhook_subscriptions SET secret = $1 WHERE id = $2 AND secret = $3`, [
      rewrapSecret(row.secret),
      row.id,
      row.secret,
    ]);
  }
  return rows.length;
}

/** Test hook: load KEKs directly. */
export function _setKeksForTest(source) {
  loadKeks(source);
}
