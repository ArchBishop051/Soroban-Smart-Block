//! Resource-budget harness (#873).
//!
//! Invokes every public entrypoint of the explorer contract with
//! representative inputs and records the host budget it consumed. Results are
//! written to `target/budget/explorer.json` and compared against
//! `contracts/budget-baseline.json` by `scripts/budget-check.mjs`
//! (see `docs/BUDGET.md`).
//!
//! Numbers are deterministic: the test host uses a fixed PRNG seed and the
//! budget model does not depend on wall-clock time or build profile.

use soroban_explorer_contract::{
    ContractMeta, EventInput, ExplorerContract, ExplorerContractClient,
};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _},
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, String, Vec,
};
use std::collections::BTreeMap;

/// Resources consumed by one entrypoint invocation.
struct Cost {
    cpu_insns: u64,
    mem_bytes: u64,
    event_bytes: u32,
}

fn setup() -> (Env, ExplorerContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, ExplorerContract);
    let client = ExplorerContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.init(&admin, &0u32);
    (env, client, admin)
}

fn meta(env: &Env, owner: &Address, abi_version: u32) -> ContractMeta {
    ContractMeta {
        version: 1,
        abi_version,
        min_ledger: 0,
        name: String::from_str(env, "BudgetToken"),
        description: String::from_str(env, "Representative SEP-41 token"),
        functions: Vec::new(env),
        registered_by: owner.clone(),
    }
}

fn input(env: &Env) -> EventInput {
    EventInput {
        contract_id: BytesN::from_array(env, &[7u8; 32]),
        function: symbol_short!("transfer"),
        ledger: 1_000,
        description: String::from_str(env, "GABC... sent 100 USDC to GDEF..."),
        raw_topics: Vec::new(env),
        raw_data: Bytes::new(env),
    }
}

fn cid(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[9u8; 32])
}

/// Runs `call` with a fresh, unlimited budget and returns what it consumed.
fn measure(env: &Env, call: impl FnOnce()) -> Cost {
    let events_before = env.events().all().to_xdr(env).len();
    env.budget().reset_unlimited();
    call();
    let cpu_insns = env.budget().cpu_instruction_cost();
    let mem_bytes = env.budget().memory_bytes_cost();
    let events_after = env.events().all().to_xdr(env).len();
    Cost {
        cpu_insns,
        mem_bytes,
        event_bytes: events_after.saturating_sub(events_before),
    }
}

fn measure_all() -> BTreeMap<&'static str, Cost> {
    let mut out = BTreeMap::new();

    {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, ExplorerContract);
        let client = ExplorerContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        out.insert("init", measure(&env, || client.init(&admin, &0u32)));
    }

    let (env, client, admin) = setup();
    let new_admin = Address::generate(&env);
    out.insert(
        "transfer_admin",
        measure(&env, || client.transfer_admin(&admin, &new_admin)),
    );

    let (env, client, admin) = setup();
    out.insert(
        "set_max_events",
        measure(&env, || client.set_max_events(&admin, &2_000u32)),
    );
    out.insert(
        "storage_utilisation",
        measure(&env, || {
            client.storage_utilisation();
        }),
    );
    out.insert("pause", measure(&env, || client.pause(&admin)));
    out.insert(
        "is_paused",
        measure(&env, || {
            client.is_paused();
        }),
    );
    out.insert("unpause", measure(&env, || client.unpause(&admin)));

    let (env, client, admin) = setup();
    let id = cid(&env);
    out.insert(
        "register_contract",
        measure(&env, || {
            client.register_contract(&admin, &id, &meta(&env, &admin, 0))
        }),
    );
    out.insert(
        "update_contract",
        measure(&env, || {
            client.update_contract(&admin, &id, &meta(&env, &admin, 1))
        }),
    );
    out.insert(
        "bump_contract_ttl",
        measure(&env, || client.bump_contract_ttl(&id)),
    );
    out.insert(
        "get_contract",
        measure(&env, || {
            client.get_contract(&id);
        }),
    );
    out.insert(
        "get_contract_version",
        measure(&env, || {
            client.get_contract_version(&id, &0u32);
        }),
    );
    out.insert(
        "get_latest_contract",
        measure(&env, || {
            client.get_latest_contract(&id);
        }),
    );
    let deployer = Address::generate(&env);
    out.insert(
        "attest_deployer",
        measure(&env, || client.attest_deployer(&admin, &id, &deployer)),
    );
    out.insert(
        "claim_contract",
        measure(&env, || {
            client.claim_contract(&id, &deployer);
        }),
    );
    out.insert(
        "get_ownership",
        measure(&env, || {
            client.get_ownership(&id);
        }),
    );
    out.insert(
        "deregister_contract",
        measure(&env, || client.deregister_contract(&admin, &id)),
    );

    let (env, client, admin) = setup();
    let ev = input(&env);
    out.insert(
        "submit_event",
        measure(&env, || client.submit_event(&admin, &ev)),
    );
    let mut batch = Vec::new(&env);
    for _ in 0..10 {
        batch.push_back(input(&env));
    }
    out.insert(
        "submit_events",
        measure(&env, || {
            client.submit_events(&admin, &batch);
        }),
    );
    out.insert(
        "get_event",
        measure(&env, || {
            client.get_event(&0u64);
        }),
    );
    out.insert(
        "event_count",
        measure(&env, || {
            client.event_count();
        }),
    );
    out.insert(
        "get_events",
        measure(&env, || {
            client.get_events(&0u64, &10u32);
        }),
    );

    out
}

/// Names of every `pub fn` in the `#[contractimpl]` block, i.e. the contract
/// spec's function list.
fn spec_functions() -> std::vec::Vec<std::string::String> {
    let src = include_str!("../src/lib.rs");
    let body = src.split("// ── Tests").next().unwrap();
    let mut names = std::vec::Vec::new();
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("    pub fn ") {
            let name = rest.split(['(', '<']).next().unwrap().trim();
            names.push(name.to_string());
        }
    }
    names
}

#[test]
fn budget_covers_every_public_entrypoint() {
    let measured = measure_all();
    let spec = spec_functions();
    assert!(!spec.is_empty(), "no entrypoints found in src/lib.rs");
    for name in &spec {
        assert!(
            measured.contains_key(name.as_str()),
            "entrypoint `{name}` is not covered by tests/budget.rs"
        );
    }
    assert_eq!(
        measured.len(),
        spec.len(),
        "budget.rs measures unknown entrypoints"
    );
}

#[test]
fn budget_record() {
    let measured = measure_all();
    let mut json = std::string::String::from("{\n");
    let last = measured.len() - 1;
    for (i, (name, c)) in measured.iter().enumerate() {
        json.push_str(&format!(
            "  \"explorer::{name}\": {{ \"cpu_insns\": {}, \"mem_bytes\": {}, \"event_bytes\": {} }}{}\n",
            c.cpu_insns,
            c.mem_bytes,
            c.event_bytes,
            if i == last { "" } else { "," }
        ));
    }
    json.push_str("}\n");

    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/budget");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("explorer.json"), json).unwrap();
}
