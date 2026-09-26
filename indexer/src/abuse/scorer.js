/**
 * API abuse anomaly scoring (#931).
 *
 * Complements rateLimit/abuseDetector.js (static per-request patterns) with a
 * per-principal score built from sliding-window request features:
 *
 *   - volume z-score against the principal's own per-minute baseline
 *   - endpoint entropy (low entropy + high volume = scraping one table)
 *   - sequential cursor pagination depth
 *   - distinct IPs per API key (key sharing)
 *   - key-creation attempts per IP / email domain (sign-up farms, stuffing)
 *   - error rate
 *
 * Actions by score (all reversible, logged, and listed at /api/admin/abuse):
 *   flag → throttle → challenge (sign-up endpoints) → suspend
 *
 * Safety:
 *   - Shadow mode by default: scores and logs but never acts. Set
 *     ABUSE_ENFORCE=true to enforce.
 *   - ABUSE_ALLOWLIST (comma separated API-key ids / IPs) is never scored.
 *   - IP-only principals (no API key) are capped at "flag" — NAT'd networks
 *     are never throttled or blocked on IP alone.
 *   - Admin overrides clear state and exempt a principal for a period.
 */
import { logger } from "../logger.js";

const WINDOW_MS = 60_000;
const BASELINE_MINUTES = 60;
const THRESHOLDS = { flag: 3, throttle: 5, challenge: 7, suspend: 9 };
const THROTTLED_RPM = 10;
const SIGNUP_PATH = /\/(api-keys|signup|register)(\/|$)/;

/** principal -> state */
const principals = new Map();
/** principal -> override expiry (ms) */
const overrides = new Map();

