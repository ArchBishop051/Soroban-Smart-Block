#!/usr/bin/env node
/**
 * Soak test harness (#893).
 *
 *   node tests/soak/run.js --duration 2h            # local variant
 *   node tests/soak/run.js --duration 72h --interval 60s
 *
 * Expects a running indexer (API_BASE_URL, default http://localhost:3001)
 * with RATE_LIMITING_DISABLED=true. Generates steady mixed API traffic and
 * WebSocket clients that connect and disconnect, samples the indexer's
 * /metrics (RSS, heap, event-loop lag, active handles) plus client-side
 * latency every interval into tests/soak/reports/samples.jsonl, then
 * analyses the series (analyze.js) and writes summary.md. Exits 1 on a leak
 * or latency drift.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeSoak } from "./analyze.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const parseDuration = (s, fallback) => {
  const m = /^(\d+(?:\.\d+)?)(s|m|h)$/.exec(String(s ?? ""));
  return m ? Number(m[1]) * { s: 1e3, m: 6e4, h: 3.6e6 }[m[2]] : fallback;
};

const BASE = (process.env.API_BASE_URL || args["base-url"] || "http://localhost:3001").replace(/\/$/, "");
const DURATION = parseDuration(args.duration, 2 * 3.6e6);
const INTERVAL = parseDuration(args.interval, 60_000);
const RPS = Number(args.rps ?? 20);
const WS_CLIENTS = Number(args["ws-clients"] ?? 20);
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "reports");
fs.mkdirSync(OUT, { recursive: true });
const SAMPLES = path.join(OUT, "samples.jsonl");
fs.writeFileSync(SAMPLES, "");

const PATHS = ["/api/events?limit=25", "/api/contracts?limit=25", "/api/stats", "/api/health", "/api/search?q=transfer"];
const latencies = [];
let errors = 0;

async function hit() {
  const t = performance.now();
  try {
    const res = await fetch(BASE + PATHS[Math.floor(Math.random() * PATHS.length)]);
    await res.arrayBuffer();
    if (res.status >= 500) errors++;
  } catch {
    errors++;
  }
  latencies.push(performance.now() - t);
}

async function wsChurn(WebSocketImpl) {
  if (!WebSocketImpl) return;
  const url = BASE.replace(/^http/, "ws");
  for (let i = 0; i < WS_CLIENTS; i++) {
    const ws = new WebSocketImpl(url);
    ws.onerror = () => {};
    setTimeout(() => ws.close(), 5_000 + Math.random() * 25_000); // clients come and go
  }
}

function metric(text, name) {
  const m = new RegExp(`^${name}(?:\\{[^}]*\\})? ([0-9.eE+-]+)$`, "m").exec(text);
  return m ? Number(m[1]) : NaN;
}

async function sample(start) {
  const text = await fetch(`${BASE}/metrics`).then((r) => r.text()).catch(() => "");
  const sorted = latencies.splice(0).sort((a, b) => a - b);
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : NaN);
  const row = {
    t: Date.now() - start,
    rssMb: metric(text, "process_resident_memory_bytes") / 1048576,
    heapMb: metric(text, "nodejs_heap_size_used_bytes") / 1048576,
    handles: metric(text, "nodejs_active_handles_total"),
    lagMs: metric(text, "nodejs_eventloop_lag_p99_seconds") * 1000,
    p50Ms: pct(0.5),
    p95Ms: pct(0.95),
    p99Ms: pct(0.99),
    errors,
  };
  fs.appendFileSync(SAMPLES, JSON.stringify(row) + "\n");
  console.log(`[soak] ${(row.t / 60000).toFixed(0)} min rss=${row.rssMb.toFixed(1)}MB heap=${row.heapMb.toFixed(1)}MB handles=${row.handles} p95=${row.p95Ms?.toFixed(1)}ms errors=${errors}`);
  return row;
}

async function main() {
  const WebSocketImpl = globalThis.WebSocket ?? (await import("ws").then((m) => m.WebSocket).catch(() => null));
  const start = Date.now();
  const samples = [];
  const load = setInterval(() => {
    for (let i = 0; i < RPS; i++) hit();
  }, 1000);
  const churn = setInterval(() => wsChurn(WebSocketImpl), 30_000);
  wsChurn(WebSocketImpl);

  while (Date.now() - start < DURATION) {
    await new Promise((r) => setTimeout(r, INTERVAL));
    samples.push(await sample(start));
  }
  clearInterval(load);
  clearInterval(churn);

  const result = analyzeSoak(samples);
  const summary = [
    `# Soak run — ${(DURATION / 3.6e6).toFixed(1)} h against ${BASE}`,
    "",
    `Result: **${result.ok ? "PASS" : "FAIL"}**`,
    "",
    ...result.findings.map((f) => `- ${f}`),
    "",
    "```json",
    JSON.stringify(result.metrics, null, 2),
    "```",
    "",
    `Samples: ${samples.length} (tests/soak/reports/samples.jsonl), 5xx/errors: ${errors}`,
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "summary.md"), summary + "\n");
  console.log(summary);
  process.exit(result.ok ? 0 : 1);
}

main();
