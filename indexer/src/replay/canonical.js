import crypto from "node:crypto";

export function canonicalize(value) {
  if (value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function rowKey(row, keys = ["ledger", "tx_hash", "contract_id", "id"]) {
  return keys.map((key) => `${key}=${canonicalJson(row?.[key])}`).join("|");
}

export function digestRows(rows) {
  const payload = rows.map((row) => canonicalJson(row)).sort().join("\n");
  return crypto.createHash("sha256").update(payload).digest("hex");
}
