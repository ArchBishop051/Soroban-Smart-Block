import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { observe, _resetForTest, isShadowMode } from "../../src/abuse/scorer.js";

beforeEach(() => _resetForTest());

const base = Date.parse("2026-01-01T00:00:00Z");

test("shadow mode is the default", () => {
  assert.equal(isShadowMode(), true);
});

test("sequential cursor scraper is flagged within 5 minutes", () => {
  let s;
  for (let i = 0; i < 200; i++) {
    s = observe({ id: "key:scraper", ip: "10.0.0.1", ipOnly: false, method: "GET", path: "/api/events", status: 200, cursor: `c${i}`, now: base + i * 1000 });
  }
  assert.notEqual(s.action, "none");
  assert.ok(s.evidence.sequentialCursorPages >= 25);
});

test("sign-up farm is flagged, but IP-only principals are never above flag", () => {
  let s;
  for (let i = 0; i < 10; i++) {
    s = observe({ id: "ip:1.2.3.4", ip: "1.2.3.4", ipOnly: true, method: "POST", path: "/api/api-keys", status: 201, email: `u${i}@farm.test`, now: base + i * 5000 });
  }
  assert.equal(s.action, "flag");
  assert.ok(s.score >= 5);
});

test("normal mixed traffic produces no flags", () => {
  const paths = ["/api/events", "/api/contracts/C1", "/api/wallet/G1", "/api/stats", "/api/events/latest"];
  let s;
  for (let i = 0; i < 600; i++) {
    s = observe({ id: "key:normal", ip: "10.0.0.2", ipOnly: false, method: "GET", path: paths[i % paths.length], status: 200, now: base + i * 2000 });
  }
  assert.equal(s.action, "none");
});
