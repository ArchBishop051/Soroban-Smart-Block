import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import request from "supertest";
import {
  ROUTE_SCOPES,
  SCOPES,
  DEFAULT_SCOPES,
  scopeMiddleware,
  listRoutes,
  assertRoutesDeclareScopes,
  normaliseScopes,
} from "../src/auth/scopes.js";
import { createApi } from "../src/api.js";

const app = createApi({ logDestination: new PassThrough(), dbOverride: {} });

/** Run scopeMiddleware for a request made with a key holding `ctx`. */
function run(method, path, ctx, { query = {}, headers = {}, body } = {}) {
  let status = null;
  let payload = null;
  let passed = false;
  const res = {
    status(code) { status = code; return this; },
    type() { return this; },
    json(b) { payload = b; return this; },
  };
  const req = {
    method,
    path,
    query,
    body,
    rateContext: { keyId: "key-1", ...ctx },
    get: (h) => headers[h.toLowerCase()],
  };
  scopeMiddleware(req, res, () => (passed = true));
  return { passed, status, payload };
}

const concrete = (path) => path.replace(/:(\w+)/g, "CSAMPLE");

test("every registered route declares its scopes", () => {
  const routes = listRoutes(app);
  assert.ok(routes.length > 100, `only ${routes.length} routes found`);
  const missing = routes.filter((r) => !(r in ROUTE_SCOPES));
  assert.deepEqual(missing, []);
  assert.doesNotThrow(() => assertRoutesDeclareScopes(app));
});

test("an undeclared route fails the startup check", () => {
  const fakeApp = { _router: { stack: [{ route: { path: "/api/new-thing", methods: { get: true } } }] } };
  assert.throws(() => assertRoutesDeclareScopes(fakeApp), /GET \/api\/new-thing/);
});

test("scope × route matrix: allowed exactly when the key holds the required scope", () => {
  for (const [route, required] of Object.entries(ROUTE_SCOPES)) {
    const [method, path] = route.split(" ");
    for (const scope of SCOPES) {
      const expected = required.every((r) => scope === r || scope === "admin:*");
      const { passed, status } = run(method, concrete(path), { scopes: [scope] });
      assert.equal(passed, expected, `${scope} on ${route}: expected ${expected ? "allow" : "deny"}`);
      if (!expected) assert.equal(status, 403, route);
    }
  }
});

test("denials use Problem Details naming the missing scope", () => {
  const { status, payload } = run("POST", "/api/contracts", { scopes: ["read:contracts"] });
  assert.equal(status, 403);
  assert.equal(payload.title, "Insufficient scope");
  assert.equal(payload.missing_scope, "write:contracts");
});

test("a key restricted to contract A cannot access contract B", () => {
  const ctx = { scopes: ["read:contracts", "read:events"], allowedContractIds: ["CA"] };
  assert.equal(run("GET", "/api/contracts/CA/abi", ctx).passed, true);
  const denied = run("GET", "/api/contracts/CB/abi", ctx);
  assert.equal(denied.status, 403);
  assert.equal(denied.payload.missing_scope, "contract:CB");
  assert.equal(run("GET", "/api/events", ctx, { query: { contract: "CA" } }).passed, true);
  assert.equal(run("GET", "/api/events", ctx, { query: { contract: "CB" } }).status, 403);
  assert.equal(run("GET", "/api/events", ctx).status, 403); // unscoped cross-contract list
});

test("origin restrictions apply to browser requests", () => {
  const ctx = { scopes: DEFAULT_SCOPES, allowedOrigins: ["https://app.example.com"] };
  assert.equal(run("GET", "/api/events", ctx, { headers: { origin: "https://app.example.com" } }).passed, true);
  assert.equal(run("GET", "/api/events", ctx, { headers: { origin: "https://evil.example" } }).status, 403);
});

test("unauthenticated requests keep their existing access", () => {
  const req = { method: "GET", path: "/api/events", rateContext: { keyId: null, tier: "unauthenticated" } };
  let passed = false;
  scopeMiddleware(req, {}, () => (passed = true));
  assert.equal(passed, true);
});

test("new keys default to read-only; admin scope needs explicit permission", () => {
  assert.deepEqual(normaliseScopes(undefined), ["read:events", "read:contracts"]);
  assert.throws(() => normaliseScopes(["write:everything"]), /unknown scope/);
  assert.throws(() => normaliseScopes(["admin:*"]), /admin/);
  assert.deepEqual(normaliseScopes(["admin:*"], { allowAdmin: true }), ["admin:*"]);
});

test("GET /api/keys/introspect reports the presented key's scopes", async () => {
  process.env.API_KEY = "static-admin-test-key";
  const res = await request(app).get("/api/keys/introspect").set("x-api-key", "static-admin-test-key");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.scopes, ["admin:*"]);
  assert.equal(res.body.tier, "enterprise");
  const anon = await request(app).get("/api/keys/introspect");
  assert.equal(anon.status, 401);
  delete process.env.API_KEY;
});
