/**
 * Transaction narrative engine (#897).
 *
 * Turns all decoded events of one transaction into a structured summary:
 *   { actor, action, protocol, assets_in[], assets_out[], counterparties[],
 *     sentence, rule, net_flows }
 *
 * Asset movements are normalised from SEP-41 / SAC transfer, mint and burn
 * events. Rule packs then look for a pattern; each rule checks its required
 * evidence and returns null when anything is ambiguous, so the engine falls
 * back to a plain net-flow summary instead of producing a wrong narrative.
 */

import { formatAmount } from "../formatAmount.js";

const ADDR = /^[GC][A-Z2-7]{55}$/;
const short = (a) => (a && ADDR.test(a) ? `${a.slice(0, 4)}…${a.slice(-4)}` : String(a));

function parseData(raw) {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toBigInt(v) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  if (v && typeof v === "object" && "amount" in v) return toBigInt(v.amount);
  return null;
}

/**
 * Normalise token movements. Returns [{ asset, from, to, amount }], with
 * from = null for mints and to = null for burns.
 */
export function extractMovements(events) {
  const moves = [];
  for (const ev of events) {
    const topics = Array.isArray(ev.raw_topics) ? ev.raw_topics : [];
    const name = String(topics[0] ?? ev.function ?? "");
    const amount = toBigInt(parseData(ev.raw_data));
    if (amount === null || amount <= 0n) continue;
    const addrs = topics.slice(1).filter((t) => typeof t === "string" && ADDR.test(t));
    if (name === "transfer" && addrs.length >= 2) moves.push({ asset: ev.contract_id, from: addrs[0], to: addrs[1], amount });
    else if (name === "mint" && addrs.length >= 1) moves.push({ asset: ev.contract_id, from: null, to: addrs[addrs.length - 1], amount });
    else if ((name === "burn" || name === "clawback") && addrs.length >= 1) moves.push({ asset: ev.contract_id, from: addrs[addrs.length - 1], to: null, amount });
  }
  return moves;
}

/**
 * Per-asset, per-address balance deltas. For every asset the deltas sum to
 * minted − burned (the net-flow invariant).
 * @returns {Record<string, Record<string, bigint>>}
 */
export function netFlows(moves) {
  const flows = {};
  const add = (asset, addr, delta) => {
    flows[asset] ??= {};
    flows[asset][addr] = (flows[asset][addr] ?? 0n) + delta;
  };
  for (const m of moves) {
    if (m.from) add(m.asset, m.from, -m.amount);
    if (m.to) add(m.asset, m.to, m.amount);
  }
  return flows;
}

function deltasFor(flows, addr) {
  const out = [];
  for (const [asset, byAddr] of Object.entries(flows)) {
    const d = byAddr[addr] ?? 0n;
    if (d !== 0n) out.push({ asset, delta: d });
  }
  return out;
}

const fmt = (amount, asset, decimals) => `${formatAmount((amount < 0n ? -amount : amount).toString(), decimals[asset] ?? 7)} ${short(asset)}`;
const participants = (flows) => [...new Set(Object.values(flows).flatMap((b) => Object.keys(b)))];

// ── Rule packs ───────────────────────────────────────────────────────────────
// Each rule: (ctx) => narrative fields or null (evidence missing/ambiguous).