function allowlist() {
  return new Set(
    String(process.env.ABUSE_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isShadowMode() {
  return process.env.ABUSE_ENFORCE !== "true";
}

function stateFor(id) {
  let s = principals.get(id);
  if (!s) {
    s = { reqs: [], minuteCounts: [], lastMinute: 0, ips: new Map(), signups: [], domains: new Map(), cursorRun: 0, lastCursor: null, score: 0, action: "none", evidence: {}, updatedAt: 0 };
    principals.set(id, s);
  }
  return s;
}

function prune(s, now) {
  while (s.reqs.length && now - s.reqs[0].t > WINDOW_MS) s.reqs.shift();
  while (s.signups.length && now - s.signups[0] > WINDOW_MS * 5) s.signups.shift();
  for (const [ip, t] of s.ips) if (now - t > WINDOW_MS * 5) s.ips.delete(ip);
}

function rollMinute(s, now) {
  const minute = Math.floor(now / WINDOW_MS);
  if (s.lastMinute && minute !== s.lastMinute) {
    s.minuteCounts.push(s.reqs.length);
    if (s.minuteCounts.length > BASELINE_MINUTES) s.minuteCounts.shift();
  }
  s.lastMinute = minute;
}

function zScore(value, samples) {
  if (samples.length < 5) return 0;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length) || 1;
  return (value - mean) / sd;
}

function entropy(paths) {
  const counts = new Map();
  for (const p of paths) counts.set(p, (counts.get(p) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / paths.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Pure scoring of a principal's current window. Exported for tests. */
export function scoreState(s, { ipOnly }) {
  const n = s.reqs.length;
  const evidence = {};
  let score = 0;

  const z = zScore(n, s.minuteCounts);
  if (z > 3) (score += 3), (evidence.volumeZ = Number(z.toFixed(2)));

  if (n >= 30) {
    const h = entropy(s.reqs.map((r) => r.path));
    if (h < 1) (score += 2), (evidence.endpointEntropy = Number(h.toFixed(2)));
  }
  if (s.cursorRun >= 25) (score += 3), (evidence.sequentialCursorPages = s.cursorRun);
  if (s.ips.size >= 10) (score += 3), (evidence.distinctIps = s.ips.size);
  if (s.signups.length >= 5) (score += 4), (evidence.signupAttempts = s.signups.length);
  for (const [domain, count] of s.domains) if (count >= 5) (score += 2), (evidence.signupDomain = { domain, count });

  const errors = s.reqs.filter((r) => r.status >= 400).length;
  if (n >= 20 && errors / n > 0.5) (score += 2), (evidence.errorRate = Number((errors / n).toFixed(2)));

  let action = "none";
  if (score >= THRESHOLDS.suspend) action = "suspend";
  else if (score >= THRESHOLDS.challenge) action = "challenge";
  else if (score >= THRESHOLDS.throttle) action = "throttle";
  else if (score >= THRESHOLDS.flag) action = "flag";
  if (ipOnly && action !== "none") action = "flag";
  return { score, action, evidence };
}

function principalOf(req) {
  const keyId = req.rateContext?.keyId;
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
  return keyId ? { id: `key:${keyId}`, ip, ipOnly: false } : { id: `ip:${ip}`, ip, ipOnly: true };
}

/** Record a finished request and rescore. Exported for tests. */
export function observe({ id, ip, ipOnly, method, path, status, cursor, email, now = Date.now() }) {
  const s = stateFor(id);
  rollMinute(s, now);
  prune(s, now);
  s.reqs.push({ t: now, path, status });
  s.ips.set(ip, now);
  if (cursor) {
    s.cursorRun = cursor !== s.lastCursor ? s.cursorRun + 1 : s.cursorRun;
    s.lastCursor = cursor;
  } else {
    s.cursorRun = 0;
  }
  if (method === "POST" && SIGNUP_PATH.test(path)) {
    s.signups.push(now);
    const domain = typeof email === "string" ? email.split("@")[1]?.toLowerCase() : null;
    if (domain) s.domains.set(domain, (s.domains.get(domain) ?? 0) + 1);
  }

  const prev = s.action;
  Object.assign(s, scoreState(s, { ipOnly }), { updatedAt: now });
  if (s.action !== prev && s.action !== "none") {
    logger.warn(JSON.stringify({ event: "abuse_score", principal: id, score: s.score, action: s.action, shadow: isShadowMode(), evidence: s.evidence }));
  }
  return s;
}

/** Express middleware: enforce the current action, then observe the request on finish. */
export function abuseScorer(req, res, next) {
  const p = principalOf(req);
  const allowed = allowlist();
  if (allowed.has(p.id.slice(p.id.indexOf(":") + 1)) || allowed.has(p.ip)) return next();

  const overrideUntil = overrides.get(p.id);
  const overridden = overrideUntil && overrideUntil > Date.now();

  res.on("finish", () => {
    if (overridden) return;
    observe({ ...p, method: req.method, path: req.path, status: res.statusCode, cursor: req.query?.cursor, email: req.body?.email });
  });

  const s = principals.get(p.id);
  if (!s || overridden || isShadowMode()) return next();

  if (s.action === "suspend") {
    return res.status(403).json({ error: "Access suspended pending review", code: "ABUSE_SUSPENDED" });
  }
  if (s.action === "challenge" && req.method === "POST" && SIGNUP_PATH.test(req.path)) {
    return res.status(429).json({ error: "Additional verification required", code: "ABUSE_CHALLENGE" });
  }
  if (s.action === "throttle" || s.action === "challenge") {
    req.rateContext = { ...(req.rateContext ?? {}), rateLimit: Math.min(req.rateContext?.rateLimit ?? THROTTLED_RPM, THROTTLED_RPM) };
  }
  return next();
}

/** Admin view: every principal with a non-zero action, with evidence. */
export function listFlagged() {
  return [...principals.entries()]
    .filter(([, s]) => s.action !== "none")
    .map(([id, s]) => ({ principal: id, score: s.score, action: s.action, evidence: s.evidence, updatedAt: new Date(s.updatedAt).toISOString(), overriddenUntil: overrides.get(id) ? new Date(overrides.get(id)).toISOString() : null }));
}

/** Admin unblock / manual override: clear state and exempt the principal for `hours`. */
export function overridePrincipal(id, hours = 24) {
  principals.delete(id);
  overrides.set(id, Date.now() + hours * 3_600_000);
  logger.warn(JSON.stringify({ event: "abuse_override", principal: id, hours }));
}

/** Test hook. */
export function _resetForTest() {
  principals.clear();
  overrides.clear();
}
