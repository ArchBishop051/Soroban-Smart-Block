//! Pure state-transition logic for the registry and the event ring buffer.
//!
//! Nothing in this module touches the Soroban host, so it can be verified with
//! Kani (see `proofs/` and `INVARIANTS.md`) and unit-tested directly.
//! `lib.rs` delegates every decision covered by an invariant to these
//! functions; keep it that way when changing entrypoints.

use crate::{Error, MAX_BATCH, MIN_MAX_EVENTS};

/// I4 — every registry / event-log write is rejected while paused.
pub fn ensure_writable(paused: bool) -> Result<(), Error> {
    if paused {
        Err(Error::ContractPaused)
    } else {
        Ok(())
    }
}

/// I1 — a registry entry may only be updated or deregistered by the explorer
/// admin or the entry's owner (`registered_by`).
pub fn can_modify_entry(caller_is_admin: bool, caller_is_owner: bool) -> bool {
    caller_is_admin || caller_is_owner
}

/// I2 — ABI versions increase by exactly one per update (optimistic
/// concurrency guard). Returns the version to store.
pub fn next_abi_version(current: u32, submitted: u32) -> Result<u32, Error> {
    let expected = current.checked_add(1).ok_or(Error::InvalidInput)?;
    if submitted != expected {
        return Err(Error::Unauthorized);
    }
    Ok(expected)
}

/// I3 — reserves `count` contiguous sequence numbers starting at `next_seq`
/// and returns the new `next_seq`. The assigned numbers are
/// `next_seq..returned`, so the sequence stays monotonic and gap-free.
pub fn reserve_seqs(next_seq: u64, count: u32) -> Result<u64, Error> {
    next_seq
        .checked_add(count as u64)
        .ok_or(Error::InvalidInput)
}

/// Validates the size of a `submit_events` batch against `MAX_BATCH` and the
/// ring-buffer capacity (a batch must never evict its own entries).
pub fn check_batch(count: u32, max_events: u32) -> Result<(), Error> {
    if count == 0 {
        return Err(Error::EmptyBatch);
    }
    if count > MAX_BATCH || count > max_events {
        return Err(Error::InvalidInput);
    }
    Ok(())
}

/// Ring-buffer slot for `seq`. Requires `max_events > 0`.
pub fn ring_slot(seq: u64, max_events: u32) -> u64 {
    seq % (max_events as u64)
}

/// Sequence number evicted by writing `seq`, if the buffer has wrapped.
pub fn evicted_seq(seq: u64, max_events: u32) -> Option<u64> {
    seq.checked_sub(max_events as u64)
}

/// I5 — number of retrievable events; never exceeds `max_events`.
pub fn retained_count(next_seq: u64, max_events: u32) -> u64 {
    next_seq.min(max_events as u64)
}

/// Oldest sequence number still held in the ring buffer.
pub fn oldest_retained(next_seq: u64, max_events: u32) -> u64 {
    next_seq.saturating_sub(max_events as u64)
}

/// I5 — the capacity may only change before the buffer has wrapped and never
/// below `MIN_MAX_EVENTS`.
pub fn check_resize(next_seq: u64, current_max: u32, new_max: u32) -> Result<(), Error> {
    if new_max < MIN_MAX_EVENTS {
        return Err(Error::BelowFloor);
    }
    if next_seq >= current_max as u64 {
        return Err(Error::InvalidInput);
    }
    Ok(())
}

/// I6 — ABI versions that must be removed when an entry at `abi_version` is
/// deregistered: every stored version, `0..=abi_version`.
pub fn versions_to_remove(abi_version: u32) -> core::ops::RangeInclusive<u32> {
    0..=abi_version
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_blocks_writes() {
        assert_eq!(ensure_writable(true), Err(Error::ContractPaused));
        assert_eq!(ensure_writable(false), Ok(()));
    }

    #[test]
    fn only_admin_or_owner_modifies() {
        assert!(can_modify_entry(true, false));
        assert!(can_modify_entry(false, true));
        assert!(!can_modify_entry(false, false));
    }

    #[test]
    fn abi_version_increments_by_one() {
        assert_eq!(next_abi_version(0, 1), Ok(1));
        assert_eq!(next_abi_version(1, 1), Err(Error::Unauthorized));
        assert_eq!(next_abi_version(u32::MAX, 0), Err(Error::InvalidInput));
    }

    #[test]
    fn seqs_are_contiguous() {
        assert_eq!(reserve_seqs(5, 3), Ok(8));
        assert_eq!(reserve_seqs(u64::MAX, 1), Err(Error::InvalidInput));
    }

    #[test]
    fn batch_bounds() {
        assert_eq!(check_batch(0, 10), Err(Error::EmptyBatch));
        assert_eq!(check_batch(MAX_BATCH + 1, 50_000), Err(Error::InvalidInput));
        assert_eq!(check_batch(6, 5), Err(Error::InvalidInput));
        assert_eq!(check_batch(MAX_BATCH, 50_000), Ok(()));
    }

    #[test]
    fn ring_buffer_helpers() {
        assert_eq!(ring_slot(7, 5), 2);
        assert_eq!(evicted_seq(4, 5), None);
        assert_eq!(evicted_seq(7, 5), Some(2));
        assert_eq!(retained_count(7, 5), 5);
        assert_eq!(oldest_retained(7, 5), 2);
    }

    #[test]
    fn resize_rules() {
        assert_eq!(check_resize(0, 50_000, 999), Err(Error::BelowFloor));
        assert_eq!(
            check_resize(50_000, 50_000, 2_000),
            Err(Error::InvalidInput)
        );
        assert_eq!(check_resize(10, 50_000, 2_000), Ok(()));
    }

    #[test]
    fn deregister_covers_every_version() {
        assert_eq!(versions_to_remove(0).count(), 1);
        assert!(versions_to_remove(3).eq([0, 1, 2, 3]));
    }
}
