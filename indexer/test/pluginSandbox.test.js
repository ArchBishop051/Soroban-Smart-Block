import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PluginSandbox } from "../src/plugins/sandbox.js";
import { PluginRegistry, sha256 } from "../src/plugins/registry.js";

const EVENT = { contract_id: "CABC", function: "transfer", ledger: 1, tx_hash: "t", topics: ["transfer", "GFROM", "GTO"], data: "12345678" };
const sandboxes = [];
const sandbox = (source, opts) => {
  const s = new PluginSandbox(source, { timeoutMs: 50, ...opts });
  sandboxes.push(s);
  return s;
};
after(() => Promise.all(sandboxes.map((s) => s.close())));

test("a well-behaved plugin decodes events with sandbox helpers", async () => {
  const s = sandbox(`module.exports.decode = (ev, h) => ({ description: "sent " + h.formatAmount(ev.data) + " to " + h.shortAddress(ev.topics[2]) });`);
  assert.deepEqual(await s.call(EVENT), { description: "sent 1.2345678 to GTO" });
});

test("require, process, fetch and globals are not reachable", async () => {
  const s = sandbox(`module.exports.decode = () => ({
    require: typeof require, process: typeof process, fetch: typeof fetch,
    buffer: typeof Buffer, timers: typeof setTimeout, globalProcess: typeof globalThis.process,
  });`);
  assert.deepEqual(await s.call(EVENT), {
    require: "undefined", process: "undefined", fetch: "undefined",
    buffer: "undefined", timers: "undefined", globalProcess: "undefined",
  });
});

test("constructor escapes and eval cannot reach the host", async () => {
  const s = sandbox(`module.exports.decode = (ev, h) => {
    const tries = [
      () => h.formatAmount.constructor("return process")(),
      () => ev.constructor.constructor("return process")(),
      () => this.constructor.constructor("return process")(),
      () => eval("process"),
    ];
    return { results: tries.map((t) => { try { const p = t(); return p && p.env ? "ESCAPED" : String(p); } catch (e) { return "blocked"; } }) };
  };`);
  const { results } = await s.call(EVENT);
  assert.ok(results.every((r) => r !== "ESCAPED"), JSON.stringify(results));
});

test("prototype pollution stays inside the sandbox", async () => {
  const s = sandbox(`module.exports.decode = () => { Object.prototype.polluted = "yes"; Array.prototype.map = null; return { description: "x" }; };`);
  await s.call(EVENT);
  assert.equal({}.polluted, undefined);
  assert.equal(typeof [].map, "function");
});

test("an infinite loop is terminated at the time limit and the host keeps running", async () => {
  const s = sandbox(`module.exports.decode = () => { while (true) {} };`);
  await assert.rejects(s.call(EVENT), { kind: "timeout" });
  assert.equal(1 + 1, 2);
});

test("oversized output is rejected", async () => {
  const s = sandbox(`module.exports.decode = () => ({ description: "x".repeat(100000) });`, { maxOutputBytes: 1024 });
  await assert.rejects(s.call(EVENT), { kind: "output_limit" });
});

// Wall-clock timing is only meaningful when this file runs alone (the full
// suite runs test files concurrently):
//   PLUGIN_PERF_BENCH=1 node --test test/pluginSandbox.test.js
test("typical call overhead stays under 0.5 ms p99", { skip: !process.env.PLUGIN_PERF_BENCH && "set PLUGIN_PERF_BENCH=1 and run this file alone" }, async () => {
  const s = sandbox(`module.exports.decode = (ev) => ({ description: ev.function + " " + ev.data });`);
  for (let i = 0; i < 300; i++) await s.call(EVENT); // warm up JIT and the worker
  // Best of three batches, to keep unrelated machine noise out of the result.
  const p99s = [];
  for (let run = 0; run < 3; run++) {
    const samples = [];
    for (let i = 0; i < 500; i++) {
      const t = process.hrtime.bigint();
      await s.call(EVENT);
      samples.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    samples.sort((x, y) => x - y);
    p99s.push(samples[Math.floor(samples.length * 0.99)]);
  }
  const best = Math.min(...p99s);
  assert.ok(best < 0.5, `p99 per batch: ${p99s.map((v) => v.toFixed(3)).join(", ")} ms`);
});

// ── Registry ────────────────────────────────────────────────────────────────

function registry(opts) {
  const violations = [];
  const r = new PluginRegistry({ sandboxOptions: { timeoutMs: 50 }, onViolation: (id, v) => violations.push([id, v.kind]), ...opts });
  after(() => r.close());
  return { r, violations };
}
const manifest = (matchers = [{ function: "transfer" }]) => ({ name: "p", version: "1.0.0", entry: "index.js", matchers });

test("only allowlisted plugins with a matching hash are loaded", () => {
  const { r } = registry();
  const src = `module.exports.decode = () => ({ description: "ok" });`;
  assert.equal(r.add(manifest(), src, {}), false);
  assert.equal(r.add(manifest(), src, { "p@1.0.0": sha256(src + " ") }), false);
  assert.equal(r.add(manifest(), src, { "p@1.0.0": sha256(src) }), true);
});

test("plugins run only for events matching their manifest", async () => {
  const { r } = registry();
  const src = `module.exports.decode = () => ({ description: "decoded by plugin" });`;
  r.add(manifest([{ contract_id: "CABC", function: "transfer" }]), src, { "p@1.0.0": sha256(src) });
  assert.equal((await r.decode(EVENT)).description, "decoded by plugin");
  assert.equal(await r.decode({ ...EVENT, function: "mint" }), null);
  assert.equal(await r.decode({ ...EVENT, contract_id: "COTHER" }), null);
});

test("malformed output is rejected and repeated violations disable the plugin", async () => {
  const { r, violations } = registry({ violationLimit: 2 });
  const src = `module.exports.decode = () => ({ description: 42, extra: true });`;
  r.add(manifest(), src, { "p@1.0.0": sha256(src) });
  assert.equal(await r.decode(EVENT), null);
  assert.equal(await r.decode(EVENT), null);
  assert.deepEqual(violations, [["p@1.0.0", "malformed"], ["p@1.0.0", "malformed"]]);
  assert.equal(r.size, 0);
  assert.equal(await r.decode(EVENT), null);
  assert.equal(violations.length, 2); // disabled: not invoked again
});
