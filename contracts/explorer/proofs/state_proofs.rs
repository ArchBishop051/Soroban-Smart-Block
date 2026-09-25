//! Kani proof harnesses for the explorer's pure state logic (`src/state.rs`).
//!
//! Run from `contracts/explorer` with `cargo kani`. Each harness names the
//! invariant it proves; see `INVARIANTS.md` for the properties and bounds.

use crate::state::*;
use crate::{Error, MAX_BATCH, MIN_MAX_EVENTS};

/// I1 — only the admin or the entry owner may update / deregister.
#[kani::proof]
fn i1_only_admin_or_owner_can_modify() {
    let is_admin: bool = kani::any();
    let is_owner: bool = kani::any();
    assert_eq!(can_modify_entry(is_admin, is_owner), is_admin || is_owner);
}

/// I2 — ABI versions increase by exactly one, including at `u32::MAX`.
#[kani::proof]
fn i2_abi_version_increments_by_one() {
    let current: u32 = kani::any();
    let submitted: u32 = kani::any();
    match next_abi_version(current, submitted) {
        Ok(v) => {
            assert!(current < u32::MAX);
            assert_eq!(v, current + 1);
            assert_eq!(v, submitted);
        }
        Err(_) => assert!(current == u32::MAX || submitted != current.wrapping_add(1)),
    }
}

/// I3 — a reservation assigns exactly `count` contiguous sequence numbers and
/// fails (instead of wrapping) at `u64::MAX`.
#[kani::proof]
fn i3_reservation_is_gap_free() {
    let next: u64 = kani::any();
    let count: u32 = kani::any();
    match reserve_seqs(next, count) {
        Ok(new_next) => assert_eq!(new_next - next, count as u64),
        Err(e) => {
            assert_eq!(e, Error::InvalidInput);
            assert!(next.checked_add(count as u64).is_none());
        }
    }
}

/// I3 — consecutive `submit_event` / `submit_events` calls keep the sequence
/// monotonic and gap-free (4 calls).
#[kani::proof]
#[kani::unwind(5)]
fn i3_consecutive_reservations_are_contiguous() {
    let start: u64 = kani::any();
    let mut next = start;
    let mut assigned: u64 = 0;
    for _ in 0..4 {
        let count: u32 = kani::any();
        kani::assume(count <= MAX_BATCH);
        if let Ok(n) = reserve_seqs(next, count) {
            assert!(n >= next);
            assigned += count as u64;
            next = n;
        }
    }
    assert_eq!(next - start, assigned);
}

/// I4 — every registry / event-log write is rejected while paused.
#[kani::proof]
fn i4_pause_blocks_writes() {
    let paused: bool = kani::any();
    assert_eq!(ensure_writable(paused).is_err(), paused);
}

/// I5 — the number of retrievable events never exceeds `max_events`, and the
/// retained window is exactly `oldest..next` (all `u64` / `u32` values).
#[kani::proof]
fn i5_retained_never_exceeds_capacity() {
    let next: u64 = kani::any();
    let max: u32 = kani::any();
    kani::assume(max > 0);

    assert!(retained_count(next, max) <= max as u64);
    assert_eq!(next - oldest_retained(next, max), retained_count(next, max));
    if let Some(evicted) = evicted_seq(next, max) {
        assert_eq!(evicted + max as u64, next);
    }
}

/// I5 — every slot is inside the buffer, and an evicted entry is the one
/// sharing the new entry's slot. Bounded: symbolic 64-bit modulo is too
/// expensive for the solver over the full range (see INVARIANTS.md).
#[kani::proof]
fn i5_ring_slot_in_range() {
    let next: u64 = kani::any();
    let max: u32 = kani::any();
    kani::assume(max > 0 && max <= 1 << 12);
    kani::assume(next < 1 << 16);

    let slot = ring_slot(next, max);
    assert!(slot < max as u64);
    if let Some(evicted) = evicted_seq(next, max) {
        assert_eq!(ring_slot(evicted, max), slot);
    }
}

