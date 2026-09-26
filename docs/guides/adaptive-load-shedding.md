# Adaptive API load shedding

The indexer applies an adaptive in-flight request cap to API, RPC, analytics,
and admin route classes. Every 20 completed requests, each class adjusts its
limit using observed request latency: slow windows reduce the cap multiplicatively,
while healthy saturated windows increase it additively. Defaults are 100, 40,
10, and 20 concurrent requests respectively.

Requests beyond the current cap are rejected immediately with `503` and
`Retry-After: 1`; enterprise/pro requests have reserved capacity above the
base cap. `/health`, `/api/health`, `/health/live`, and `/health/ready` are
exempt from concurrency shedding.

`GET /api/load-shedder` reports each class's current limit, active request
count, and shed counts by tier. Prometheus exposes
`soroban_load_shed_requests_total`, `soroban_adaptive_concurrency_limit`, and
`soroban_active_requests`; alert on sustained shed rates and low adaptive
limits. Limits and counters are process-local and apply independently to each
indexer instance.
