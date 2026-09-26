# SLO and Error-Budget Policy

## SLOs

| SLO | Target | Window | Source |
|-----|--------|--------|--------|
| API availability (non-5xx) | 99.9% | 30 days | `api_request_duration_seconds_count` |

Rules live in `monitoring/prometheus/slo/` and are loaded by Prometheus alongside `alerts.yml`.

## Alerting

Multi-window, multi-burn-rate alerts replace single-threshold paging:

| Alert | Long / short window | Burn rate | Route |
|-------|---------------------|-----------|-------|
| `ApiAvailabilityFastBurn` | 1h / 5m | 14.4× | page |
| `ApiAvailabilitySlowBurn` | 6h / 30m | 6× | ticket |

Both require at least 100 requests in the last hour so low-traffic blips (e.g. 1 failure out of 3) never alert.

Test the rules with:

```bash
promtool test rules monitoring/prometheus/slo/api-availability.test.yml
```

## Error-budget policy

When `slo:api_error_budget:remaining` is at or below zero:

- Feature deploys are frozen. The `Error budget freeze check` step in `.github/workflows/deploy.yml` fails the deploy.
- Only reliability fixes ship. Mark them with `[reliability]` in the commit message to bypass the freeze.
- The freeze lifts automatically once the 30-day budget recovers above zero.
