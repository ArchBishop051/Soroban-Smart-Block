# Decoder plugins

Community decoders that turn a contract's events into human-readable
descriptions. Every plugin runs in a sandbox (`indexer/src/plugins/`) with no
access to Node APIs, the filesystem, the network or `process.env`.

## Layout

```
indexer/plugins/
  allowlist.json            { "<name>@<version>": "<sha256 of entry source>" }
  my-token/
    manifest.json
    index.js
```

`manifest.json`:

```json
{
  "name": "my-token",
  "version": "1.0.0",
  "entry": "index.js",
  "matchers": [{ "contract_id": "CABC…", "function": "transfer" }]
}
```

A plugin is only called for events matching one of its `matchers`. Each
matcher field is optional, and all the fields present must match.

`index.js`:

```js
module.exports.decode = (event, helpers) => {
  // event: { contract_id, function, ledger, tx_hash, topics, data }, plain JSON
  // (i128/u64 values arrive as decimal strings)
  if (event.function !== "transfer") return null; // null = not handled
  return {
    description: `${helpers.shortAddress(event.topics[1])} sent ${helpers.formatAmount(event.data)} to ${helpers.shortAddress(event.topics[2])}`,
  };
};
```

Return `{ description, function? }` or `null`. Any other shape is rejected.

Available helpers: `formatAmount(amount, decimals = 7)` and
`shortAddress(address)`. There is no `require`, `process`, `fetch`, timers,
`eval` or `Function`.

## Limits

| Limit | Default |
| --- | --- |
| CPU time per call | 50 ms |
| Memory per plugin | 32 MB |
| Output size | 16 KB |

A violation (timeout, out of memory, oversized or malformed output, or a
thrown error) sends the event to the dead-letter queue with the reason. After
3 violations the plugin is disabled until the indexer restarts. Events a
plugin doesn't decode fall through to the built-in decoders.

## Allowlisting (maintainers)

Plugins load only if they're listed in `allowlist.json` with the exact
sha256 of their entry file:

```bash
sha256sum indexer/plugins/my-token/index.js
```

Review the source and add `"my-token@1.0.0": "<hash>"` in the same PR. Any
change to the source needs a new review and hash. Set `DECODER_PLUGINS_DIR`
to load plugins from another directory.
