# Event filters

Filter events on indexed columns, topic positions and decoded arguments, and
save filters to drive REST, WebSocket subscriptions and webhooks.

Code: `indexer/src/filters/filter.js` (parser, validation, planner,
evaluator) and `indexer/src/filters/sql.js` (SQL compiler).

## Where filters are accepted

| Where | How |
| --- | --- |
| `GET /api/events?filter=…` | Textual form or JSON AST, URL-encoded. Supports `limit` and `after_seq`. |
| `GET /api/events?query_id=…` | Runs a saved query owned by your API key |
| `POST /api/queries` `{ name, filter }` | Save a filter (API key required); list with `GET /api/queries`, run with `GET /api/queries/:id/events`, delete with `DELETE /api/queries/:id` |
| WebSocket | `?filter=…` on connect, or send `{"type":"subscribe","filter":…}` / `{"type":"unsubscribe"}` |
| `POST /api/webhooks` | `filter` (inline) or `query_id` (saved query); only matching events are delivered |

## Grammar (textual form)

```
expr    := or
or      := and ("or" and)*
and     := unary ("and" unary)*
unary   := "not" unary | "(" expr ")" | pred
pred    := FIELD OP value
         | FIELD "in" "(" value ("," value)* ")"
         | FIELD "between" value "and" value
         | FIELD "exists"
OP      := =  !=  >  >=  <  <=
value   := "string" | number | true | false
FIELD   := contract_id | function | tx_hash | ledger | seq
         | topic[0] … topic[3]
         | args.<path>          (identifiers or array indices, e.g. args.memo.tags.0)
```

## JSON AST

```json
{ "and": [
  { "field": "contract_id", "op": "eq", "value": "CA…" },
  { "field": "ledger", "op": "between", "value": [52000000, 52100000] },
  { "field": "args.amount", "op": "gt", "value": "1000000" },
  { "not": { "field": "topic[2]", "op": "in", "value": ["GABC…", "GDEF…"] } }
] }
```

Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in` (1–100 values),
`between` (`[low, high]`, inclusive), `exists`. Limits: 64 nodes, depth 8,
path depth 8, strings up to 256 characters.

## Examples

```text
function = "transfer" and topic[2] = "GABC…"
contract_id = "CTOKEN…" and ledger between 52000000 and 52050000 and args.amount > 1000000
contract_id in ("CA…", "CB…") and not function in ("mint", "burn")
topic[0] = "swap" and seq > 1000000
```

## Semantics

- **Numbers:** when the filter value is numeric, the field is compared
  numerically, so i128 amounts work whether stored as JSON numbers or
  strings, including values beyond 2^53. A non-numeric field value doesn't
  match.
- **Missing fields:** a missing path, missing topic or undecodable data
  evaluates to false, never an error, so `not args.x = 1` matches events
  without `args.x`.
- **Strings:** compared exactly (case-sensitive).

## Query planning and limits

A filter is refused (`422`) if it can't use an index:

- every `or` branch needs a condition on `contract_id`, `function`,
  `tx_hash`, `ledger`, `seq` or `topic[0]`;
- filters on `args.*` or `topic[1..3]` must also fix `contract_id` (`=` or
  `in`) and a ledger range of at most 120,000 ledgers (about 7 days).

Accepted filters are EXPLAINed first and refused if the estimated cost
exceeds the tier limit. They then run in a read-only transaction with a
statement timeout:

| Tier | Max estimated cost | Timeout |
| --- | --- | --- |
| unauthenticated | 10,000 | 1 s |
| free | 100,000 | 2 s |
| pro | 1,000,000 | 5 s |
| enterprise | 10,000,000 | 15 s |

## Safety

The compiler never concatenates values into SQL. Every value, including
`args` paths, is a bind parameter, and a fuzz test compiles 100,000 random
ASTs with hostile strings against an injection oracle
(`indexer/test/filters.test.js`).

## Soroban RPC `getEvents` filters

`GET /api/events?filters=<URL-encoded JSON>`, `POST /api/events { filters, limit?, after_seq? }`
and WebSocket `{"type":"subscribe","filters":[…]}` (or `?filters=` on connect)
accept the RPC `filters` shape verbatim:

```json
[{ "type": "contract", "contractIds": ["C…"], "topics": [["AAAADwAAAAh0cmFuc2Zlcg==", "*", "**"]] }]
```

- Topic segments are base64 XDR ScVals, compared on canonical XDR bytes, so
  a symbol and a string with the same text don't match each other. `*`
  matches exactly one segment. `**` (last segment only) matches zero or more
  remaining segments.
- An event with fewer topics than a pattern doesn't match, unless the
  pattern ends in `**`.
- Only contract events are indexed; `system` and `diagnostic` filters match
  nothing.
- Limits (as in Soroban RPC): at most 5 filters, 5 `contractIds` and 5 topic
  patterns per filter, and 4 segments per pattern (plus a trailing `**`).
- Topic hashes are stored in the indexed columns `topic0..topic3`
  (migration 039). Events indexed before that only match filters without
  topic patterns until they are re-indexed.
