# Contract Storage TTL Retention

The explorer stores registry metadata, ABI snapshots, and ring-buffer event slots in persistent storage. Persistent entries can still be archived after their TTL expires; `extend_ttl` only keeps a live entry alive and cannot read or revive an archived entry.

## Keeper cadence

Run a keeper at least once every 7 days to call `bump_contract_ttl(contract_id)` for each registered contract that must remain available. This refreshes the contract instance, current metadata entry, and current ABI snapshot. The call is permissionless; the transaction sender pays the resource fee.

For older ABI snapshots and retained event sequences, call `bump_contract_version_ttl(contract_id, abi_version)` and `bump_event_ttl(seq)` respectively. A 20-day cadence stays inside the 30-day extension threshold. Keep events only while their sequence remains inside the configured ring buffer; overwritten slots cannot be recovered from the contract.

Keep an off-chain inventory of contract IDs, ABI versions, and event sequences that the service promises to retain. A keeper should alert on failed calls and verify representative reads after each run. Do not rely on reads to extend TTLs.

## Restoring archived entries

An archived entry must be restored before any contract call that touches it. Submit a Soroban `RestoreFootprintOp` for the archived contract instance or persistent key, using the Soroban RPC simulation/restore preamble for the intended read or keepalive call, then retry that call. `bump_contract_ttl`, `bump_contract_version_ttl`, and `bump_event_ttl` cannot restore an already archived entry because contract code cannot read it until the footprint is restored.

If an entry was archived and later removed from the network archive, restore it from an off-chain backup or re-register the metadata; the contract cannot reconstruct deleted values. Event slots also remain subject to normal ring-buffer eviction.