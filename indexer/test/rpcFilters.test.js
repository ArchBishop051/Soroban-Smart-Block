import { test } from "node:test";
import assert from "node:assert/strict";
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";
import {
  topicColumns,
  parseRpcFilters,
  compileRpcFilters,
  matchRpcFilters,
  RpcFilterError,
} from "../src/rpcFilters.js";

const sym = (s) => xdr.ScVal.scvSymbol(s);
const str = (s) => xdr.ScVal.scvString(s);
const u32 = (n) => xdr.ScVal.scvU32(n);
const i128 = (n) => nativeToScVal(BigInt(n), { type: "i128" });
const b64 = (scv) => scv.toXDR("base64");

const CA = "C" + "A".repeat(55);
const CB = "C" + "B".repeat(55);

const event = (contract, topics) => ({ contract_id: contract, ...topicColumns(topics) });

// Canonical events
const TRANSFER = event(CA, [sym("transfer"), sym("GFROM"), sym("GTO"), str("USDC")]);
const MINT = event(CA, [sym("mint"), sym("GTO")]);
const STR_TRANSFER = event(CA, [str("transfer"), sym("GFROM"), sym("GTO"), str("USDC")]);
const OTHER = event(CB, [sym("transfer"), sym("GX"), sym("GY"), str("EURC")]);
const ONE = event(CA, [sym("ping")]);
const NUM = event(CB, [sym("set"), u32(7), i128("170141183460469231731687303715884105727")]);
const EVENTS = { TRANSFER, MINT, STR_TRANSFER, OTHER, ONE, NUM };

const T = (...segs) => segs.map((s) => (typeof s === "string" ? s : b64(s)));

