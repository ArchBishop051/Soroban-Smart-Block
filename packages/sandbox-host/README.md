# soroban-sandbox-host

The Soroban host (`soroban-env-host` 21.2.1) compiled to `wasm32-unknown-unknown`,
so the Sandbox can simulate contract calls in the browser, including offline (#925).

Calls go through `invoke_host_function_in_recording_mode`, the same entry point
Soroban RPC's `simulateTransaction` uses. Return values and events therefore
match network simulation when the host runs on the same ledger state.

## Build

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
./build.sh          # → frontend/public/sandbox-host/ (served at /sandbox-host/)
./build.sh nodejs   # → parity/pkg/ (used by e2e parity tests)
```

This crate is independent of the root Cargo workspace, like `contracts/ticket`.
Keep `soroban-env-host` on the same major version as the contracts' `soroban-sdk`.

## Download size budget

`build.sh` fails the build if the `.wasm` file is larger than **3 MiB**
(`MAX_WASM_BYTES`). It is about 2.1 MiB today, or roughly 0.7 MiB gzipped.
The frontend loads it only after the user turns on local execution. It runs in
a Web Worker, and `public/sw.js` caches it cache-first so later sessions work
offline.

## JS API (`SandboxHost`)

All XDR values are base64 strings.

| Method | Purpose |
|---|---|
| `new SandboxHost()` | Empty in-memory ledger with testnet defaults |
| `setLedgerInfo(protocol, sequence, timestamp: bigint, passphrase)` | Set the ledger header |
| `setSourceAccount(accountIdXdr)` | Set the invoking account |
| `setLedgerEntry(keyXdr, entryXdr, liveUntil?)` / `removeLedgerEntry(keyXdr)` | Change state freely |
| `invoke(hostFunctionXdr, diagnostics)` | Upload WASM, create a contract, or invoke one. Returns JSON `{ result, error, events, diagnosticEvents, auth, resources, budget: { cpuInsns, memBytes }, stateDiff }` and applies the changes to the ledger |
| `hostProtocolVersion()` | Protocol of the bundled host. The UI warns when the imported network state uses a different one |

## Importing network state

The frontend (`LocalSandboxHost.importState`) runs one RPC simulation through
the indexer proxy. It reads the footprint, which lists every entry the call
touches, including the instances and WASM of any contracts it calls. It then
fetches those entries from `POST /api/sandbox/ledger-entries` and loads them
into the host. After that, you can change the entries and re-run with no
network access.

## Parity tests

```bash
./build.sh nodejs
cd ../../e2e && RPC_URL=https://soroban-testnet.stellar.org npm run test:parity
```

The test runs 23 invocations against the testnet native-asset contract and
checks that return values and contract events match RPC simulation.
CPU and memory budgets are shown in the UI but not compared. RPC prices them
with the network's on-chain cost parameters, while the host uses the built-in
defaults.
