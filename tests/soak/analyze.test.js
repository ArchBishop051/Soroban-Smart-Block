import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSoak } from "./analyze.js";

// One sample per minute for `hours`, with a GC sawtooth on top of `base(t)`.
function series(hours, { rss = () => 200, handles = () => 40, p95 = () => 20 } = {}) {
  return Array.from({ length: hours * 60 }, (_, i) => {
    const h = i / 60;
    const saw = (i % 7) * 6; // heap grows between collections, then drops
    return { t: i * 60_000, rssMb: rss(h) + saw, heapMb: rss(h) / 2 + saw, handles: handles(h), p95Ms: p95(h) };
  });
}

test("a GC sawtooth over a flat floor is not a leak", () => {
  assert.equal(analyzeSoak(series(2)).ok, true);
});

test("an injected leak (a listener retained per request) is detected in 2 hours", () => {
  const result = analyzeSoak(series(2, { rss: (h) => 200 + 20 * h, handles: (h) => 40 + 30 * h }));
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.startsWith("rssMb")));
  assert.ok(result.findings.some((f) => f.startsWith("handles")));
});

test("cache growth that plateaus at a bound is not flagged", () => {
  assert.equal(analyzeSoak(series(2, { rss: (h) => 200 + Math.min(h, 0.5) * 80 })).ok, true);
});

test("latency drift is reported", () => {
  const result = analyzeSoak(series(2, { p95: (h) => 20 + h * 40 }));
  assert.ok(result.findings.some((f) => f.startsWith("p95 latency drifted")));
});
