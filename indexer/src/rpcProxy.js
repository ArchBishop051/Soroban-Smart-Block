import crypto from "crypto";
import { TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import config from "./config.js";
import { cacheGet, cacheSet } from "./cacheLayer.js";
import { multiNodeRpc } from "./rpcMultiNode.js";

export const ALLOWED_RPC_METHODS = new Set([
  "simulateTransaction",
  "getLedgerEntries",
  "getLatestLedger",
  "getNetwork",
  "getEvents",
]);

const inFlight = new Map();

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function singleFlight(key, loader) {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = Promise.resolve()
    .then(loader)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

function invalid(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function getLedgerEntries(params) {
  const keys = params?.keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 100 || keys.some((key) => typeof key !== "string")) {
    throw invalid("getLedgerEntries requires between 1 and 100 base64 ledger keys");
  }

  const latest = await multiNodeRpc.getLatestLedger();
  const key = `rpc:ledger-entries:${latest.sequence}:${latest.id}:${hash(stableJson(keys))}`;
  const cached = await cacheGet(key);
  if (cached !== null) return cached;

  return singleFlight(key, async () => {
    const secondCheck = await cacheGet(key);
    if (secondCheck !== null) return secondCheck;
    const ledgerKeys = keys.map((encoded) => xdr.LedgerKey.fromXDR(encoded, "base64"));
    const result = await multiNodeRpc.getLedgerEntries(...ledgerKeys);
    await cacheSet(key, result, 3600);
    return result;
  });
}

async function simulateTransaction(params) {
  if (typeof params?.transaction !== "string" || params.transaction.length > 32_768) {
    throw invalid("simulateTransaction requires a base64 transaction under 32768 characters");
  }

  const latest = await multiNodeRpc.getLatestLedger();
  const key = `rpc:simulation:${latest.sequence}:${latest.id}:${hash(params.transaction)}`;
  const cached = await cacheGet(key);
  if (cached !== null) return cached;

  return singleFlight(key, async () => {
    const secondCheck = await cacheGet(key);
    if (secondCheck !== null) return secondCheck;
    const transaction = TransactionBuilder.fromXDR(params.transaction, config.NETWORK_PASSPHRASE);
    const result = await multiNodeRpc.simulateTransaction(transaction, params.resourceLeeway, params.authMode);
    const footprint = result.transactionData?.getFootprint?.();
    const writeKeys = footprint?.readWrite?.();
    if (!result.error && Array.isArray(writeKeys) && writeKeys.length === 0) {
      await cacheSet(key, result, 3600);
    }
    return result;
  });
}

export async function proxyRpcRequest(method, params = {}) {
  if (!ALLOWED_RPC_METHODS.has(method)) {
    throw Object.assign(new Error("RPC method is not allowed"), { statusCode: 403 });
  }

  if (method === "getLedgerEntries") return getLedgerEntries(params);
  if (method === "simulateTransaction") return simulateTransaction(params);

  const key = `rpc:request:${method}:${stableJson(params)}`;
  return singleFlight(key, async () => {
    if (method === "getLatestLedger" || method === "getNetwork") {
      if (Array.isArray(params) && params.length > 0) throw invalid(`${method} does not accept parameters`);
      if (!Array.isArray(params) && Object.keys(params ?? {}).length > 0) {
        throw invalid(`${method} does not accept parameters`);
      }
      return multiNodeRpc[method]();
    }
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw invalid("getEvents parameters must be an object");
    }
    if (!Number.isSafeInteger(params.startLedger) || params.startLedger < 1) {
      throw invalid("getEvents requires a positive startLedger");
    }
    if (params.filters && (!Array.isArray(params.filters) || params.filters.length > 5)) {
      throw invalid("getEvents accepts at most five filters");
    }
    return multiNodeRpc.getEvents(params);
  });
}
