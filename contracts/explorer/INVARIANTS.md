# Explorer contract invariants

The registry and event log must keep these properties for every sequence of
calls. The decisions behind them live in `src/state.rs` (pure Rust, no Soroban
host) and are called from `src/lib.rs`. Kani proves them in
`proofs/state_proofs.rs`.

| Id | Property | Enforced by | Harness |
| --- | --- | --- | --- |
| I1 | Only the explorer admin or the entry owner (`registered_by`) can update or deregister a registry entry. | `can_modify_entry` | `i1_only_admin_or_owner_can_modify`, `interleavings_keep_registry_consistent` |
| I2 | `abi_version` increases by exactly one per update and never wraps (`u32::MAX` is rejected). | `next_abi_version` | `i2_abi_version_increments_by_one` |
| I3 | Event sequence numbers are strictly monotonic and gap-free across `submit_event` and `submit_events`, and never wrap at `u64::MAX`. | `reserve_seqs` | `i3_reservation_is_gap_free`, `i3_consecutive_reservations_are_contiguous` |
| I4 | While paused, every registry / event-log write (`register_contract`, `update_contract`, `deregister_contract`, `submit_event`, `submit_events`) is rejected and state is unchanged. | `ensure_writable` | `i4_pause_blocks_writes`, `interleavings_keep_registry_consistent` |
| I5 | `event_count` never exceeds `max_events`; every slot is inside the buffer; a batch never exceeds `MAX_BATCH` or the capacity; capacity only changes before the buffer wraps and never below `MIN_MAX_EVENTS`. | `retained_count`, `ring_slot`, `evicted_seq`, `check_batch`, `check_resize` | `i5_*` |
| I6 | `deregister_contract` removes every key of the entry: the latest `Contract` entry and all `ContractVersion` entries `0..=abi_version`. | `versions_to_remove` | `i6_deregister_removes_every_version`, `interleavings_keep_registry_consistent` |

Admin controls (`pause`, `unpause`, `transfer_admin`, `set_max_events`) and
the permissionless `bump_contract_ttl` are not blocked by pause (I4). They do
not write registry entries or events, and `unpause` has to work while paused.

## Bounds

| Harness | Bound | Why |
| --- | --- | --- |
| I1, I2, I3 (single), I4, I5 | none: all `u32` / `u64` inputs, including `u32::MAX` and `u64::MAX` | These are closed-form functions, so they are checked exhaustively. |
| `i5_ring_slot_in_range` | `max_events ≤ 4096`, `seq < 65536` | Symbolic 64-bit modulo does not finish over the full range. The slot/eviction relation is the same at every scale, and the non-modulo capacity math is proven unbounded in `i5_retained_never_exceeds_capacity`. |
| `i3_consecutive_reservations_are_contiguous` | 4 calls, each ≤ `MAX_BATCH` | Enough to cover chaining single and batched submissions. The start value is unbounded. |
| `i6_deregister_removes_every_version` | `abi_version < 4` | The range is linear, so a small bound covers the loop's first, middle and last iterations. |
| `interleavings_keep_registry_consistent` | 5 operations, 3 callers (admin, owner, stranger), 4 ABI versions, any pause state per step | Covers register → update → deregister → register (same id) in every order and by every caller. |

## Running the proofs

```bash
cargo install --locked kani-verifier && cargo kani setup   # once
cd contracts/explorer && cargo kani --lib
```

CI runs them nightly (`.github/workflows/e2e-nightly.yml`, job
`kani-proofs`), uploads the results as an artifact, and opens an issue when a
proof fails.

To check that a proof has teeth, seed a bug and re-run. For example, change
`can_modify_entry` to return `caller_is_admin || !caller_is_owner`, or drop the
`checked_add` in `reserve_seqs`. The matching harness then reports
`VERIFICATION:- FAILED`.

## Behaviour notes

- I6 fixed a real gap. `deregister_contract` used to remove only the latest
  entry, so old ABI versions stayed readable through `get_contract_version`,
  including after someone else re-registered the same id. It now removes the
  whole version history. Each removal is one ledger write, so deregistering
  an entry with a very long history costs proportionally more.
- `next_abi_version` returns `InvalidInput` at `u32::MAX` instead of
  trapping on arithmetic overflow. That case is unreachable in practice.
