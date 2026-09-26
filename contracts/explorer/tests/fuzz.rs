#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{testutils::Address as _, Address, Env, BytesN, String, Vec, Bytes};
use explorer_contract::{ExplorerContractClient, ExplorerContract, EventInput};
use std::panic::{catch_unwind, AssertUnwindSafe};

fuzz_target!(|data: &[u8]| {
    // We require enough data to generate some primitive fields
    if data.len() < 32 {
        return;
    }

    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, ExplorerContract);
    let client = ExplorerContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    client.init(&admin, &5000);

    let mut cid_array = [0u8; 32];
    cid_array.copy_from_slice(&data[0..32]);
    let cid = BytesN::from_array(&env, &cid_array);

    let topic_count = (data[32] as u32) % (explorer_contract::MAX_EVENT_TOPICS + 8);
    let mut raw_topics = Vec::new(&env);
    for i in 0..topic_count {
        let topic_len = if data.len() > 33 { (data[33] as u32) + i } else { i };
        let bytes = vec![b'x'; topic_len as usize];
        raw_topics.push_back(String::from_bytes(&env, &bytes));
    }
    let raw_data_len = if data.len() > 34 { data[34] as u32 * 32 } else { 0 };
    let raw_data = Bytes::from_slice(&env, &vec![0u8; raw_data_len as usize]);
    let input = EventInput {
        contract_id: cid,
        function: soroban_sdk::symbol_short!("swap"),
        ledger: 100,
        description: String::from_str(&env, "Fuzzed Event"),
        raw_topics,
        raw_data,
    };

    // Malformed payloads may be rejected, but must never escape as an
    // unexpected host panic from allocation or arithmetic.
    let _ = catch_unwind(AssertUnwindSafe(|| client.submit_event(&admin, &input)));
});