// [name, filters, expected matching events]
const CASES = [
  ["no constraints matches everything", [{}], Object.keys(EVENTS)],
  ["type contract matches everything", [{ type: "contract" }], Object.keys(EVENTS)],
  ["type system matches nothing", [{ type: "system" }], []],
  ["type diagnostic matches nothing", [{ type: "diagnostic" }], []],
  ["contractId A", [{ contractIds: [CA] }], ["TRANSFER", "MINT", "STR_TRANSFER", "ONE"]],
  ["contractId B", [{ contractIds: [CB] }], ["OTHER", "NUM"]],
  ["contractIds A or B", [{ contractIds: [CA, CB] }], Object.keys(EVENTS)],
  ["unknown contract", [{ contractIds: ["C" + "Z".repeat(55)] }], []],
  ["exact 4 segments", [{ topics: [T(sym("transfer"), sym("GFROM"), sym("GTO"), str("USDC"))] }], ["TRANSFER"]],
  ["symbol vs string first segment are distinct", [{ topics: [T(str("transfer"), "*", "*", "*")] }], ["STR_TRANSFER"]],
  ["symbol transfer with 4 segments", [{ topics: [T(sym("transfer"), "*", "*", "*")] }], ["TRANSFER", "OTHER"]],
  ["fewer filter segments than topics does not match", [{ topics: [T(sym("transfer"))] }], []],
  ["more filter segments than topics does not match", [{ topics: [T(sym("mint"), "*", "*")] }], []],
  ["exact 2 segments mint", [{ topics: [T(sym("mint"), sym("GTO"))] }], ["MINT"]],
  ["mint with wildcard", [{ topics: [T(sym("mint"), "*")] }], ["MINT"]],
  ["single wildcard matches only 1-topic events", [{ topics: [T("*")] }], ["ONE"]],
  ["two wildcards", [{ topics: [T("*", "*")] }], ["MINT"]],
  ["three wildcards", [{ topics: [T("*", "*", "*")] }], ["NUM"]],
  ["four wildcards", [{ topics: [T("*", "*", "*", "*")] }], ["TRANSFER", "STR_TRANSFER", "OTHER"]],
  ["** alone matches all", [{ topics: [T("**")] }], Object.keys(EVENTS)],
  ["prefix transfer **", [{ topics: [T(sym("transfer"), "**")] }], ["TRANSFER", "OTHER"]],
  ["prefix mint ** (zero remaining allowed too)", [{ topics: [T(sym("mint"), sym("GTO"), "**")] }], ["MINT"]],
  ["ping ** matches with zero remaining", [{ topics: [T(sym("ping"), "**")] }], ["ONE"]],
  ["* ** requires at least one", [{ topics: [T("*", "**")] }], Object.keys(EVENTS)],
  ["* * ** requires at least two", [{ topics: [T("*", "*", "**")] }], ["TRANSFER", "MINT", "STR_TRANSFER", "OTHER", "NUM"]],
  ["* * * * ** requires four", [{ topics: [T("*", "*", "*", "*", "**")] }], ["TRANSFER", "STR_TRANSFER", "OTHER"]],
  ["second segment GFROM", [{ topics: [T("*", sym("GFROM"), "**")] }], ["TRANSFER", "STR_TRANSFER"]],
  ["third segment GTO", [{ topics: [T("*", "*", sym("GTO"), "**")] }], ["TRANSFER", "STR_TRANSFER"]],
  ["fourth segment USDC string", [{ topics: [T("*", "*", "*", str("USDC"))] }], ["TRANSFER", "STR_TRANSFER"]],
  ["fourth segment USDC symbol (distinct from string)", [{ topics: [T("*", "*", "*", sym("USDC"))] }], []],
  ["GTO as second segment", [{ topics: [T("*", sym("GTO"))] }], ["MINT"]],
  ["u32 7 segment", [{ topics: [T(sym("set"), u32(7), "*")] }], ["NUM"]],
  ["u32 8 does not match", [{ topics: [T(sym("set"), u32(8), "*")] }], []],
  ["i128 max value segment", [{ topics: [T(sym("set"), "*", i128("170141183460469231731687303715884105727"))] }], ["NUM"]],
  ["i128 off by one", [{ topics: [T(sym("set"), "*", i128("170141183460469231731687303715884105726"))] }], []],
  ["u32 7 vs i128 7 are distinct", [{ topics: [T(sym("set"), i128("7"), "*")] }], []],
  ["contract A and transfer", [{ contractIds: [CA], topics: [T(sym("transfer"), "**")] }], ["TRANSFER"]],
  ["contract B and transfer", [{ contractIds: [CB], topics: [T(sym("transfer"), "**")] }], ["OTHER"]],
  ["contract B and mint", [{ contractIds: [CB], topics: [T(sym("mint"), "**")] }], []],
  ["topic patterns are OR-ed", [{ topics: [T(sym("mint"), "*"), T(sym("ping"))] }], ["MINT", "ONE"]],
  ["three OR-ed patterns", [{ topics: [T(sym("mint"), "*"), T(sym("ping")), T(sym("set"), "**")] }], ["MINT", "ONE", "NUM"]],
  ["filters are OR-ed", [{ contractIds: [CB] }, { topics: [T(sym("ping"))] }], ["OTHER", "NUM", "ONE"]],
  ["system filter OR contract filter", [{ type: "system" }, { contractIds: [CB] }], ["OTHER", "NUM"]],
  ["same pattern twice", [{ topics: [T(sym("ping")), T(sym("ping"))] }], ["ONE"]],
  ["wildcard then exact then wildcard", [{ topics: [T("*", sym("GX"), "*", "*")] }], ["OTHER"]],
  ["exact first, wildcard rest, wrong length", [{ topics: [T(sym("transfer"), "*", "*")] }], []],
  ["empty topics array means any", [{ topics: [] }], Object.keys(EVENTS)],
  ["empty contractIds means any", [{ contractIds: [] }], Object.keys(EVENTS)],
  ["contract A, pattern only matching B", [{ contractIds: [CA], topics: [T("*", sym("GX"), "**")] }], []],
  ["five filters", [
    { topics: [T(sym("ping"))] },
    { topics: [T(sym("mint"), "**")] },
    { contractIds: [CB], topics: [T(sym("set"), "**")] },
    { type: "diagnostic" },
    { topics: [T(str("transfer"), "**")] },
  ], ["ONE", "MINT", "NUM", "STR_TRANSFER"]],
  ["string transfer prefix", [{ topics: [T(str("transfer"), "**")] }], ["STR_TRANSFER"]],
  ["symbol ping exact", [{ topics: [T(sym("ping"))] }], ["ONE"]],
];

/**
 * Evaluate the compiled SQL against an in-memory row, as a model of what
 * Postgres will do (the SQL is a tiny, fixed grammar).
 */
