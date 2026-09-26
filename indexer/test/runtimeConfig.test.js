import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateRuntimeConfig,
  RuntimeConfigError,
  setCurrent,
  get,
  subscribe,
  watchGuardrail,
} from "../src/runtimeConfig.js";
import { getTierLimits } from "../src/rateLimit/endpointGroups.js";

test("invalid configs are rejected with readable errors", () => {
  assert.throws(() => validateRuntimeConfig({ rateLimitOverrides: { default: { free: -1 } } }), RuntimeConfigError);
  assert.throws(() => validateRuntimeConfig({ unknownKey: true }), /Invalid runtime config/);
  assert.deepEqual(validateRuntimeConfig({}).featureFlags, {});
});

test("a new version is live immediately for readers and subscribers", () => {
  const seen = [];
  const off = subscribe((next) => seen.push(next.version));
  setCurrent({ version: 1, config: { rateLimitOverrides: { default: { free: 7 } } } });
  assert.equal(get("rateLimitOverrides").default.free, 7);
  assert.equal(getTierLimits("default", "free").rpm, 7); // rate limiter reads the live value
  setCurrent({ version: 2, config: {} });
  assert.notEqual(getTierLimits("default", "free").rpm, 7);
  assert.deepEqual(seen, [1, 2]);
  off();
});

test("an invalid stored version is ignored (last-known-good stays)", () => {
  setCurrent({ version: 3, config: { featureFlags: { beta: true } } });
  assert.equal(setCurrent({ version: 4, config: { featureFlags: { beta: "yes" } } }), false);
  assert.equal(get("featureFlags").beta, true);
});

test("guardrail reverts a change that spikes the 5xx rate", async () => {
  let reverted = false;
  const alerts = [];
  const outcome = await watchGuardrail({
    baseline: { errorRate: 0.01, lagLedgers: 2 },
    sample: async () => ({ errorRate: 0.3, lagLedgers: 2 }),
    revert: async () => {
      reverted = true;
    },
    alert: async (m) => alerts.push(m),
    windowMs: 50,
    intervalMs: 5,
  });
  assert.equal(outcome, "reverted");
  assert.equal(reverted, true);
  assert.match(alerts[0], /reverted/);
});

test("guardrail keeps a healthy change", async () => {
  const outcome = await watchGuardrail({
    baseline: { errorRate: 0.01, lagLedgers: 2 },
    sample: async () => ({ errorRate: 0.01, lagLedgers: 3 }),
    revert: async () => assert.fail("should not revert"),
    windowMs: 30,
    intervalMs: 5,
  });
  assert.equal(outcome, "kept");
});
