use soroban_sdk::{Bytes, BytesN, Env};

use crate::{DataKey, DecodedEvent};

fn hash_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut bytes = Bytes::new(env);
    bytes.extend_from_slice(&left.to_array());
    bytes.extend_from_slice(&right.to_array());
    env.crypto().sha256(&bytes).to_bytes()
}

pub fn event_leaf(env: &Env, event: &DecodedEvent) -> BytesN<32> {
    // Length-prefix every variable field so concatenation is unambiguous and
    // independent of JSON formatting.
    let mut bytes = Bytes::new(env);
    bytes.extend_from_slice(&event.seq.to_be_bytes());
    bytes.extend_from_slice(&event.contract_id.to_array());
    let function = event.function.to_string().to_bytes();
    bytes.append(&function);
    bytes.extend_from_slice(&event.ledger.to_be_bytes());
    let description = event.description.to_bytes();
    bytes.append(&description);
    bytes.append(&event.raw_data);
    env.crypto().sha256(&bytes).to_bytes()
}

pub fn append(env: &Env, leaf: &BytesN<32>) {
    let mut count: u64 = env.storage().instance().get(&DataKey::MmrLeafCount).unwrap_or(0);
    let mut carry = leaf.clone();
    let mut level = 0u32;
    while (count & (1u64 << level)) != 0 {
        let left: BytesN<32> = env.storage().instance().get(&DataKey::MmrPeak(level)).unwrap();
        carry = hash_pair(env, &left, &carry);
        env.storage().instance().remove(&DataKey::MmrPeak(level));
        level += 1;
    }
    env.storage().instance().set(&DataKey::MmrPeak(level), &carry);
    count += 1;
    env.storage().instance().set(&DataKey::MmrLeafCount, &count);
}

pub fn root(env: &Env) -> (BytesN<32>, u64) {
    let count: u64 = env.storage().instance().get(&DataKey::MmrLeafCount).unwrap_or(0);
    if count == 0 { return (BytesN::from_array(env, &[0u8; 32]), 0); }
    let mut acc: Option<BytesN<32>> = None;
    for level in 0..64u32 {
        if (count & (1u64 << level)) != 0 {
            let peak: BytesN<32> = env.storage().instance().get(&DataKey::MmrPeak(level)).unwrap();
            acc = Some(match acc { Some(right) => hash_pair(env, &peak, &right), None => peak });
        }
    }
    (acc.unwrap(), count)
}
