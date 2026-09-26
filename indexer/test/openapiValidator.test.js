import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import request from "supertest";
import { loadResponseValidator } from "../src/openapiValidator.js";

const SPEC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/api/openapi.yaml");
const validate = loadResponseValidator(SPEC);

test("a spec-conforming response passes", () => {
  assert.equal(validate("GET", "/api/events", 200, { data: [], next_cursor: null }), null);
});

test("a mismatched response body is reported", () => {
  const result = validate("GET", "/api/events", 200, { data: "not-an-array", next_cursor: null });
  assert.equal(result.operation, "GET /api/events");
  assert.ok(result.violations.length > 0);
});

test("an undocumented status code is reported", () => {
  const result = validate("GET", "/api/events", 418, { error: "teapot" });
  assert.deepEqual(result.violations, ["status 418 is not documented"]);
});

test("path templates match concrete paths; undocumented operations are skipped", () => {
  assert.equal(validate("GET", "/api/not-in-spec", 200, {}), null);
  assert.equal(validate("GET", "/api/events/123", 200, "not-an-object").operation, "GET /api/events/{seq}");
});

test("with OPENAPI_VALIDATE_RESPONSES, a spec/response mismatch becomes a 500", async () => {
  process.env.OPENAPI_VALIDATE_RESPONSES = "true";
  const { createApi } = await import("../src/api.js");
  const app = createApi({
    logDestination: new PassThrough(),
    dbOverride: {
      // Deliberate drift: `data` must be an array per the spec.
      async getEventsCursor() {
        return { data: { seq: 1 }, next_cursor: null };
      },
    },
  });
  const res = await request(app).get("/api/events");
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "Response does not match the OpenAPI spec");
  delete process.env.OPENAPI_VALIDATE_RESPONSES;
});
