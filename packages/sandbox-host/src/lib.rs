//! Soroban host compiled to `wasm32-unknown-unknown` for offline, in-browser
//! simulation (#925).
//!
//! Invocations go through `invoke_host_function_in_recording_mode`, the same
//! entry point Soroban RPC's `simulateTransaction` uses, so results, events and
//! resource usage match network simulation for the same ledger state.
//!
//! All XDR crosses the JS boundary as base64 so callers can build values with
//! `@stellar/stellar-sdk`'s `xdr` module.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use soroban_env_host::{
    budget::Budget,
    e2e_invoke::invoke_host_function_in_recording_mode,
    meta::{get_ledger_protocol_version, INTERFACE_VERSION},
    storage::{EntryWithLiveUntil, SnapshotSource},
    xdr::{
        AccountId, ContractEvent, DiagnosticEvent, HostFunction, LedgerEntry, LedgerKey, Limits,
        PublicKey, ReadXdr, Uint256, WriteXdr,
    },
    HostError, LedgerInfo,
};
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};
use wasm_bindgen::prelude::*;

type Result<T> = std::result::Result<T, JsError>;

/// Protocol version of the bundled host; the UI warns when the network differs.
#[wasm_bindgen(js_name = hostProtocolVersion)]
pub fn host_protocol_version() -> u32 {
    get_ledger_protocol_version(INTERFACE_VERSION)
}

fn b64_decode(s: &str) -> Result<Vec<u8>> {
    B64.decode(s)
        .map_err(|e| JsError::new(&format!("invalid base64: {e}")))
}

fn from_b64<T: ReadXdr>(s: &str) -> Result<T> {
    T::from_xdr(b64_decode(s)?, Limits::none())
        .map_err(|e| JsError::new(&format!("invalid XDR: {e}")))
}

fn to_b64<T: WriteXdr>(v: &T) -> String {
    B64.encode(v.to_xdr(Limits::none()).unwrap_or_default())
}

fn host_err(e: HostError) -> JsError {
    JsError::new(&format!("{e:?}"))
}

/// In-memory ledger backing the host.
#[derive(Default)]
struct Ledger {
    entries: BTreeMap<Vec<u8>, EntryWithLiveUntil>,
}

struct LedgerSnapshot(Rc<RefCell<Ledger>>);

