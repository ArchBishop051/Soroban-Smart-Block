# API contract testing and fuzzing

Checks that the running API conforms to `docs/api/openapi.yaml` (#907).

- **Response validation (test mode):** start the indexer with
  `OPENAPI_VALIDATE_RESPONSES=true`. Any JSON response to a documented
  operation that doesn't match its schema, or that uses an undocumented
  status code, is replaced by a 500 naming the operation and the violations
  (`indexer/src/openapiValidator.js`). Unit tests:
  `indexer/test/openapiValidator.test.js`, including a deliberate
  spec/response mismatch.
- **Fuzzing:** [Schemathesis](https://schemathesis.readthedocs.io) generates
  requests for every operation and runs all checks: no server errors,
  status codes, content types, headers and response schemas.

| Profile | Where | Scope |
| --- | --- | --- |
| `fast` | `ci.yml` job `api-fuzz`, every PR, < 8 min | all `GET` operations, 10 examples each |
| `deep` | `e2e-nightly.yml` job `api-fuzz-deep` | all methods, 200 examples each, plus stateful sequences via OpenAPI `links` (e.g. `POST /api/contracts` → `GET /api/contracts/{id}`) |

## Running locally

```bash
pip install -r tests/api-fuzz/requirements.txt
cd indexer && OPENAPI_VALIDATE_RESPONSES=true RATE_LIMITING_DISABLED=true npm start &
cd seed-data && node seed.js
tests/api-fuzz/run.sh fast        # or: deep
```

Authenticated scopes: set `FUZZ_API_KEY` (regular key) and `FUZZ_ADMIN_KEY`
(admin routes are only fuzzed when it is set). Rate limiting is disabled only
for the fuzz run.

When the fuzzer finds a bug, fix the API or the spec (whichever is wrong) in
the same PR. To add stateful coverage, add `links` to the spec's responses.
