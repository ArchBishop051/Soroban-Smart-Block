# Source Verification

A source-verification record is valid only when a Stellar Ed25519 signature authenticates the exact artifact hashes.

The signed message is the UTF-8 string:

```text
soroban-source-verification:v1:<wasm_hash>:<compiler_hash>
```

Both hashes must be lowercase SHA-256 hex strings. `signer` is a Stellar `G...` public key and `signature` is its 64-byte signature encoded as base64. The API verifies this message before storing a record, so the frontend badge counts authenticated signatures rather than self-reported claims.

Contract builds use `scripts/build-contract.sh`. It writes a `.build-manifest` beside the WASM containing the Git commit, `Cargo.lock` hash, and WASM hash. `contracts/deploy.sh` refuses to deploy when the manifest is absent or does not match the current checkout.

CI additionally runs `cargo deny check advisories bans licenses sources`, `npm audit --audit-level=high` for the indexer and frontend, and GitHub Dependency Review on pull requests.
