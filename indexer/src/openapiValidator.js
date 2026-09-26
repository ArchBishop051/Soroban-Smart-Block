import { logger } from "./logger.js";
/**
 * Test-mode OpenAPI response validation (#907).
 *
 * With OPENAPI_VALIDATE_RESPONSES=true, every JSON response to an operation
 * documented in docs/api/openapi.yaml is checked against that operation's
 * response schema. A mismatch — wrong shape, or an undocumented status code —
 * is replaced by a 500 describing the violation, so contract tests and the
 * API fuzzer (tests/api-fuzz) fail loudly on spec drift. Never enable this in
 * production.
 */

import fs from "fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const escapePointer = (s) => s.replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * Build a validator for a parsed OpenAPI 3.0 document.
 * @returns {(method: string, path: string, status: number, body: unknown) =>
 *   null | { operation: string, violations: string[] }}
 */
export function createResponseValidator(spec) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  // Register the whole document so response schemas are compiled by JSON
  // pointer and their `#/components/...` refs resolve against it.
  ajv.addSchema(spec, "openapi");

  const routes = Object.entries(spec.paths ?? {}).map(([template, ops]) => ({
    template,
    ops,
    re: new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`),
  }));
  // Prefer literal segments over templated ones (/api/sandbox/simulate before /api/sandbox/{id}).
  routes.sort((a, b) => (a.template.match(/\{/g)?.length ?? 0) - (b.template.match(/\{/g)?.length ?? 0));
  const compiled = new Map();

  return function validate(method, path, status, body) {
    const route = routes.find((r) => r.re.test(path));
    const op = route?.ops?.[method.toLowerCase()];
    if (!op) return null; // undocumented operation: out of scope here

    const operation = `${method.toUpperCase()} ${route.template}`;
    const statusKey = [String(status), `${String(status)[0]}XX`, "default"].find((k) => op.responses?.[k]);
    if (!statusKey) return { operation, violations: [`status ${status} is not documented`] };

    const media = op.responses[statusKey].content?.["application/json"];
    if (!media?.schema) return null; // no JSON schema documented for this response

    const pointer = ["paths", route.template, method.toLowerCase(), "responses", statusKey, "content", "application/json", "schema"]
      .map(escapePointer)
      .join("/");
    let check = compiled.get(pointer);
    if (!check) {
      check = ajv.compile({ $ref: `openapi#/${pointer}` });
      compiled.set(pointer, check);
    }
    if (check(body)) return null;
    return {
      operation,
      violations: check.errors.map((e) => `${e.instancePath || "(root)"} ${e.message}`),
    };
  };
}

/** Load docs/api/openapi.yaml and build a validator, or null if missing. */
export function loadResponseValidator(specPath) {
  if (!fs.existsSync(specPath)) return null;
  return createResponseValidator(parse(fs.readFileSync(specPath, "utf8")));
}

/** Express middleware that enforces `validate` on JSON responses. */
export function responseValidationMiddleware(validate) {
  return (req, res, next) => {
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      const path = req.originalUrl.split("?")[0];
      const result = validate(req.method, path, res.statusCode, JSON.parse(JSON.stringify(body ?? null)));
      if (!result) return sendJson(body);
      logger.error(`[openapi] ${result.operation} ${res.statusCode}: ${result.violations.join("; ")}`);
      res.status(500);
      return sendJson({ error: "Response does not match the OpenAPI spec", ...result });
    };
    next();
  };
}
