//! Tests for the Ticket contract.
//!
//! Sections
//! --------
//! 1. Original unit tests (preserved)
//! 2. Property-based tests  (proptest)
//! 3. Snapshot / state-diff tests
//! 4. Gas benchmark tests
//! 5. Stress tests
//! 6. Edge-case / error-path tests

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, StellarAsset}, token, Env, String};

// ─── helpers ─────────────────────────────────────────────────────────────────

/// Shared setup: deploy + initialise the contract with default parameters.
fn setup() -> (Env, TicketContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TicketContract);
    let client = TicketContractClient::new(&env, &contract_id);

    let organizer = Address::generate(&env);
    let buyer = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin);
    token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &200_000_000i128);

    client.initialize(
        &organizer,
        &token_id,
        &String::from_str(&env, "Harvesta Live 2025"),
        &100u64,
        &50_000_000i128, // 5 XLM in stroops
        &75_000_000i128, // max resale 7.5 XLM
    );

    (env, client, organizer, buyer)
}

/// Setup with custom capacity.
#[allow(dead_code)]
fn setup_with_capacity(max: u64) -> (Env, TicketContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TicketContract);
    let client = TicketContractClient::new(&env, &contract_id);
    let organizer = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin);
    client.initialize(
        &organizer,
        &token_id,
        &String::from_str(&env, "Test Event"),
        &max,
        &1_000i128,
        &2_000i128,
    );
    (env, client, organizer)
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. ORIGINAL UNIT TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_mint_and_get() {
    let (_env, client, organizer, buyer) = setup();
    let id = client.mint_ticket(&organizer, &buyer);
    assert_eq!(id, 0);

    let ticket = client.get_ticket(&0u64);
    assert_eq!(ticket.owner, buyer);
    assert_eq!(ticket.status, TicketStatus::Valid);
}

#[test]
fn test_transfer() {
    let (env, client, organizer, buyer) = setup();
    client.mint_ticket(&organizer, &buyer);

    let new_owner = Address::generate(&env);
    client.transfer_ticket(&buyer, &new_owner, &0u64, &60_000_000i128);

    let ticket = client.get_ticket(&0u64);
    assert_eq!(ticket.owner, new_owner);
    assert_eq!(ticket.status, TicketStatus::Transferred);
}

#[test]
#[should_panic(expected = "price exceeds resale cap")]
fn test_resale_cap_enforced() {
    let (env, client, organizer, buyer) = setup();
    client.mint_ticket(&organizer, &buyer);

    let new_owner = Address::generate(&env);
    client.transfer_ticket(&buyer, &new_owner, &0u64, &100_000_000i128);
}

#[test]
#[should_panic(expected = "sale price must be positive")]
fn test_zero_price_transfer_rejected() {
    let (_env, client, organizer, buyer) = setup();
    client.mint_ticket(&organizer, &buyer);
    client.transfer_ticket(&buyer, &organizer, &0u64, &0i128);
}

#[test]
fn test_verify_ticket() {
    let (_env, client, organizer, buyer) = setup();
    client.mint_ticket(&organizer, &buyer);

    let valid = client.verify_ticket(&organizer, &0u64);
    assert!(valid);

    // Second scan must return false (already used).
    let double_scan = client.verify_ticket(&organizer, &0u64);
    assert!(!double_scan);
}

// ─── 7. Resource-budget record (#873) ────────────────────────────────────────
//
// Records the host budget consumed by every public entrypoint into
// `target/budget/ticket.json` (repo root). `scripts/budget-check.mjs` compares
// it against `contracts/budget-baseline.json`; see `docs/BUDGET.md`.

mod budget {
    extern crate std;

    use super::*;
    use soroban_sdk::{testutils::Events as _, xdr::ToXdr};

    fn measure(env: &Env, call: impl FnOnce()) -> (u64, u64, u32) {
        let events_before = env.events().all().to_xdr(env).len();
        env.budget().reset_unlimited();
        call();
        let cpu = env.budget().cpu_instruction_cost();
        let mem = env.budget().memory_bytes_cost();
        let events_after = env.events().all().to_xdr(env).len();
        (cpu, mem, events_after.saturating_sub(events_before))
    }

    #[test]
    fn budget_record() {
        let mut rows: std::vec::Vec<(&str, (u64, u64, u32))> = std::vec::Vec::new();

        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, TicketContract);
        let client = TicketContractClient::new(&env, &id);
        let organizer = Address::generate(&env);
        let name = String::from_str(&env, "Budget Live");
        rows.push((
            "initialize",
            measure(&env, || {
                client.initialize(&organizer, &name, &100u64, &50i128, &75i128)
            }),
        ));

        let (env, client, organizer, buyer) = setup();
        let other = Address::generate(&env);
        rows.push((
            "mint_ticket",
            measure(&env, || {
                client.mint_ticket(&organizer, &buyer);
            }),
        ));
        rows.push((
            "transfer_ticket",
            measure(&env, || {
                client.transfer_ticket(&buyer, &other, &0u64, &60i128)
            }),
        ));
        rows.push((
            "get_ticket",
            measure(&env, || {
                client.get_ticket(&0u64);
            }),
        ));
        rows.push((
            "tickets_sold",
            measure(&env, || {
                client.tickets_sold();
            }),
        ));
        rows.push((
            "verify_ticket",
            measure(&env, || {
                client.verify_ticket(&organizer, &0u64);
            }),
        ));

        rows.sort_by(|a, b| a.0.cmp(b.0));
        let lines: std::vec::Vec<std::string::String> = rows
            .iter()
            .map(|(n, (cpu, mem, ev))| {
                std::format!(
                    "  \"ticket::{n}\": {{ \"cpu_insns\": {cpu}, \"mem_bytes\": {mem}, \"event_bytes\": {ev} }}"
                )
            })
            .collect();
        let json = std::format!("{{\n{}\n}}\n", lines.join(",\n"));

        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/budget");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("ticket.json"), json).unwrap();
    }
}
