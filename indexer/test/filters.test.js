import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFilter,
  toFilterAst,
  validateFilter,
  planFilter,
  evaluateFilter,
  FilterError,
  OPS,
} from "../src/filters/filter.js";
import { compileFilter } from "../src/filters/sql.js";

// ── Parser ───────────────────────────────────────────────────────────────────

test("parses the textual form into an AST", () => {
  assert.deepEqual(
    parseFilter('contract_id = "CA" and args.amount > 1000000 and (topic[1] = "GX" or not function in ("mint", "burn"))'),
    {
      and: [
        { field: "contract_id", op: "eq", value: "CA" },
        { field: "args.amount", op: "gt", value: 1000000 },
        {
          or: [
            { field: "topic[1]", op: "eq", value: "GX" },
            { not: { field: "function", op: "in", value: ["mint", "burn"] } },
          ],
        },
      ],
    },
  );
  assert.deepEqual(parseFilter("ledger between 10 and 20"), { field: "ledger", op: "between", value: [10, 20] });
  assert.deepEqual(parseFilter("args.to exists"), { field: "args.to", op: "exists" });
  // i128 beyond 2^53 stays an exact string.
  assert.deepEqual(parseFilter("args.amount >= 170141183460469231731687303715884105727"), {
    field: "args.amount",
    op: "gte",
    value: "170141183460469231731687303715884105727",
  });
});

test("rejects unknown fields, operators and malformed input", () => {
  assert.throws(() => parseFilter("password = 1"), FilterError);
  assert.throws(() => parseFilter("contract_id ~ 1"), FilterError);
  assert.throws(() => parseFilter('contract_id = "CA" and'), FilterError);
  assert.throws(() => validateFilter({ field: "ledger", op: "gt", value: "1; drop" }), FilterError);
  assert.throws(() => validateFilter({ field: "args.a.b.c.d.e.f.g.h.i", op: "exists" }), FilterError);
  assert.throws(() => toFilterAst("{not json"), FilterError);
});

// ── Planner ──────────────────────────────────────────────────────────────────

test("planner refuses filters that cannot use an index", () => {
  assert.equal(planFilter(parseFilter('contract_id = "CA"')).ok, true);
  assert.equal(planFilter(parseFilter("args.amount > 5")).ok, false);
  assert.equal(planFilter(parseFilter('contract_id = "CA" and args.amount > 5')).ok, false); // no ledger bound
  assert.equal(planFilter(parseFilter('contract_id = "CA" and ledger between 100 and 5000 and args.amount > 5')).ok, true);
  assert.equal(planFilter(parseFilter('contract_id = "CA" and ledger between 0 and 999999999 and args.amount > 5')).ok, false);
  assert.equal(planFilter(parseFilter('contract_id = "CA" or args.amount > 5')).ok, false);
});

// ── Evaluator (same semantics as SQL) ───────────────────────────────────────

const event = {
  contract_id: "CA",
  function: "transfer",
  ledger: 150,
  seq: 9,
  raw_topics: ["transfer", "GFROM", "GTO"],
  raw_data: JSON.stringify({ amount: "170141183460469231731687303715884105727", to: "GTO", memo: { tags: ["a", "b"] } }),
};

test("evaluator: i128 amounts compare numerically whatever their JSON form", () => {
  const ev = (src) => evaluateFilter(parseFilter(src))(event);
  assert.equal(ev("args.amount > 1000000"), true);
  assert.equal(ev("args.amount > 170141183460469231731687303715884105726"), true);
  assert.equal(ev("args.amount = 170141183460469231731687303715884105727"), true);
  assert.equal(evaluateFilter(parseFilter("args.amount > 5"))({ ...event, raw_data: '{"amount": 10}' }), true);
  assert.equal(evaluateFilter(parseFilter("args.amount > 50"))({ ...event, raw_data: '{"amount": "9"}' }), false);
});

test("evaluator: paths into arrays/maps; missing fields are false (not errors)", () => {
  const ev = (src) => evaluateFilter(parseFilter(src))(event);
  assert.equal(ev('args.memo.tags.1 = "b"'), true);
  assert.equal(ev("args.nope.deeper > 1"), false);
  assert.equal(ev("not args.nope = 1"), true);
  assert.equal(ev('topic[1] = "GFROM" and topic[3] exists'), false);
  assert.equal(ev('function in ("mint", "transfer")'), true);
  assert.equal(evaluateFilter(parseFilter("args.amount > 1"))({ ...event, raw_data: "not json" }), false);
});

// ── Compiler: fuzzed against an injection oracle ─────────────────────────────

const HOSTILE = ["'; DROP TABLE events; --", "$1", '"', "\\", "' OR 1=1 --", "\u0000", "a'b", "); DELETE FROM events; --"];
let seed = 42;
const rand = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
const pick = (xs) => xs[rand(xs.length)];

