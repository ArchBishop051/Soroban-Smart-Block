# CDN edge caching

Most explorer reads don't change until a new ledger touches them, and some
never change. The API marks every response so a CDN can cache it at the edge,
and the indexer purges only what each ledger changed.

Code: `edgeCachePolicy` in `indexer/src/cacheLayer.js` (classification and
headers), `indexer/src/cdnPurge.js` (purge adapters), purge hooks in
`indexer/src/index.js` (each ledger) and `indexer/src/reorgWorker.js` (reorgs).

## Endpoint classes

| Class | Endpoints | Edge TTL | Surrogate keys |
| --- | --- | --- | --- |
| Immutable | `/api/events/:seq[/…]` | 1 day | `event:<seq>` |
| Ledger-scoped: contract | `/api/contracts/:id…`, `/api/spec/:id…`, `/api/tokens/:id…` | `CDN_EDGE_TTL_SECONDS` (default 1 h) | `contract:<id>`, `latest` |
| Ledger-scoped: global | every other `GET /api/*` (lists, stats, search) | `CDN_EDGE_TTL_SECONDS` | `latest` |
| Private | non-GET; admin, dashboard, webhooks, keys, sandbox, transactions, health, metrics, auth, billing, … | not cached (`no-store`) | — |

Headers set on every `/api/*` response:

| Header | For |
| --- | --- |
| `Surrogate-Control` | Edge TTL for Fastly / Varnish (stripped before the browser) |
| `CDN-Cache-Control` | Edge TTL for Cloudflare |
| `Surrogate-Key` (space-separated) | Fastly / Varnish (`xkey`) purge keys |
| `Cache-Tag` (comma-separated) | Cloudflare purge tags |

Browser caching is still controlled by each handler's `Cache-Control`, so
edge and browser TTLs don't conflict. All edge TTLs include
`stale-while-revalidate`.

## Purging

After each ledger page is committed, the daemon enqueues `latest` plus
`contract:<id>` for every contract the page touched. On a reorg it enqueues
`latest`, and `event:<seq>` and `contract:<id>` for every rolled-back event.

Keys are de-duplicated, debounced (`CDN_PURGE_DEBOUNCE_MS`, default 250 ms)
and sent in batches of up to 256 keys.

| `CDN_PROVIDER` | Settings | Mechanism |
| --- | --- | --- |
| `none` (default) | — | No-op, for local development |
| `fastly` | `FASTLY_API_TOKEN`, `FASTLY_SERVICE_ID` | `POST /service/:id/purge` with `Surrogate-Key` |
| `cloudflare` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID` | `POST /zones/:id/purge_cache` `{ tags }` (Enterprise cache tags) |
| `http` | `CDN_PURGE_URL` | `POST { keys: [...] }` to your endpoint, e.g. a Varnish `xkey` purge handler, or a function that maps keys to CloudFront path invalidations |

### Freshness SLA

"Latest" endpoints are purged within **2 seconds** of a ledger commit
(250 ms debounce + purge API latency), so after that window a client never
sees data more than one ledger old.

### Purge outages

If a purge request fails, the API immediately lowers every edge TTL to
**5 seconds** until a purge succeeds again. Stale data is bounded even when
the CDN API is down; origin load rises for the duration.

## Authenticated requests

The API key is **not** part of the edge cache key (the API does not `Vary` on
it). Authenticated clients reading public data share edge entries with
everyone else, which is where most of the origin savings come from.

Edge hits never reach the origin rate limiter. Per-key usage for cached reads
must be counted from CDN logs: log the `X-API-Key` header, hashed, and ingest
those logs into the usage pipeline. Enforce hard limits at the edge where the
CDN supports it (e.g. Cloudflare rate-limiting rules keyed on the header).
Private endpoints are never cached and are always rate-limited at the origin.

## Local testing with Varnish

```vcl
vcl 4.1;
import xkey;
backend default { .host = "indexer"; .port = "3001"; }

sub vcl_recv {
  if (req.method == "PURGE") {
    return (synth(200, "Purged " + xkey.purge(req.http.xkey-purge)));
  }
}
sub vcl_backend_response {
  set beresp.http.xkey = beresp.http.Surrogate-Key;
}
```

Point `CDN_PROVIDER=http` at a small handler that turns `{ keys }` into
`PURGE` requests with `xkey-purge: <keys>`. Then check hit ratios with
`varnishstat` while replaying the k6 read profile (`e2e/test/load/`).
