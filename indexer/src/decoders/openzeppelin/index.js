/**
 * OpenZeppelin Stellar Contracts event decoders (#896).
 *
 * Event shapes are pinned to the OpenZeppelin `stellar-contracts` library
 * (OZ_SHAPES). Detection requires the full topic count, topic types and data
 * shape to match, so a non-OZ contract that merely reuses an event name
 * (e.g. "paused") is not claimed. SEP-41 fungible transfers/mints/burns have
 * the same shape in every implementation and stay with the generic SEP-41
 * decoder.
 *
 * Input: topics and data already converted with scValToNative (symbols and
 * addresses as strings, i128 as bigint, u32 as number).
 *
 * Returns { module, function, description, role?, pause?, nft? } or null.
 */

export const OZ_SHAPES = "openzeppelin/stellar-contracts v0.x";
/** Upper bound for expanding consecutive-mint ranges (holder tracking). */
export const MAX_CONSECUTIVE_EXPANSION = 1_000;

const isAddress = (v) => typeof v === "string" && /^[GC][A-Z2-7]{55}$/.test(v);
const isSymbol = (v) => typeof v === "string" && /^[A-Za-z0-9_]{1,32}$/.test(v);
const isU32 = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hasExactly = (obj, keys) => isObj(obj) && Object.keys(obj).length === keys.length && keys.every((k) => k in obj);
const short = (a) => (isAddress(a) ? `${a.slice(0, 4)}…${a.slice(-4)}` : String(a));

/** Expand a consecutive-mint range [from, to] into token ids, bounded. */
export function expandConsecutiveMint(from, to, max = MAX_CONSECUTIVE_EXPANSION) {
  if (!isU32(from) || !isU32(to) || to < from) return [];
  const count = Math.min(to - from + 1, max);
  return Array.from({ length: count }, (_, i) => from + i);
}

const DECODERS = [
  // ── Ownable ────────────────────────────────────────────────────────────────
  (t, d) =>
    t.length === 1 && t[0] === "ownership_transfer" && hasExactly(d, ["old_owner", "new_owner", "live_until_ledger"]) &&
    isAddress(d.old_owner) && isAddress(d.new_owner) && isU32(d.live_until_ledger) && {
      module: "ownable",
      function: "ownership_transfer",
      description: `Ownership transfer from ${short(d.old_owner)} to ${short(d.new_owner)} started (accept by ledger ${d.live_until_ledger})`,
    },
  (t, d) =>
    t.length === 1 && t[0] === "ownership_transfer_completed" && hasExactly(d, ["new_owner"]) && isAddress(d.new_owner) && {
      module: "ownable",
      function: "ownership_transfer_completed",
      description: `Ownership transferred to ${short(d.new_owner)}`,
      role: { role: "owner", address: d.new_owner, revoked: false },
    },
  (t, d) =>
    t.length === 1 && t[0] === "ownership_renounced" && hasExactly(d, ["old_owner"]) && isAddress(d.old_owner) && {
      module: "ownable",
      function: "ownership_renounced",
      description: `Ownership renounced by ${short(d.old_owner)}`,
      role: { role: "owner", address: d.old_owner, revoked: true },
    },

  // ── AccessControl ─────────────────────────────────────────────────────────
  (t, d) =>
    t.length === 3 && (t[0] === "role_granted" || t[0] === "role_revoked") && isSymbol(t[1]) && isAddress(t[2]) &&
    hasExactly(d, ["caller"]) && isAddress(d.caller) && {
      module: "access_control",
      function: t[0],
      description: `Role ${t[1]} ${t[0] === "role_granted" ? "granted to" : "revoked from"} ${short(t[2])} by ${short(d.caller)}`,
      role: { role: t[1].toLowerCase(), address: t[2], revoked: t[0] === "role_revoked" },
    },
  (t, d) =>
    t.length === 2 && t[0] === "role_admin_changed" && isSymbol(t[1]) &&
    hasExactly(d, ["previous_admin_role", "new_admin_role"]) && isSymbol(d.previous_admin_role) && isSymbol(d.new_admin_role) && {
      module: "access_control",
      function: "role_admin_changed",
      description: `Admin role for ${t[1]} changed from ${d.previous_admin_role} to ${d.new_admin_role}`,
    },
  (t, d) =>
    t.length === 1 && t[0] === "admin_transfer_initiated" && hasExactly(d, ["current_admin", "new_admin", "live_until_ledger"]) &&
    isAddress(d.current_admin) && isAddress(d.new_admin) && isU32(d.live_until_ledger) && {
      module: "access_control",
      function: "admin_transfer_initiated",
      description: `Admin transfer from ${short(d.current_admin)} to ${short(d.new_admin)} started (accept by ledger ${d.live_until_ledger})`,
    },
  (t, d) =>
    t.length === 1 && t[0] === "admin_transfer_completed" && hasExactly(d, ["new_admin"]) && isAddress(d.new_admin) && {
      module: "access_control",
      function: "admin_transfer_completed",
      description: `Admin role transferred to ${short(d.new_admin)}`,
      role: { role: "admin", address: d.new_admin, revoked: false },
    },

  // ── Pausable ──────────────────────────────────────────────────────────────
  (t, d) =>
    t.length === 1 && (t[0] === "paused" || t[0] === "unpaused") && hasExactly(d, ["caller"]) && isAddress(d.caller) && {
      module: "pausable",
      function: t[0],
      description: `Contract ${t[0]} by ${short(d.caller)}`,
      pause: { paused: t[0] === "paused" },
    },

  // ── Non-fungible (token ids are u32; SEP-41 amounts are i128/bigint) ─────
  (t, d) =>
    t.length === 3 && t[0] === "transfer" && isAddress(t[1]) && isAddress(t[2]) && isU32(d) && {
      module: "non_fungible",
      function: "transfer",
      description: `NFT #${d} transferred from ${short(t[1])} to ${short(t[2])}`,
      nft: { tokenIds: [d], to: t[2] },
    },
  (t, d) =>
    t.length === 2 && t[0] === "mint" && isAddress(t[1]) && isU32(d) && {
      module: "non_fungible",
      function: "mint_nft",
      description: `NFT #${d} minted to ${short(t[1])}`,
      nft: { tokenIds: [d], to: t[1] },
    },
  (t, d) =>
    t.length === 2 && t[0] === "burn" && isAddress(t[1]) && isU32(d) && {
      module: "non_fungible",
      function: "burn",
      description: `NFT #${d} burned by ${short(t[1])}`,
      nft: { tokenIds: [d], to: null },
    },
  (t, d) =>
    t.length === 2 && t[0] === "consecutive_mint" && isAddress(t[1]) &&
    hasExactly(d, ["from_token_id", "to_token_id"]) && isU32(d.from_token_id) && isU32(d.to_token_id) &&
    d.to_token_id >= d.from_token_id && {
      module: "non_fungible_consecutive",
      function: "mint_nft",
      description: `${d.to_token_id - d.from_token_id + 1} NFTs (#${d.from_token_id}–#${d.to_token_id}) minted to ${short(t[1])}`,
      nft: { tokenIds: expandConsecutiveMint(d.from_token_id, d.to_token_id), to: t[1] },
    },
];

/**
 * @param {unknown[]} topics native topics (topics[0] is the event name)
 * @param {unknown} data native event data
 */
export function decodeOpenZeppelinEvent(topics, data) {
  if (!Array.isArray(topics) || typeof topics[0] !== "string") return null;
  for (const decoder of DECODERS) {
    const result = decoder(topics, data);
    if (result) return result;
  }
  return null;
}