function randomValue(numeric) {
  if (numeric) return pick([rand(1e6), String(rand(1e9)), "170141183460469231731687303715884105727", -rand(100)]);
  return pick([...HOSTILE, "GABC", "transfer", true, false, rand(1000), "12.5"]);
}

function randomPredicate() {
  const field = pick(["contract_id", "function", "tx_hash", "ledger", "seq", "topic[0]", "topic[2]", "args.amount", "args.memo.tags.0", "args.to"]);
  const numericCol = field === "ledger" || field === "seq";
  const op = pick(OPS);
  if (op === "exists") return { field, op };
  if (op === "in") return { field, op, value: Array.from({ length: 1 + rand(4) }, () => (numericCol ? rand(1e6) : randomValue(false))) };
  if (op === "between") return { field, op, value: [numericCol ? rand(100) : randomValue(false), numericCol ? rand(1e6) : randomValue(false)] };
  return { field, op, value: numericCol ? rand(1e6) : randomValue(false) };
}

function randomAst(depth = 0) {
  const r = rand(depth > 3 ? 1 : 5);
  if (r === 0 || depth > 3) return randomPredicate();
  if (r === 1) return { not: randomAst(depth + 1) };
  const list = Array.from({ length: 1 + rand(3) }, () => randomAst(depth + 1));
  return r === 2 ? { or: list } : { and: list };
}

// Everything the compiler may emit besides placeholders.
const ALLOWED_SQL = /^(?:\s|\(|\)|,|\$\d+|::(?:text|bigint|numeric)(?:\[\])?|=|<>|>=|<=|>|<|->>?|#>>|\d|AND|OR|NOT|IS|NULL|ANY|BETWEEN|COALESCE|FALSE|to_jsonb|explorer_numeric|explorer_try_jsonb|contract_id|function|tx_hash|ledger|seq|raw_topics|raw_data)+$/;

test("compiler: 100k random ASTs produce well-formed, fully parameterized SQL", () => {
  let compiled = 0;
  for (let i = 0; i < 100_000; i++) {
    const ast = randomAst();
    try {
      validateFilter(ast);
    } catch {
      continue; // e.g. hostile value on an integer column: rejected before compiling
    }
    const { sql, params } = compileFilter(ast);
    compiled++;
    assert.match(sql, ALLOWED_SQL, sql);
    assert.equal(sql.split("(").length, sql.split(")").length, "unbalanced parentheses");
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    assert.equal(Math.max(0, ...placeholders), params.length, "every param has a placeholder");
    for (const bad of HOSTILE) if (bad.length > 2) assert.ok(!sql.includes(bad), `value leaked into SQL: ${bad}`);
  }
  assert.ok(compiled > 50_000, `only ${compiled} ASTs compiled`);
});

test("compiler: indexed shapes and i128-safe numeric comparison", () => {
  const { sql, params } = compileFilter(parseFilter('contract_id = "CA" and ledger >= 100 and topic[0] = "transfer" and args.amount > 5'));
  assert.equal(
    sql,
    "((contract_id = $1) AND (ledger >= $2::bigint) AND (raw_topics->0 = to_jsonb($3::text)) AND (explorer_numeric((explorer_try_jsonb(raw_data) #>> $4::text[])) > $5::numeric))",
  );
  assert.deepEqual(params, ["CA", "100", "transfer", ["amount"], "5"]);
  assert.match(compileFilter(parseFilter("not args.x = 1")).sql, /NOT COALESCE/);
});

// ── API ──────────────────────────────────────────────────────────────────────

test("GET /api/events?filter= validates, plans and runs the compiled filter", async () => {
  const { default: request } = await import("supertest");
  const { PassThrough } = await import("node:stream");
  const { createApi } = await import("../src/api.js");
  const calls = [];
  const app = createApi({
    logDestination: new PassThrough(),
    dbOverride: {
      async queryEventsByFilter(args) {
        calls.push(args);
        return { data: [], next_cursor: null, estimated_cost: 1 };
      },
    },
  });

  const bad = await request(app).get("/api/events").query({ filter: "password = 1" });
  assert.equal(bad.status, 400);

  const unindexed = await request(app).get("/api/events").query({ filter: "args.amount > 5" });
  assert.equal(unindexed.status, 422);

  const ok = await request(app).get("/api/events").query({ filter: `contract_id = "CA" and function = "transfer"` });
  assert.equal(ok.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where, "((contract_id = $1) AND (function = $2))");
  assert.deepEqual(calls[0].params, ["CA", "transfer"]);
  assert.equal(calls[0].maxCost, 10_000); // unauthenticated tier limits
  assert.equal(calls[0].timeoutMs, 1_000);

  // Saved queries belong to an API key; anonymous calls are refused (CSRF
  // rejects keyless state-changing requests before the handler: 403).
  const saved = await request(app).post("/api/queries").send({ name: "q", filter: 'contract_id = "CA"' });
  assert.ok([401, 403].includes(saved.status), `status ${saved.status}`);
  const list = await request(app).get("/api/queries");
  assert.equal(list.status, 401);
});
