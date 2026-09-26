#!/usr/bin/env node
/**
 * Resource-budget regression gate (#873). See docs/BUDGET.md.
 *
 * Reads the measurements written by the contract budget tests
 * (target/budget/explorer.json, target/budget/ticket.json) plus the explorer
 * WASM size, compares them with contracts/budget-baseline.json and writes a
 * markdown report to target/budget/report.md.
 *
 *   node scripts/budget-check.js            # compare, exit 1 on regression
 *   node scripts/budget-check.js --update   # rewrite the baseline
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "contracts/budget-baseline.json");
const OUT_DIR = path.join(ROOT, "target/budget");
const WASM = path.join(
  ROOT,
  "target/wasm32-unknown-unknown/release/soroban_explorer_contract.wasm",
);
const DEFAULT_THRESHOLDS = { cpu_insns: 5, mem_bytes: 5, event_bytes: 5, wasm_bytes: 5 };

function loadCurrent() {
  const current = {};
  for (const file of ["explorer.json", "ticket.json"]) {
    const p = path.join(OUT_DIR, file);
    if (!fs.existsSync(p)) {
      throw new Error(`${path.relative(ROOT, p)} not found — run the budget tests first`);
    }
    Object.assign(current, JSON.parse(fs.readFileSync(p, "utf-8")));
  }
  if (fs.existsSync(WASM)) {
    current["explorer::wasm"] = { wasm_bytes: fs.statSync(WASM).size };
  }
  return current;
}

function pct(base, cur) {
  if (base === 0) return cur === 0 ? 0 : Infinity;
  return ((cur - base) / base) * 100;
}

function compare(baseline, current) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(baseline.thresholds ?? {}) };
  const rows = [];
  const regressions = [];
  const warnings = [];
  let decreased = false;

  for (const [name, metrics] of Object.entries(current)) {
    const base = baseline.entries?.[name];
    if (!base) {
      warnings.push(`\`${name}\` has no baseline — add it with \`make budget-update\` in this PR.`);
      continue;
    }
    for (const [metric, cur] of Object.entries(metrics)) {
      if (base[metric] === undefined) continue;
      const delta = pct(base[metric], cur);
      const limit = thresholds[metric] ?? 5;
      let status = "✅";
      if (delta > limit) {
        status = "❌";
        regressions.push(`${name} ${metric}`);
      } else if (delta < 0) {
        decreased = true;
        status = "⬇️";
      }
      if (delta !== 0) {
        rows.push(`| \`${name}\` | ${metric} | ${base[metric]} | ${cur} | ${delta.toFixed(2)}% | ${status} |`);
      }
    }
  }
  for (const name of Object.keys(baseline.entries ?? {})) {
    if (!current[name]) warnings.push(`\`${name}\` is in the baseline but was not measured.`);
  }

  const lines = ["## Contract resource budget", ""];
  if (rows.length === 0) {
    lines.push("No changes against `contracts/budget-baseline.json`.");
  } else {
    lines.push("| Entrypoint | Metric | Baseline | Current | Δ | |", "| --- | --- | --- | --- | --- | --- |", ...rows);
  }
  lines.push("", `Thresholds: ${Object.entries(thresholds).map(([k, v]) => `${k} +${v}%`).join(", ")}`);
  if (warnings.length) lines.push("", "**Warnings**", ...warnings.map((w) => `- ${w}`));
  if (regressions.length) {
    lines.push("", `**Budget regression** in ${regressions.length} metric(s). Reduce the cost or run \`make budget-update\` and add the \`budget-change-approved\` label.`);
  } else if (decreased) {
    lines.push("", "Costs went down — consider running `make budget-update` to lock in the improvement.");
  }
  return { report: lines.join("\n") + "\n", regressions };
}

function main() {
  const current = loadCurrent();

  if (process.argv.includes("--update")) {
    const previous = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf-8")) : {};
    const sorted = Object.fromEntries(Object.keys(current).sort().map((k) => [k, current[k]]));
    const next = { thresholds: previous.thresholds ?? DEFAULT_THRESHOLDS, entries: sorted };
    fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + "\n");
    console.log(`Updated ${path.relative(ROOT, BASELINE)} (${Object.keys(sorted).length} entries)`);
    return;
  }

  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf-8")) : { entries: {} };
  const { report, regressions } = compare(baseline, current);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), report);
  console.log(report);
  if (regressions.length) process.exit(1);
}

main();
