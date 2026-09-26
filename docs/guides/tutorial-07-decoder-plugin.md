# Tutorial 7 — Write a decoder plugin

> **In progress:** the indexer cannot load external decoder plugins yet, so this tutorial is excluded from CI. To ship a decoder today, follow [adding-a-decoder.md](./adding-a-decoder.md).

**Time:** ~15 minutes · **Source:** [`examples/tutorials/07-decoder-plugin`](../../examples/tutorials/07-decoder-plugin/)

## The plugin

A plugin is a pure object: `match` picks events, `describe` returns a sentence.

<!-- snippet: examples/tutorials/07-decoder-plugin/plugin.mjs#plugin -->

## Test it against fixtures

<!-- snippet: examples/tutorials/07-decoder-plugin/index.mjs#fixtures -->

## Run it

```bash
node 07-decoder-plugin/index.mjs
```