function evalSql(sql, params, ev) {
  const hashes = ev.topic_hashes ?? [];
  const js = sql
    .replace(/contract_id = ANY\(\$(\d+)::text\[\]\)/g, (_, i) => `P[${i - 1}].includes(E.contract_id)`)
    .replace(/topic(\d) = \$(\d+)::bytea/g, (_, t, i) => `(H[${t}] === P[${i - 1}].toString("hex"))`)
    .replace(/topic_count >= (\d+)/g, "C >= $1")
    .replace(/topic_count = (\d+)/g, "C === $1")
    .replace(/\bAND\b/g, "&&")
    .replace(/\bOR\b/g, "||")
    .replace(/\bTRUE\b/g, "true")
    .replace(/\bFALSE\b/g, "false");
  return new Function("P", "E", "H", "C", `return ${js};`)(params, ev, hashes, ev.topic_count);
}

test(`conformance: ${CASES.length} filter cases (matcher and compiled SQL agree)`, () => {
  assert.ok(CASES.length >= 50);
  for (const [name, filters, expected] of CASES) {
    const parsed = parseRpcFilters(filters);
    const match = matchRpcFilters(parsed);
    const { sql, params } = compileRpcFilters(parsed);
    const byMatcher = Object.entries(EVENTS).filter(([, e]) => match(e)).map(([k]) => k).sort();
    const bySql = Object.entries(EVENTS).filter(([, e]) => evalSql(sql, params, e)).map(([k]) => k).sort();
    assert.deepEqual(byMatcher, [...expected].sort(), `matcher: ${name}`);
    assert.deepEqual(bySql, [...expected].sort(), `sql: ${name}`);
  }
});

test("events indexed before topic hashes only match topic-less filters", () => {
  const legacy = { contract_id: CA };
  assert.equal(matchRpcFilters(parseRpcFilters([{ contractIds: [CA] }]))(legacy), true);
  assert.equal(matchRpcFilters(parseRpcFilters([{ topics: [T("**")] }]))(legacy), false);
});

test("limits and validation follow Soroban RPC", () => {
  const bad = [
    [],
    Array(6).fill({}),
    [{ contractIds: Array(6).fill(CA) }],
    [{ topics: Array(6).fill(T("*")) }],
    [{ topics: [T("*", "*", "*", "*", "*")] }],
    [{ topics: [T("**", "*")] }],
    [{ topics: [["not-xdr!"]] }],
    [{ contractIds: ["GABC"] }],
    [{ type: "nope" }],
    [{ extra: 1 }],
    [{ topics: [[]] }],
  ];
  for (const filters of bad) assert.throws(() => parseRpcFilters(filters), RpcFilterError, JSON.stringify(filters));
  assert.throws(() => parseRpcFilters("{not json"), RpcFilterError);
  assert.doesNotThrow(() => parseRpcFilters(JSON.stringify([{ topics: [T("*", "*", "*", "*", "**")] }])));
});

test("compiled SQL is parameterized and index-friendly", () => {
  const { sql, params } = compileRpcFilters(parseRpcFilters([{ contractIds: [CA], topics: [T(sym("transfer"), "*", "**")] }]));
  assert.equal(sql, "((contract_id = ANY($1::text[]) AND ((topic0 = $2::bytea AND topic_count >= 2))))");
  assert.deepEqual(params[0], [CA]);
  assert.ok(Buffer.isBuffer(params[1]));
});

test("GET /api/events?filters= and POST /api/events accept RPC filters", async () => {
  const { default: request } = await import("supertest");
  const { PassThrough } = await import("node:stream");
  const { createApi } = await import("../src/api.js");
  const calls = [];
  const app = createApi({
    logDestination: new PassThrough(),
    dbOverride: {
      async queryEventsByFilter(args) {
        calls.push(args);
        return { data: [], next_cursor: null };
      },
    },
  });
  const filters = [{ contractIds: [CA], topics: [T(sym("transfer"), "**")] }];
  const get = await request(app).get("/api/events").query({ filters: JSON.stringify(filters) });
  assert.equal(get.status, 200);
  assert.match(calls[0].where, /topic0 = \$2::bytea/);

  const bad = await request(app).get("/api/events").query({ filters: JSON.stringify([{ topics: [["**", "*"]] }]) });
  assert.equal(bad.status, 400);

  process.env.API_KEY = "rpc-filter-test-key";
  const post = await request(app).post("/api/events").set("x-api-key", "rpc-filter-test-key").send({ filters, limit: 5 });
  assert.equal(post.status, 200);
  assert.equal(calls[1].limit, 5);
  delete process.env.API_KEY;
});
