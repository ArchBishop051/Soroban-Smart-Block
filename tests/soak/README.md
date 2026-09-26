# Soak test

Long-running load against the indexer to catch memory leaks, handle leaks
and latency drift that only appear after hours.

```bash
# terminal 1: a seeded indexer
cd indexer && RATE_LIMITING_DISABLED=true npm start
# terminal 2: the 2-hour local variant
make soak            # = node tests/soak/run.js --duration 2h
```

Every minute the harness samples the indexer's `/metrics`: RSS, heap,
event-loop lag p99 and active handles, plus client p50/p95/p99 latency. It
writes them to `tests/soak/reports/samples.jsonl` and, at the end, to
`summary.md`.

Load: about 20 requests/s across list, stats, search and health endpoints,
plus WebSocket clients that continuously connect and disconnect. Tune with
`--rps`, `--ws-clients` and `--interval`.

Analysis (`analyze.js`):
- Uses the post-GC floor (the minimum per 10-sample window) so the GC
  sawtooth isn't read as a leak.
- Ignores the first 20% (warm-up) and judges the trend on the rest of the
  run, so caches that grow to their bound and plateau pass.
- Fails if RSS grows by more than 5 MB/h, heap by more than 3 MB/h, or active
  handles by more than 5/h, or if p95 latency drifts past ×1.5.

`analyze.test.js` covers an injected leak (steady RSS and handle growth, as
from a listener retained per request), which the 2-hour variant detects.

CI: `.github/workflows/soak.yml` runs weekly. Set the `SOAK_RUNNER`
repository variable for a self-hosted or large runner, and pass
`duration: 72h`. GitHub-hosted runners are limited to 6 hours.
