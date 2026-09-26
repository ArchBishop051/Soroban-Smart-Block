import { logger } from "./logger.js";
/**
 * On-chain contract spec cache (#895).
 *
 * Every SDK-built contract embeds its interface in the `contractspecv0`
 * custom section of its WASM. When the decoder meets a contract with no
 * registered ABI, it asks this cache for the spec. The cache never fetches on
 * the ingest path: a miss schedules a background fetch (rate-limited,
 * deduplicated), so the spec is used from the next event on.
 *
 *   contract id → (getLedgerEntries: contract instance) → executable
 *     - WASM hash → (getLedgerEntries: contract code) → parseContractSpec
 *     - Stellar Asset Contract → built-in SAC spec
 *
 * Specs are cached by WASM hash (shared by all instances of that WASM). An
 * upgrade drops the contract's hash mapping so the new WASM's spec is used
 * from the upgrade ledger onward. Hostile specs are bounded (section size and
 * entry count) and treated as absent.
 */

import { xdr, Address, rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { extractContractSpecSection, parseContractSpec } from "./wasmContractSpec.js";

const MAX_SPEC_BYTES = 256 * 1024;
const MAX_SPEC_ENTRIES = 2_000;
const MAX_CACHED_SPECS = 1_000;
const FETCHES_PER_MINUTE = Number(process.env.SPEC_FETCHES_PER_MINUTE ?? 30);

/**
 * Built-in spec for Stellar Asset Contracts (no WASM), laid out like their
 * events: topics after the event name, then the data value.
 */
export const SAC_SPEC = {
  source: "sac",
  functions: [
    { name: "transfer", inputs: [{ name: "from", type: "Address" }, { name: "to", type: "Address" }, { name: "asset", type: "String" }, { name: "amount", type: "i128" }] },
    { name: "mint", inputs: [{ name: "admin", type: "Address" }, { name: "to", type: "Address" }, { name: "asset", type: "String" }, { name: "amount", type: "i128" }] },
    { name: "burn", inputs: [{ name: "from", type: "Address" }, { name: "asset", type: "String" }, { name: "amount", type: "i128" }] },
    { name: "clawback", inputs: [{ name: "admin", type: "Address" }, { name: "from", type: "Address" }, { name: "asset", type: "String" }, { name: "amount", type: "i128" }] },
    { name: "set_admin", inputs: [{ name: "admin", type: "Address" }, { name: "asset", type: "String" }, { name: "new_admin", type: "Address" }] },
  ],
  types: [],
  errors: new Map(),
};

const specsByHash = new Map(); // wasm hash hex → spec
const hashByContract = new Map(); // contract id → wasm hash hex | "sac"
const inFlight = new Set();
let fetchTimes = [];
let server = null;

/** Parse and bound a WASM's spec; null when absent or hostile. */
export function specFromWasm(wasm) {
  let section;
  try {
    section = extractContractSpecSection(wasm);
  } catch {
    return null;
  }
  if (!section || section.length === 0 || section.length > MAX_SPEC_BYTES) return null;
  let parsed;
  try {
    parsed = parseContractSpec(wasm);
  } catch {
    return null;
  }
  if (parsed.functions.length + parsed.types.length > MAX_SPEC_ENTRIES) return null;
  const errors = new Map();
  for (const t of parsed.types) {
    if (t.kind === "error_enum") for (const c of t.cases) errors.set(Number(c.value), c.name);
  }
  return { source: "wasm", functions: parsed.functions, types: parsed.types, errors };
}

/** Cached spec for a contract, or null. Never performs I/O. */
export function getCachedSpec(contractId) {
  const hash = hashByContract.get(contractId);
  if (!hash) return null;
  return hash === "sac" ? SAC_SPEC : specsByHash.get(hash) ?? null;
}

/** Named contract error for `code` from the contract's spec, or null. */
export function contractErrorName(contractId, code) {
  return getCachedSpec(contractId)?.errors?.get(Number(code)) ?? null;
}

/** Forget the contract's WASM mapping (called on upgrade). */
export function invalidateContract(contractId) {
  hashByContract.delete(contractId);
}

/** Test/bootstrap hook: register a spec for a contract directly. */
export function primeSpec(contractId, wasmHashHex, spec) {
  hashByContract.set(contractId, wasmHashHex);
  if (wasmHashHex !== "sac") remember(wasmHashHex, spec);
}

function remember(hash, spec) {
  if (specsByHash.size >= MAX_CACHED_SPECS) specsByHash.delete(specsByHash.keys().next().value);
  specsByHash.set(hash, spec);
}

function allowFetch() {
  const now = Date.now();
  fetchTimes = fetchTimes.filter((t) => now - t < 60_000);
  if (fetchTimes.length >= FETCHES_PER_MINUTE) return false;
  fetchTimes.push(now);
  return true;
}

async function fetchSpec(contractId, rpcServer) {
  const instanceKey = new Address(contractId).toScAddress();
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: instanceKey,
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const { entries } = await rpcServer.getLedgerEntries(key);
  const instance = entries?.[0]?.val?.contractData?.().val()?.instance?.();
  const executable = instance?.executable();
  if (!executable) return;
  if (executable.switch().name === "contractExecutableStellarAsset") {
    hashByContract.set(contractId, "sac");
    return;
  }
  const hash = executable.wasmHash();
  const hex = Buffer.from(hash).toString("hex");
  if (!specsByHash.has(hex)) {
    const codeKey = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash }));
    const code = await rpcServer.getLedgerEntries(codeKey);
    const wasm = code.entries?.[0]?.val?.contractCode?.().code();
    const spec = wasm ? specFromWasm(Buffer.from(wasm)) : null;
    if (!spec) {
      hashByContract.set(contractId, hex); // known, but no usable spec
      return;
    }
    remember(hex, spec);
  }
  hashByContract.set(contractId, hex);
}

/**
 * Schedule a background spec fetch for `contractId` (non-blocking,
 * rate-limited, deduplicated). Safe to call on every cache miss.
 */
export function prefetchSpec(contractId, { rpcUrl = process.env.SOROBAN_RPC_URL, isSac = false } = {}) {
  if (!contractId || hashByContract.has(contractId) || inFlight.has(contractId)) return;
  if (isSac) {
    hashByContract.set(contractId, "sac");
    return;
  }
  if (!rpcUrl || !allowFetch()) return;
  server ??= new SorobanRpc.Server(rpcUrl, { allowHttp: true });
  inFlight.add(contractId);
  fetchSpec(contractId, server)
    .catch((err) => logger.debug?.(`[spec] fetch for ${contractId} failed: ${err.message}`))
    .finally(() => inFlight.delete(contractId));
}

/**
 * Name event arguments with a spec function's inputs.
 * @returns {{ source: "spec" | "spec_mismatch", args: Record<string, unknown> | null }}
 */
export function nameArgs(spec, fnName, args) {
  const fn = spec?.functions?.find((f) => f.name === fnName);
  if (!fn) return { source: "spec_mismatch", args: null };
  if (fn.inputs.length !== args.length) return { source: "spec_mismatch", args: null };
  return { source: "spec", args: Object.fromEntries(fn.inputs.map((inp, i) => [inp.name, args[i]])) };
}
