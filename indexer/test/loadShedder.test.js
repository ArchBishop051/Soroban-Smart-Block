import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { classifyRoute, createLoadShedder } from "../src/loadShedder.js";

function response() {
  const res = new EventEmitter();
  res.headers = {};
  res.set = (name, value) => {
    res.headers[name] = value;
    return res;
  };
  res.status = (status) => {
    res.statusCode = status;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

test("assigns independent adaptive limits to route classes", () => {
  assert.equal(classifyRoute("/api/rpc"), "rpc");
  assert.equal(classifyRoute("/api/sql"), "analytics");
  assert.equal(classifyRoute("/api/admin/audit"), "admin");
  assert.equal(classifyRoute("/api/events"), "api");
});

test("sheds anonymous requests immediately at capacity but reserves capacity for paid tiers", () => {
  const shedder = createLoadShedder({ limits: { api: 1 } });
  let nextCalls = 0;
  const lowResponse = response();
  shedder.middleware({ method: "GET", path: "/api/events", rateContext: { tier: "free" } }, lowResponse, () => {
    nextCalls += 1;
  });
  const rejected = response();
  shedder.middleware({ method: "GET", path: "/api/events", rateContext: { tier: "unauthenticated" } }, rejected, () => {
    nextCalls += 1;
  });
  assert.equal(nextCalls, 1);
  assert.equal(rejected.statusCode, 503);
  assert.equal(rejected.headers["Retry-After"], "1");

  const paid = response();
  shedder.middleware({ method: "GET", path: "/api/events", rateContext: { tier: "pro" } }, paid, () => {
    nextCalls += 1;
  });
  assert.equal(nextCalls, 2);
  assert.equal(shedder.getMetrics().api.active, 2);
  lowResponse.emit("finish");
  paid.emit("finish");
  assert.equal(shedder.getMetrics().api.active, 0);
});

test("never sheds health and readiness probes", () => {
  const shedder = createLoadShedder({ limits: { api: 1 } });
  let nextCalls = 0;
  const healthResponse = response();
  shedder.middleware({ method: "GET", path: "/health/ready" }, healthResponse, () => {
    nextCalls += 1;
  });
  assert.equal(nextCalls, 1);
  assert.equal(shedder.getMetrics().api.active, 0);
});
