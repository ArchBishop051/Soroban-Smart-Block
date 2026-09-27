import crypto from "node:crypto";
import { logger } from "./logger.js";

function stableEvent(event) { return { id: event.id ?? `${event.txHash ?? event.tx_hash ?? ""}:${event.ledger ?? ""}:${event.contractId ?? event.contract_id ?? ""}`, ledger: event.ledger, tx: event.txHash ?? event.tx_hash, xdr: event.xdr ?? event.txMeta ?? event.value ?? event.topic ?? null }; }
export function canonicalDigest(events = []) { const rows = events.map(stableEvent).sort((a, b) => String(a.id).localeCompare(String(b.id))); return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex"); }

export async function verifyRpcRange({ providers, request, mode = "off", samplePercent = 1, quorum = 2, onDisagreement = () => {} }) {
  if (!providers.length) throw new Error("no RPC providers configured");
  if (mode === "off" || (mode === "sample" && Math.random() * 100 >= samplePercent)) return { events: await providers[0](request), verified: false, mode: "off" };
  if (providers.length < 2) { logger.warn("[rpc-verifier] fewer than two providers reachable; degrading verification to off"); return { events: await providers[0](request), verified: false, degraded: true, mode: "off", reason: "insufficient_providers" }; }
  const responses = await Promise.allSettled(providers.map((provider) => provider(request)));
  const successful = responses.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (successful.length < 2) return { events: successful[0] ?? [], verified: false, degraded: true, reason: "insufficient_providers" };
  const groups = new Map();
  for (const events of successful) { const digest = canonicalDigest(events); const group = groups.get(digest) ?? { digest, events, count: 0 }; group.count++; groups.set(digest, group); }
  const winner = [...groups.values()].sort((a, b) => b.count - a.count)[0];
  const required = mode === "quorum" ? Math.min(quorum, successful.length) : 2;
  if (winner.count < required) { await onDisagreement({ groups: [...groups.values()].map(({ digest, count }) => ({ digest, count })) }); throw new Error("RPC quorum disagreement: no majority"); }
  if (groups.size > 1) await onDisagreement({ groups: [...groups.values()].map(({ digest, count }) => ({ digest, count })) });
  return { events: winner.events, verified: true, digest: winner.digest, dissenting: successful.length - winner.count };
}
