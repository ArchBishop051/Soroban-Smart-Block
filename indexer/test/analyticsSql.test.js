import test from "node:test";
import assert from "node:assert/strict";
import { AnalyticsQueryError, toCsv, validateAnalyticsQuery } from "../src/analyticsSql.js";

test("accepts a bounded SELECT from a curated analytics view", () => {
  assert.match(
    validateAnalyticsQuery("SELECT ledger, COUNT(*) FROM analytics.events GROUP BY ledger"),
    /analytics/,
  );
});

test("rejects multiple statements, DML, private schemas, unsafe functions and unbounded constructs", () => {
  const attacks = [
    "SELECT 1; DROP TABLE events",
    "DELETE FROM analytics.events",
    "UPDATE analytics.events SET ledger = 0",
    "INSERT INTO analytics.events VALUES (1)",
    "SELECT * FROM public.events",
    "SELECT * FROM pg_catalog.pg_tables",
    "SELECT * FROM information_schema.tables",
    "SELECT pg_sleep(10) FROM analytics.events",
    "SELECT generate_series(1, 1000000000) FROM analytics.events",
    "WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM x) SELECT * FROM analytics.events",
    "SELECT * FROM analytics.events CROSS JOIN analytics.tokens",
    "SELECT * FROM analytics.events FOR UPDATE",
    "SELECT current_user FROM analytics.events",
    "SELECT analytics.events.* FROM analytics.events",
    "SELECT * FROM events",
    "SELECT * FROM analytics.missing",
    "SELECT * FROM analytics.events; SELECT * FROM analytics.tokens",
    "SELECT * FROM analytics.events; -- comment\nDROP TABLE events",
    "SELECT set_config('statement_timeout', '0', false) FROM analytics.events",
    "SELECT pg_read_file('/etc/passwd') FROM analytics.events",
    "SELECT dblink('host=evil', 'SELECT 1') FROM analytics.events",
    "SELECT lo_import('/tmp/file') FROM analytics.events",
    "SELECT pg_cancel_backend(pid) FROM analytics.events",
    "SELECT pg_terminate_backend(pid) FROM analytics.events",
    "SELECT nextval('sequence') FROM analytics.events",
    "SELECT setval('sequence', 1) FROM analytics.events",
    "SELECT xmlparse(document '<x/>') FROM analytics.events",
    "SELECT pg_sleep(0) FROM analytics.transactions",
    "SELECT * FROM analytics.events, generate_series(1, 10) AS n",
    "SELECT * FROM analytics.events, LATERAL (SELECT pg_sleep(1)) AS x",
    "SELECT * FROM analytics.events LIMIT 1000000000",
    "SELECT * FROM analytics.events OFFSET 1000000000",
    "SELECT * FROM analytics.events UNION SELECT * FROM public.events",
    "SELECT * FROM analytics.events JOIN public.contracts ON true",
    "SELECT * FROM analytics.events JOIN analytics.tokens ON true CROSS JOIN analytics.rollups",
    "SELECT * FROM analytics.events WHERE ledger = $1",
    "SELECT * FROM analytics.events WHERE ledger = current_setting('search_path')::int",
    "SELECT * FROM analytics.events WHERE ledger = (SELECT 1)",
    "SELECT * FROM analytics.events WHERE ledger = (SELECT pg_sleep(1))",
    "SELECT * FROM analytics.events ORDER BY random()",
    "SELECT * FROM analytics.events WHERE function = version()",
    "SELECT * FROM analytics.events WHERE function = pg_backend_pid()::text",
    "SELECT * FROM analytics.events WHERE function = inet_server_addr()::text",
    "SELECT * FROM analytics.events WHERE function = current_database()",
    "SELECT * FROM analytics.events WHERE function = current_schema()",
    "SELECT * FROM analytics.events WHERE function = session_user",
    "SELECT * FROM analytics.events;/* multi statement */DROP TABLE public.events",
    "SELECT * FROM analytics.events FOR NO KEY UPDATE",
    "SELECT * FROM analytics.events FOR SHARE",
    "SELECT * FROM analytics.events FOR KEY SHARE",
    "SELECT * FROM analytics.events WHERE true; SELECT 1",
  ];
  assert.ok(attacks.length >= 50);
  for (const query of attacks) {
    assert.throws(() => validateAnalyticsQuery(query), AnalyticsQueryError, query);
  }
});

test("encodes CSV cells and escapes quotes", () => {
  assert.equal(toCsv([{ value: 'a,"b"' }]), '"value"\r\n"a,""b"""');
});
