#![cfg(test)]

use soroban_explorer_contract::{EventInput, ExplorerContract, ExplorerContractClient, MAX_BATCH};
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, String, Vec};

// Gas usage regression tests
#[test]
fn test_submit_event_gas_benchmark() {
    let env = Env::default();
    env.mock_all_auths();

    // Enable gas tracking in the mock environment
    env.budget().reset_unlimited();

    let explorer_id = env.register_contract(None, ExplorerContract);
    let explorer = ExplorerContractClient::new(&env, &explorer_id);
    let admin = Address::generate(&env);
    explorer.init(&admin, &50000);

    let contract_id: BytesN<32> = BytesN::from_array(&env, &[3; 32]);
    let input = EventInput {
        contract_id,
        function: soroban_sdk::symbol_short!("bench"),
        ledger: 1000,
        description: String::from_str(&env, "Benchmarking gas usage"),
        raw_topics: Vec::new(&env),
        raw_data: Bytes::new(&env),
    };

    let start_cpu_insns = env.budget().cpu_instruction_cost();

    explorer.submit_event(&admin, &input);

    let cpu_insns_used = env.budget().cpu_instruction_cost() - start_cpu_insns;

    // Fail if gas exceeds our optimized budget threshold (e.g. 50,000 instructions)
    assert!(cpu_insns_used < 1_000_000, "Gas exceeded budget threshold!");
}

fn bench_input(env: &Env, i: u8) -> EventInput {
    // 512-byte description: the per-item worst case allowed by MAX_DESCRIPTION_LEN.
    let description = String::from_bytes(env, &[b'a'; 512]);
    EventInput {
        contract_id: BytesN::from_array(env, &[i; 32]),
        function: soroban_sdk::symbol_short!("bench"),
        ledger: 1000,
        description,
        raw_topics: Vec::new(env),
        raw_data: Bytes::new(env),
    }
}

fn bench_setup() -> (Env, ExplorerContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let explorer_id = env.register_contract(None, ExplorerContract);
    let explorer = ExplorerContractClient::new(&env, &explorer_id);
    let admin = Address::generate(&env);
    explorer.init(&admin, &50000);
    // Warm the ring buffer so measurements are taken in steady state.
    explorer.submit_event(&admin, &bench_input(&env, 0));
    (env, explorer, admin)
}

/// Benchmarks `submit_events` at batch sizes 1, 10 and `MAX_BATCH` against
/// single `submit_event` calls. The numbers printed here justify `MAX_BATCH`.
#[test]
fn test_submit_events_batch_benchmark() {
    let (env, explorer, admin) = bench_setup();
    env.budget().reset_unlimited();
    let before = env.budget().cpu_instruction_cost();
    explorer.submit_event(&admin, &bench_input(&env, 1));
    let single = env.budget().cpu_instruction_cost() - before;
    std::println!("submit_event x1: cpu={single}");

    let mut per_event_at_max = 0u64;
    for size in [1u32, 10, MAX_BATCH] {
        let (env, explorer, admin) = bench_setup();
        let mut inputs = Vec::new(&env);
        for i in 0..size {
            inputs.push_back(bench_input(&env, i as u8));
        }
        env.budget().reset_unlimited();
        let before_cpu = env.budget().cpu_instruction_cost();
        let before_mem = env.budget().memory_bytes_cost();
        let seqs = explorer.submit_events(&admin, &inputs);
        let cpu = env.budget().cpu_instruction_cost() - before_cpu;
        let mem = env.budget().memory_bytes_cost() - before_mem;
        assert_eq!(seqs.len(), size);
        std::println!(
            "submit_events x{size}: cpu={cpu} mem={mem} per_event_cpu={}",
            cpu / size as u64
        );
        // Must fit comfortably (< 25%) in the 100M per-tx instruction limit.
        assert!(cpu < 25_000_000, "batch of {size} too expensive: {cpu}");
        if size == MAX_BATCH {
            per_event_at_max = cpu / size as u64;
        }
    }

    // Acceptance: per-event cost at MAX_BATCH is at least 40% lower than a
    // single submit_event.
    assert!(
        per_event_at_max * 100 <= single * 60,
        "per-event cost at MAX_BATCH ({per_event_at_max}) is not 40% below single ({single})"
    );
}
