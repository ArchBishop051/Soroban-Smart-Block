// Issue #210: Advanced query language parser for sub-invocation search
// Supports 8+ filter types: of: depth: gas: fn: date: arg: reentrant: ledger: tx:

import type { SubInvocationFilter, SubInvocationExtended } from "../api";

export interface ParsedToken {
  key: string;
  op: "=" | ">" | "<" | ">=";
  value: string;
  raw: string;
}

const OPERATOR_RE = /^([a-z_]+):(>=|>|<)?(.+)$/;

export function parseQuery(query: string): SubInvocationFilter {
  const filter: SubInvocationFilter = {};
  const freeTerms: string[] = [];

  const tokens = query.trim().split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    const m = OPERATOR_RE.exec(token);
    if (!m) {
      if (token) freeTerms.push(token);
      continue;
    }

    const [, key, op = "=", value] = m;

    switch (key) {
      case "of":
        filter.contract = value;
        break;
      case "depth":
        if (op === ">") filter.depth_min = parseInt(value, 10) + 1;
        else if (op === ">=") filter.depth_min = parseInt(value, 10);
        else if (op === "<") filter.depth_max = parseInt(value, 10) - 1;
        else {
          const n = parseInt(value, 10);
          filter.depth_min = n;
          filter.depth_max = n;
        }
        break;
      case "gas":
        if (op === ">" || op === ">=") filter.gas_min = parseInt(value, 10);
        else if (op === "<") filter.gas_max = parseInt(value, 10);
        break;
      case "fn":
      case "function":
        filter.function = value;
        break;
      case "date": {
        if (value.includes("..")) {
          const [from, to] = value.split("..");
          filter.date_from = from;
          filter.date_to = to;
        } else {
          filter.date_from = value;
        }
        break;
      }
      case "arg":
        filter.arg_query = value;
        break;
      case "reentrant":
        filter.has_reentrancy = value === "true";
        break;
      case "ledger":
        if (op === ">" || op === ">=") filter.ledger_min = parseInt(value, 10);
        else if (op === "<") filter.ledger_max = parseInt(value, 10);
        break;
      case "tx":
        filter.tx_hash = value;
        break;
      default:
        freeTerms.push(token);
    }
  }

  if (freeTerms.length > 0) {
    const freeText = freeTerms.join(" ");
    filter.arg_query = filter.arg_query ? `${filter.arg_query} ${freeText}` : freeText;
  }

  return filter;
}

export function filterToQuery(filter: SubInvocationFilter): string {
  const parts: string[] = [];
  if (filter.contract) parts.push(`of:${filter.contract}`);
  if (filter.function) parts.push(`fn:${filter.function}`);
  if (filter.depth_min != null && filter.depth_min === filter.depth_max)
    parts.push(`depth:${filter.depth_min}`);
  else {
    if (filter.depth_min != null) parts.push(`depth:>=${filter.depth_min}`);
    if (filter.depth_max != null) parts.push(`depth:<${filter.depth_max + 1}`);
  }
  if (filter.gas_min != null) parts.push(`gas:>${filter.gas_min}`);
  if (filter.gas_max != null) parts.push(`gas:<${filter.gas_max}`);
  if (filter.date_from && filter.date_to) parts.push(`date:${filter.date_from}..${filter.date_to}`);
  else if (filter.date_from) parts.push(`date:${filter.date_from}`);
  if (filter.arg_query) parts.push(`arg:${filter.arg_query}`);
  if (filter.has_reentrancy != null) parts.push(`reentrant:${filter.has_reentrancy}`);
  if (filter.ledger_min != null) parts.push(`ledger:>=${filter.ledger_min}`);
  if (filter.ledger_max != null) parts.push(`ledger:<${filter.ledger_max}`);
  if (filter.tx_hash) parts.push(`tx:${filter.tx_hash}`);
  return parts.join(" ");
}

// ---- Local analytics helpers (work on already-fetched data) ---- //

export function computeMaxDepth(items: SubInvocationExtended[]): number {
  return items.reduce((m, s) => Math.max(m, s.depth), 0);
}

export function computeAvgDepth(items: SubInvocationExtended[]): number {
  if (!items.length) return 0;
  return items.reduce((s, i) => s + i.depth, 0) / items.length;
}