const RULES = [
  // Lending (Blend-style function names are the evidence).
  function lending({ events }) {
    const fns = new Set(events.map((e) => e.function));
    const action = ["liquidate", "repay", "borrow", "supply"].find((a) => fns.has(a));
    if (!action) return null;
    const ev = events.find((e) => e.function === action);
    return { action, protocol: "lending", actor: null, sentence: `${action} on ${short(ev.contract_id)}` };
  },

  // NFT mint / transfer (u32 token ids, emitted as mint_nft / transfer).
  function nft({ events }) {
    const nftEvents = events.filter((e) => {
      const d = parseData(e.raw_data);
      return (e.function === "mint_nft" || e.function === "transfer") && Number.isInteger(d) && d >= 0 && d <= 0xffffffff;
    });
    if (nftEvents.length !== 1 || events.length !== 1) return null;
    const e = nftEvents[0];
    const tokenId = parseData(e.raw_data);
    const to = e.raw_topics[e.raw_topics.length - 1];
    return e.function === "mint_nft"
      ? { action: "nft_mint", protocol: "nft", actor: to, sentence: `${short(to)} received newly minted NFT #${tokenId} from ${short(e.contract_id)}` }
      : { action: "nft_transfer", protocol: "nft", actor: e.raw_topics[1], sentence: `${short(e.raw_topics[1])} sent NFT #${tokenId} to ${short(to)}` };
  },

  // Contract upgrade.
  function upgrade({ events }) {
    const ev = events.find((e) => e.upgrade_info || e.function === "upgrade" || e.function === "upgraded");
    if (!ev) return null;
    return { action: "upgrade", protocol: "contract", actor: null, sentence: `Contract ${short(ev.contract_id)} was upgraded` };
  },

  // Swap (single or multi-hop): exactly one participant pays one asset and
  // receives a different one; intermediate hops net out in pools.
  // Evidence: the sender of the first movement pays one asset and receives
  // another, and every other such participant is a contract (a pool).
  function swap({ flows, moves, decimals }) {
    const candidates = participants(flows).filter((addr) => {
      const d = deltasFor(flows, addr);
      return d.length === 2 && d.some((x) => x.delta < 0n) && d.some((x) => x.delta > 0n);
    });
    const actor = moves[0]?.from;
    if (!actor || !candidates.includes(actor)) return null;
    const pools = candidates.filter((a) => a !== actor);
    if (!pools.every((a) => a.startsWith("C"))) return null;
    const d = deltasFor(flows, actor);
    const out = d.find((x) => x.delta < 0n);
    const inn = d.find((x) => x.delta > 0n);
    const counterparties = participants(flows).filter((a) => a !== actor);
    return {
      action: "swap",
      protocol: "amm",
      actor,
      assets_out: [{ asset: out.asset, amount: (-out.delta).toString() }],
      assets_in: [{ asset: inn.asset, amount: inn.delta.toString() }],
      counterparties,
      sentence: `${short(actor)} swapped ${fmt(out.delta, out.asset, decimals)} for ${fmt(inn.delta, inn.asset, decimals)}${pools.length > 1 ? ` via ${pools.length} hops` : ""}`,
    };
  },

  // Liquidity add/remove: two assets one way, a minted/burned LP token the other.
  function liquidity({ flows, moves, decimals }) {
    for (const actor of participants(flows)) {
      const d = deltasFor(flows, actor);
      if (d.length !== 3) continue;
      const lp = d.find((x) => moves.some((m) => m.asset === x.asset && (m.from === null || m.to === null)));
      if (!lp) continue;
      const others = d.filter((x) => x !== lp);
      const adding = lp.delta > 0n && others.every((x) => x.delta < 0n);
      const removing = lp.delta < 0n && others.every((x) => x.delta > 0n);
      if (!adding && !removing) continue;
      const pair = others.map((x) => fmt(x.delta, x.asset, decimals)).join(" and ");
      return {
        action: adding ? "liquidity_add" : "liquidity_remove",
        protocol: "amm",
        actor,
        sentence: adding ? `${short(actor)} added liquidity: ${pair}` : `${short(actor)} removed liquidity: ${pair}`,
      };
    }
    return null;
  },

  // Plain transfer / mint / burn (single movement).
  function transfer({ moves, decimals }) {
    if (moves.length !== 1) return null;
    const m = moves[0];
    if (!m.from) return { action: "mint", protocol: "token", actor: m.to, sentence: `${fmt(m.amount, m.asset, decimals)} minted to ${short(m.to)}` };
    if (!m.to) return { action: "burn", protocol: "token", actor: m.from, sentence: `${short(m.from)} burned ${fmt(m.amount, m.asset, decimals)}` };
    return { action: "transfer", protocol: "token", actor: m.from, counterparties: [m.to], sentence: `${short(m.from)} sent ${fmt(m.amount, m.asset, decimals)} to ${short(m.to)}` };
  },
];

/**
 * Build the narrative for one transaction.
 * @param {object[]} events decoded events of the transaction (any order)
 * @param {{ failed?: boolean, error?: string, decimals?: Record<string, number> }} [opts]
 */
export function buildNarrative(events, { failed = false, error = null, decimals = {} } = {}) {
  const moves = extractMovements(events);
  const flows = netFlows(moves);
  const net_flows = Object.fromEntries(
    Object.entries(flows).map(([asset, byAddr]) => [asset, Object.fromEntries(Object.entries(byAddr).map(([a, d]) => [a, d.toString()]))]),
  );
  const base = { actor: null, action: null, protocol: null, assets_in: [], assets_out: [], counterparties: [], net_flows };

  if (failed) {
    const first = events[0];
    const what = first ? `${first.function} on ${short(first.contract_id)}` : "a transaction";
    return { ...base, action: "failed", rule: "failed", sentence: `Attempted ${what}, failed${error ? `: ${error}` : ""}` };
  }

  for (const rule of RULES) {
    const result = rule({ events, moves, flows, decimals });
    if (result) return { ...base, ...result, rule: rule.name };
  }

  // Fallback: what each participant gained or lost.
  const parts = participants(flows)
    .map((addr) => {
      const d = deltasFor(flows, addr);
      if (!d.length) return null;
      return `${short(addr)} ${d.map((x) => `${x.delta > 0n ? "+" : "−"}${fmt(x.delta, x.asset, decimals)}`).join(", ")}`;
    })
    .filter(Boolean);
  return {
    ...base,
    action: "net_flows",
    rule: "net_flows",
    sentence: parts.length ? `Net flows: ${parts.join("; ")}` : `${events.length} event(s), no asset movements`,
  };
}
