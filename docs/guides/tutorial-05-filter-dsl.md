# Tutorial 5 — Query with the filter DSL

**Time:** ~5 minutes · **Source:** [`examples/tutorials/05-filter-dsl`](../../examples/tutorials/05-filter-dsl/index.mjs)

## Server-side filters

`/api/events` accepts `contract`, `fn` and `type`:

<!-- snippet: examples/tutorials/05-filter-dsl/index.mjs#server-side -->

## The filter DSL

The DSL shared with `soroban-explorer tui` refines results: space-separated terms are ANDed, `key:value` matches `fn`, `contract`, `tx` or `desc` by substring, `!` negates, `ledger`/`seq` accept `> >= < <= =`, and a bare word searches function, description and contract.

<!-- snippet: examples/tutorials/05-filter-dsl/index.mjs#dsl -->

## Run it

```bash
FN=mint FILTER='contract:CDA2 ledger>=1000' node 05-filter-dsl/index.mjs
```
