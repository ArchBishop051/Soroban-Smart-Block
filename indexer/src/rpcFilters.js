/**
 * Soroban-RPC-compatible event filters (#903).
 *
 * Accepts the `getEvents` `filters` shape verbatim:
 *
 *   [{ type?: "contract"|"system"|"diagnostic", contractIds?: string[], topics?: string[][] }]
 *
 * Each topic segment is a base64 XDR ScVal, "*" (exactly one segment) or,
 * as the last segment only, "**" (zero or more remaining segments). Topics
 * are compared on canonical XDR bytes (sha256), so an ScVal symbol and a
 * string with the same text are distinct. An event matches if it matches
 * any filter; within a filter, contractIds and topics must both match
 * (empty = any). The explorer indexes contract events only, so filters for
 * "system" or "diagnostic" events match nothing.
 *
 * Limits follow Soroban RPC: at most 5 filters, 5 contract IDs and 5 topic
 * patterns per filter, and 4 segments per pattern (plus a trailing "**").
 */

import crypto from "crypto";
import { xdr } from "@stellar/stellar-sdk";

export const RPC_FILTER_LIMITS = { maxFilters: 5, maxContractIds: 5, maxTopicPatterns: 5, maxSegments: 4 };
const EVENT_TYPES = new Set(["contract", "system", "diagnostic"]);
const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

export class RpcFilterError extends Error {}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest();

/** sha256 of an ScVal's canonical XDR (accepts an xdr.ScVal or base64 XDR). */
export function topicHash(value) {
  const scv = typeof value === "string" ? xdr.ScVal.fromXDR(value, "base64") : value;
  return sha256(scv.toXDR());
}

/**
 * Topic columns stored with each event: hex hashes for topic0..topic3 and
 * the topic count.
 */
export function topicColumns(topicScVals) {
  const topics = Array.isArray(topicScVals) ? topicScVals : [];
  return {
    topic_hashes: topics.slice(0, 4).map((t) => topicHash(t).toString("hex")),
    topic_count: topics.length,
  };
}

/** Validate an RPC `filters` array (throws RpcFilterError). Returns normalized filters. */
export function validateRpcFilters(filters) {
  if (!Array.isArray(filters) || filters.length === 0 || filters.length > RPC_FILTER_LIMITS.maxFilters) {
    throw new RpcFilterError(`filters must be an array of 1..${RPC_FILTER_LIMITS.maxFilters} filters`);
  }
  return filters.map((f, i) => {
    if (!f || typeof f !== "object" || Array.isArray(f)) throw new RpcFilterError(`filters[${i}] must be an object`);
    const unknown = Object.keys(f).filter((k) => !["type", "contractIds", "topics"].includes(k));
    if (unknown.length) throw new RpcFilterError(`filters[${i}] has unknown field(s): ${unknown.join(", ")}`);
    if (f.type !== undefined && !EVENT_TYPES.has(f.type)) {
      throw new RpcFilterError(`filters[${i}].type must be contract, system or diagnostic`);
    }
    const contractIds = f.contractIds ?? [];
    if (!Array.isArray(contractIds) || contractIds.length > RPC_FILTER_LIMITS.maxContractIds) {
      throw new RpcFilterError(`filters[${i}].contractIds allows at most ${RPC_FILTER_LIMITS.maxContractIds} IDs`);
    }
    contractIds.forEach((id) => {
      if (typeof id !== "string" || !CONTRACT_ID_RE.test(id)) throw new RpcFilterError(`invalid contract ID: ${String(id).slice(0, 64)}`);
    });
    const topics = f.topics ?? [];
    if (!Array.isArray(topics) || topics.length > RPC_FILTER_LIMITS.maxTopicPatterns) {
      throw new RpcFilterError(`filters[${i}].topics allows at most ${RPC_FILTER_LIMITS.maxTopicPatterns} patterns`);
    }
    const patterns = topics.map((segments, j) => {
      if (!Array.isArray(segments) || segments.length === 0) {
        throw new RpcFilterError(`filters[${i}].topics[${j}] must be a non-empty array`);
      }
      const trailing = segments[segments.length - 1] === "**";
      const fixed = trailing ? segments.slice(0, -1) : segments;
      if (fixed.length > RPC_FILTER_LIMITS.maxSegments) {
        throw new RpcFilterError(`filters[${i}].topics[${j}] has more than ${RPC_FILTER_LIMITS.maxSegments} segments`);
      }
      return {
        trailing,
        segments: fixed.map((seg) => {
          if (seg === "*") return null;
          if (seg === "**") throw new RpcFilterError(`"**" is only allowed as the last segment`);
          if (typeof seg !== "string") throw new RpcFilterError("topic segments must be strings");
          try {
            return topicHash(seg);
          } catch {
            throw new RpcFilterError(`topic segment is not a base64 XDR ScVal: ${seg.slice(0, 64)}`);
          }
        }),
      };
    });
    return { type: f.type ?? null, contractIds, patterns };
  });
}

/**
 * Compile validated filters to a parameterized SQL WHERE fragment over the
 * indexed topic0..topic3 / topic_count columns (migration 039).
 */
export function compileRpcFilters(filters, params = []) {
  const bind = (v) => (params.push(v), `$${params.length}`);
  const clauses = filters.map((f) => {
    if (f.type && f.type !== "contract") return "FALSE";
    const parts = [];
    if (f.contractIds.length) parts.push(`contract_id = ANY(${bind(f.contractIds)}::text[])`);
    if (f.patterns.length) {
      const alts = f.patterns.map((p) => {
        const conds = p.segments.flatMap((hash, idx) => (hash ? [`topic${idx} = ${bind(hash)}::bytea`] : []));
        conds.push(p.trailing ? `topic_count >= ${p.segments.length}` : `topic_count = ${p.segments.length}`);
        return `(${conds.join(" AND ")})`;
      });
      parts.push(`(${alts.join(" OR ")})`);
    }
    return parts.length ? `(${parts.join(" AND ")})` : "TRUE";
  });
  return { sql: `(${clauses.join(" OR ")})`, params };
}

/** In-memory matcher for live events (WS subscriptions), same semantics as SQL. */
export function matchRpcFilters(filters) {
  return (event) => {
    const hashes = event.topic_hashes;
    const count = event.topic_count;
    return filters.some((f) => {
      if (f.type && f.type !== "contract") return false;
      if (f.contractIds.length && !f.contractIds.includes(event.contract_id)) return false;
      if (!f.patterns.length) return true;
      if (!Array.isArray(hashes) || typeof count !== "number") return false; // indexed before #903
      return f.patterns.some((p) => {
        if (p.trailing ? count < p.segments.length : count !== p.segments.length) return false;
        return p.segments.every((h, idx) => h === null || hashes[idx] === h.toString("hex"));
      });
    });
  };
}

/** Parse filters given as a JSON string (query param) or already-parsed array. */
export function parseRpcFilters(input) {
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      throw new RpcFilterError("filters must be JSON");
    }
  }
  return validateRpcFilters(input);
}