export function computeTopContracts(
  items: SubInvocationExtended[],
  limit = 10,
): { contract_id: string; call_count: number }[] {
  const counts = new Map<string, number>();
  for (const inv of items) {
    counts.set(inv.contract_id, (counts.get(inv.contract_id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([contract_id, call_count]) => ({ contract_id, call_count }));
}

export function computeDepthDistribution(
  items: SubInvocationExtended[],
): { depth: number; count: number }[] {
  const dist = new Map<number, number>();
  for (const inv of items) {
    dist.set(inv.depth, (dist.get(inv.depth) ?? 0) + 1);
  }
  return [...dist.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, count]) => ({ depth, count }));
}

export function detectReentrancy(items: SubInvocationExtended[]): SubInvocationExtended[] {
  // Reentrancy: same contract_id appears more than once in a call chain (same tx_hash)
  const byTx = new Map<string, SubInvocationExtended[]>();
  for (const inv of items) {
    const key = inv.parent_tx_hash;
    const bucket = byTx.get(key) ?? [];
    bucket.push(inv);
    byTx.set(key, bucket);
  }
  const reentrant: SubInvocationExtended[] = [];
  for (const [, chain] of byTx) {
    const seen = new Set<string>();
    for (const inv of chain) {
      if (seen.has(inv.contract_id)) {
        reentrant.push(...chain.filter((i) => i.contract_id === inv.contract_id));
        break;
      }
      seen.add(inv.contract_id);
    }
  }
  return reentrant;
}

export function buildDependencyMap(
  items: SubInvocationExtended[],
): Record<string, string[]> {
  const graph = new Map<string, Set<string>>();

  for (const inv of items) {
    if (!graph.has(inv.contract_id)) graph.set(inv.contract_id, new Set());
  }

  const byTx = new Map<string, SubInvocationExtended[]>();
  for (const inv of items) {
    const bucket = byTx.get(inv.parent_tx_hash) ?? [];
    bucket.push(inv);
    byTx.set(inv.parent_tx_hash, bucket);
  }

  for (const [, chain] of byTx) {
    const sorted = [...chain].sort((a, b) => a.depth - b.depth);
    for (let i = 1; i < sorted.length; i++) {
      const caller = sorted[i - 1].contract_id;
      const callee = sorted[i].contract_id;
      if (caller !== callee) {
        if (!graph.has(caller)) graph.set(caller, new Set());
        if (!graph.has(callee)) graph.set(callee, new Set());
        graph.get(caller)!.add(callee);
      }
    }
  }

  return Object.fromEntries(
    [...graph.entries()].map(([contractId, deps]) => [contractId, [...deps].sort()]),
  );
}

export function computeLongestChain(items: SubInvocationExtended[]): SubInvocationExtended[] {
  const byTx = new Map<string, SubInvocationExtended[]>();
  for (const inv of items) {
    const bucket = byTx.get(inv.parent_tx_hash) ?? [];
    bucket.push(inv);
    byTx.set(inv.parent_tx_hash, bucket);
  }
  let longest: SubInvocationExtended[] = [];
  for (const [, chain] of byTx) {
    if (chain.length > longest.length) longest = chain;
  }
  return longest.sort((a, b) => a.depth - b.depth);
}

export function clusterContracts(items: SubInvocationExtended[]): string[][] {
  // Simple clustering: group contracts that co-occur in same transactions
  const byTx = new Map<string, Set<string>>();
  for (const inv of items) {
    const s = byTx.get(inv.parent_tx_hash) ?? new Set<string>();
    s.add(inv.contract_id);
    byTx.set(inv.parent_tx_hash, s);
  }
  const clusters: string[][] = [];
  const assigned = new Set<string>();
  for (const [, contracts] of byTx) {
    const arr = [...contracts];
    const newOnes = arr.filter((c) => !assigned.has(c));
    if (newOnes.length > 1) {
      clusters.push(newOnes);
      newOnes.forEach((c) => assigned.add(c));
    }
  }
  return clusters;
}

export function fuzzyMatch(text: string, query: string): boolean {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.includes(q)) return true;
  // Simple fuzzy: all chars of query appear in order in text
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function matchesArgQuery(inv: SubInvocationExtended, query: string): boolean {
  if (!query) return true;
  const argsStr = JSON.stringify(inv.args ?? "").toLowerCase();
  const fnStr = inv.function.toLowerCase();
  const contractStr = inv.contract_id.toLowerCase();
  const q = query.toLowerCase();

  // Boolean operators: AND, OR
  if (q.includes(" or ")) {
    return q.split(" or ").some((part) => matchesArgQuery(inv, part.trim()));
  }
  if (q.includes(" and ")) {
    return q.split(" and ").every((part) => matchesArgQuery(inv, part.trim()));
  }

  // Number range: amount>100
  const rangeMatch = /^(\w+)([><=]+)(\d+)$/.exec(q);
  if (rangeMatch) {
    const [, field, op, val] = rangeMatch;
    const num = Number(val);
    const fieldRe = new RegExp(`"${field}"\\s*:\\s*([\\d.]+)`, "i");
    const fm = fieldRe.exec(argsStr);
    if (fm) {
      const v = Number(fm[1]);
      if (op === ">") return v > num;
      if (op === "<") return v < num;
      if (op === ">=") return v >= num;
      if (op === "==" || op === "=") return v === num;
    }
    return false;
  }

  return fuzzyMatch(argsStr, q) || fuzzyMatch(fnStr, q) || fuzzyMatch(contractStr, q);
}
