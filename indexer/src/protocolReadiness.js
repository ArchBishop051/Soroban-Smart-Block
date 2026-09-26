import config from "./config.js";
import { logger } from "./logger.js";
import * as alertManager from "./alertManager.js";

let degraded = false;
let observedVersion = 0;

export function protocolVersionFromLedger(ledger) {
  return Number(ledger?.protocolVersion ?? ledger?.protocol_version ?? ledger?.protocol ?? 0) || 0;
}

export function supportedProtocolVersion() { return Number(config.PROTOCOL_MAX_VERSION ?? process.env.PROTOCOL_MAX_VERSION ?? 22); }
export function isProtocolDegraded() { return degraded; }

export async function observeProtocolVersion(version) {
  const value = Number(version) || 0;
  observedVersion = Math.max(observedVersion, value);
  if (value > supportedProtocolVersion()) {
    degraded = true;
    await alertManager.fireAlert("PROTOCOL_UNSUPPORTED", `Network protocol ${value} exceeds bundled support ${supportedProtocolVersion()}`);
    logger.warn(`[protocol] degraded mode enabled at protocol ${value}; raw XDR will be retained`);
  }
  return { version: value, degraded };
}

export function protocolState() { return { observedVersion, supportedVersion: supportedProtocolVersion(), degraded }; }

export function decodeWithProtocol(decoder, event, options = {}) {
  try {
    if (degraded || Number(event.protocolVersion ?? event.protocol_version ?? 0) > supportedProtocolVersion()) return { degraded: true, raw_xdr: event.rawXdr ?? event.xdr ?? null, protocol_version: Number(event.protocolVersion ?? event.protocol_version) || null };
    return { degraded: false, value: decoder(event, options) };
  } catch (error) {
    if (/unknown|arm|union|xdr/i.test(error.message)) return { degraded: true, raw_xdr: event.rawXdr ?? event.xdr ?? null, protocol_version: Number(event.protocolVersion ?? event.protocol_version) || null, reason: "unknown_xdr_arm" };
    throw error;
  }
}
