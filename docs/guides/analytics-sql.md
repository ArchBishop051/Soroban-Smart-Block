# Read-only analytics SQL

The indexer accepts `POST /api/sql` with `{ "query": "SELECT ...", "format": "json" }`.
Queries are parsed as one PostgreSQL statement and may read only the
`analytics.events`, `analytics.transactions`, `analytics.rollups`, and
`analytics.tokens` views. `format` may be `json` or `csv`; responses contain at
most 1,000 rows.

The endpoint requires an API key with a `free`, `pro`, or `enterprise` tier.
It applies per-tier daily query and execution-time quotas, an `EXPLAIN` cost
limit, a three-second statement timeout, and a 16 MB `work_mem` limit. CTEs,
subqueries, cross joins, system schemas, and functions outside the
aggregate/string/date allowlist are rejected.

Set `ANALYTICS_DATABASE_URL` to a dedicated PostgreSQL login role that is a
member of the `analytics_reader` role created by migration
`037_analytics_views.sql`. Do not point it at the indexer's privileged
`DATABASE_URL`; the endpoint intentionally returns `503` when the restricted
connection is not configured.

Example:

```json
{
  "query": "SELECT ledger, COUNT(*) AS events FROM analytics.events GROUP BY ledger ORDER BY ledger DESC LIMIT 20",
  "format": "json"
}
```