/// I5 — a batch never exceeds `MAX_BATCH` or the buffer capacity, so it can
/// never evict its own entries.
#[kani::proof]
fn i5_batch_fits_capacity() {
    let count: u32 = kani::any();
    let max: u32 = kani::any();
    if check_batch(count, max).is_ok() {
        assert!(count >= 1 && count <= MAX_BATCH && count <= max);
    }
}

/// I5 — capacity changes only before the buffer wraps and never below the floor.
#[kani::proof]
fn i5_resize_only_before_wrap() {
    let next: u64 = kani::any();
    let current: u32 = kani::any();
    let new_max: u32 = kani::any();
    if check_resize(next, current, new_max).is_ok() {
        assert!(new_max >= MIN_MAX_EVENTS);
        assert!(next < current as u64);
    }
}

/// I6 — deregistering an entry at `abi_version` removes every stored version.
#[kani::proof]
#[kani::unwind(6)]
fn i6_deregister_removes_every_version() {
    let abi_version: u32 = kani::any();
    kani::assume(abi_version < 4);
    let v: u32 = kani::any();
    kani::assume(v <= abi_version);
    assert!(versions_to_remove(abi_version).any(|r| r == v));
}

// ── Interleavings ────────────────────────────────────────────────────────────

/// Number of ABI versions tracked by the model (versions 0..N).
const N: usize = 4;
const ADMIN: u8 = 0;

/// Model of one registry id: `(owner, abi_version)` plus which version keys
/// exist. Transitions use the same `state::` decisions as `lib.rs`.
struct Model {
    entry: Option<(u8, u32)>,
    versions: [bool; N],
}

impl Model {
    fn register(&mut self, paused: bool, caller: u8, owner: u8) {
        if ensure_writable(paused).is_err() || caller != ADMIN || self.entry.is_some() {
            return;
        }
        self.entry = Some((owner, 0));
        self.versions[0] = true;
    }

    fn update(&mut self, paused: bool, caller: u8, submitted: u32) {
        if ensure_writable(paused).is_err() {
            return;
        }
        let Some((owner, abi)) = self.entry else {
            return;
        };
        if !can_modify_entry(caller == ADMIN, caller == owner) {
            return;
        }
        let Ok(v) = next_abi_version(abi, submitted) else {
            return;
        };
        if v as usize >= N {
            return; // outside the model bound
        }
        self.entry = Some((owner, v));
        self.versions[v as usize] = true;
    }

    fn deregister(&mut self, paused: bool, caller: u8) {
        if ensure_writable(paused).is_err() {
            return;
        }
        let Some((owner, abi)) = self.entry else {
            return;
        };
        if !can_modify_entry(caller == ADMIN, caller == owner) {
            return;
        }
        self.entry = None;
        for v in versions_to_remove(abi) {
            self.versions[v as usize] = false;
        }
    }

    /// Stored versions are exactly `0..=abi_version` of the live entry, and
    /// nothing is left behind after deregistration.
    fn consistent(&self) -> bool {
        match self.entry {
            None => self.versions.iter().all(|v| !v),
            Some((_, abi)) => (0..N).all(|i| self.versions[i] == (i as u32 <= abi)),
        }
    }
}

/// register → update → deregister → register (same id), in any order and by
/// any caller, with pause toggling: the version history always matches the
/// live entry, a paused step never changes state, and a non-owner can never
/// change another owner's entry.
#[kani::proof]
#[kani::unwind(6)]
fn interleavings_keep_registry_consistent() {
    let mut m = Model {
        entry: None,
        versions: [false; N],
    };
    for _ in 0..5 {
        let op: u8 = kani::any();
        let paused: bool = kani::any();
        let caller: u8 = kani::any();
        kani::assume(caller < 3);
        let before_entry = m.entry;
        let before_versions = m.versions;

        match op % 3 {
            0 => {
                let owner: u8 = kani::any();
                kani::assume(owner < 3);
                m.register(paused, caller, owner);
            }
            1 => m.update(paused, caller, kani::any()),
            _ => m.deregister(paused, caller),
        }

        assert!(m.consistent());
        if paused {
            assert!(m.entry == before_entry && m.versions == before_versions);
        }
        if let Some((owner, _)) = before_entry {
            if m.entry != before_entry {
                assert!(caller == ADMIN || caller == owner);
            }
        }
    }
}
