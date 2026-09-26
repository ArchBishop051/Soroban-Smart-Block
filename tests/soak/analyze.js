/**
 * Soak analysis (#893). Pure functions over the sampled time series.
 *
 * Memory: GC produces a sawtooth, so each window's minimum (the post-GC
 * floor) is used, not raw samples. A least-squares slope is fitted to those
 * floors after warm-up; bounded cache growth plateaus, so the slope over the
 * final part of the run is what decides a leak.
 */

/** Least-squares slope of y over x. */
export function slope(points) {
  const n = points.length;
  if (n < 2) return 0;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Minimum of `key` per window of `windowSize` samples → [{ x: hours, y }]. */
export function windowMinima(samples, key, windowSize) {
  const out = [];
  for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
    const win = samples.slice(i, i + windowSize).filter((s) => Number.isFinite(s[key]));
    if (!win.length) continue;
    const min = win.reduce((a, s) => (s[key] < a[key] ? s : a));
    out.push({ x: min.t / 3_600_000, y: min[key] });
  }
  return out;
}

/**
 * @param {{ t: number, rssMb: number, heapMb: number, handles: number, lagMs: number, p95Ms: number }[]} samples
 *        t = ms since start
 * @returns {{ ok: boolean, findings: string[], metrics: object }}
 */
export function analyzeSoak(samples, {
  warmupFraction = 0.2,
  windowSize = 10,
  maxRssMbPerHour = 5,
  maxHeapMbPerHour = 3,
  maxHandlesPerHour = 5,
  maxLatencyDrift = 1.5,
} = {}) {
  const steady = samples.slice(Math.floor(samples.length * warmupFraction));
  const findings = [];
  const metrics = {};
  if (steady.length < windowSize * 3) {
    return { ok: true, findings: ["not enough samples for trend analysis"], metrics };
  }

  // Judge the trend on the final two thirds of the steady state, so planned
  // growth to a bound (which then plateaus) is not flagged.
  const tail = steady.slice(Math.floor(steady.length / 3));
  for (const [key, limit, unit] of [
    ["rssMb", maxRssMbPerHour, "MB/h"],
    ["heapMb", maxHeapMbPerHour, "MB/h"],
    ["handles", maxHandlesPerHour, "handles/h"],
  ]) {
    const s = slope(windowMinima(tail, key, windowSize));
    metrics[`${key}Slope`] = Number(s.toFixed(3));
    if (s > limit) findings.push(`${key} post-GC floor grows ${s.toFixed(2)} ${unit} (limit ${limit})`);
  }

  const p95 = (arr) => {
    const v = arr.map((s) => s.p95Ms).filter(Number.isFinite).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  const first = p95(steady.slice(0, windowSize));
  const last = p95(steady.slice(-windowSize));
  if (first && last) {
    metrics.latencyDrift = Number((last / first).toFixed(2));
    if (last / first > maxLatencyDrift) findings.push(`p95 latency drifted ×${(last / first).toFixed(2)} (limit ×${maxLatencyDrift})`);
  }

  return { ok: findings.length === 0, findings, metrics };
}