impl SnapshotSource for LedgerSnapshot {
    fn get(
        &self,
        key: &Rc<LedgerKey>,
    ) -> std::result::Result<Option<EntryWithLiveUntil>, HostError> {
        let k = key.to_xdr(Limits::none())?;
        Ok(self.0.borrow().entries.get(&k).cloned())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Budget_ {
    cpu_insns: u64,
    mem_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateChange {
    key: String,
    before: Option<String>,
    after: Option<String>,
    read_only: bool,
    live_until: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InvokeOutput {
    /// `ScVal` XDR of the return value (on success).
    result: Option<String>,
    /// Host error description (on failure).
    error: Option<String>,
    /// `ContractEvent` XDR, in emission order.
    events: Vec<String>,
    /// `DiagnosticEvent` XDR (diagnostic mode only).
    diagnostic_events: Vec<String>,
    /// Recorded `SorobanAuthorizationEntry` XDR.
    auth: Vec<String>,
    /// `SorobanResources` XDR (footprint, instructions, bytes).
    resources: String,
    budget: Budget_,
    state_diff: Vec<StateChange>,
}

/// An in-browser Soroban ledger + host.
#[wasm_bindgen]
pub struct SandboxHost {
    ledger: Rc<RefCell<Ledger>>,
    info: LedgerInfo,
    source: AccountId,
    seed_counter: u64,
}

impl Default for SandboxHost {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl SandboxHost {
    /// New empty ledger with testnet-like defaults (override via `setLedgerInfo`).
    #[wasm_bindgen(constructor)]
    pub fn new() -> SandboxHost {
        SandboxHost {
            ledger: Rc::new(RefCell::new(Ledger::default())),
            info: LedgerInfo {
                protocol_version: host_protocol_version(),
                sequence_number: 1_000,
                timestamp: 1_700_000_000,
                network_id: Sha256::digest(b"Test SDF Network ; September 2015").into(),
                base_reserve: 5_000_000,
                min_temp_entry_ttl: 16,
                min_persistent_entry_ttl: 4_096,
                max_entry_ttl: 6_312_000,
            },
            source: AccountId(PublicKey::PublicKeyTypeEd25519(Uint256([0; 32]))),
            seed_counter: 0,
        }
    }

    /// Set ledger header values used by subsequent invocations.
    #[wasm_bindgen(js_name = setLedgerInfo)]
    pub fn set_ledger_info(
        &mut self,
        protocol_version: u32,
        sequence: u32,
        timestamp: u64,
        network_passphrase: &str,
    ) {
        self.info.protocol_version = protocol_version;
        self.info.sequence_number = sequence;
        self.info.timestamp = timestamp;
        self.info.network_id = Sha256::digest(network_passphrase.as_bytes()).into();
    }

    /// Set the invoking source account (`AccountId` XDR, base64).
    #[wasm_bindgen(js_name = setSourceAccount)]
    pub fn set_source_account(&mut self, account_id_xdr: &str) -> Result<()> {
        self.source = from_b64(account_id_xdr)?;
        Ok(())
    }

    /// Insert or replace a ledger entry (`LedgerEntry` XDR, base64). The key is
    /// derived by the caller and passed as `LedgerKey` XDR (base64).
    #[wasm_bindgen(js_name = setLedgerEntry)]
    pub fn set_ledger_entry(
        &mut self,
        key_xdr: &str,
        entry_xdr: &str,
        live_until: Option<u32>,
    ) -> Result<()> {
        let key: LedgerKey = from_b64(key_xdr)?;
        let entry: LedgerEntry = from_b64(entry_xdr)?;
        let k = key
            .to_xdr(Limits::none())
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.ledger
            .borrow_mut()
            .entries
            .insert(k, (Rc::new(entry), live_until));
        Ok(())
    }

    /// Remove a ledger entry by `LedgerKey` XDR (base64).
    #[wasm_bindgen(js_name = removeLedgerEntry)]
    pub fn remove_ledger_entry(&mut self, key_xdr: &str) -> Result<()> {
        self.ledger
            .borrow_mut()
            .entries
            .remove(&b64_decode(key_xdr)?);
        Ok(())
    }

    /// Number of entries in the in-browser ledger.
    #[wasm_bindgen(js_name = entryCount)]
    pub fn entry_count(&self) -> usize {
        self.ledger.borrow().entries.len()
    }

    /// Run a `HostFunction` (XDR, base64): upload WASM, create a contract, or
    /// invoke one. Auth is recorded (as in RPC simulation). On success, ledger
    /// changes are applied to the in-browser ledger. Returns JSON (see
    /// `InvokeOutput`).
    pub fn invoke(&mut self, host_fn_xdr: &str, diagnostics: bool) -> Result<String> {
        let host_fn: HostFunction = from_b64(host_fn_xdr)?;
        let budget = Budget::default();
        let mut diag: Vec<DiagnosticEvent> = Vec::new();
        self.seed_counter += 1;
        let seed: [u8; 32] = Sha256::digest(self.seed_counter.to_be_bytes()).into();
        let snapshot = Rc::new(LedgerSnapshot(self.ledger.clone()));

        let res = invoke_host_function_in_recording_mode(
            &budget,
            diagnostics,
            &host_fn,
            &self.source,
            None,
            self.info.clone(),
            snapshot,
            seed,
            &mut diag,
        )
        .map_err(host_err)?;

        let mut state_diff = Vec::new();
        if res.invoke_result.is_ok() {
            let mut ledger = self.ledger.borrow_mut();
            for change in &res.ledger_changes {
                let before = ledger
                    .entries
                    .get(&change.encoded_key)
                    .map(|(e, _)| to_b64(e.as_ref()));
                let live_until = change.ttl_change.as_ref().map(|t| t.new_live_until_ledger);
                if change.read_only {
                    if let (Some(lu), Some(entry)) =
                        (live_until, ledger.entries.get_mut(&change.encoded_key))
                    {
                        entry.1 = Some(lu);
                    }
                    continue;
                }
                let after = match &change.encoded_new_value {
                    Some(bytes) => {
                        let entry = LedgerEntry::from_xdr(bytes, Limits::none())
                            .map_err(|e| JsError::new(&e.to_string()))?;
                        let after = to_b64(&entry);
                        ledger
                            .entries
                            .insert(change.encoded_key.clone(), (Rc::new(entry), live_until));
                        Some(after)
                    }
                    None => {
                        ledger.entries.remove(&change.encoded_key);
                        None
                    }
                };
                if before != after {
                    state_diff.push(StateChange {
                        key: B64.encode(&change.encoded_key),
                        before,
                        after,
                        read_only: false,
                        live_until,
                    });
                }
            }
        }

        let (result, error) = match &res.invoke_result {
            Ok(v) => (Some(to_b64(v)), None),
            Err(e) => (None, Some(format!("{e:?}"))),
        };
        let out = InvokeOutput {
            result,
            error,
            events: res
                .contract_events
                .iter()
                .map(to_b64::<ContractEvent>)
                .collect(),
            diagnostic_events: diag.iter().map(to_b64::<DiagnosticEvent>).collect(),
            auth: res.auth.iter().map(to_b64).collect(),
            resources: to_b64(&res.resources),
            budget: Budget_ {
                cpu_insns: budget.get_cpu_insns_consumed().unwrap_or(0),
                mem_bytes: budget.get_mem_bytes_consumed().unwrap_or(0),
            },
            state_diff,
        };
        serde_json::to_string(&out).map_err(|e| JsError::new(&e.to_string()))
    }
}
