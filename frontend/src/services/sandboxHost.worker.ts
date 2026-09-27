// Web Worker hosting the Soroban host compiled to WASM (#925). The module is
// built by packages/sandbox-host/build.sh into /sandbox-host/ and lazy-loaded
// on first use; the service worker caches it for offline use.

import type { HostRequest } from "./sandbox-api";

interface HostModule {
  default: (input?: unknown) => Promise<unknown>;
  hostProtocolVersion: () => number;
  SandboxHost: new () => {
    setLedgerInfo(protocol: number, sequence: number, timestamp: bigint, passphrase: string): void;
    setLedgerEntry(key: string, entry: string, liveUntil?: number): void;
    entryCount(): number;
    invoke(hostFn: string, diagnostics: boolean): string;
  };
}

// The app compiles against the DOM lib; the worker scope shares Worker's shape.
const ctx = self as unknown as Worker;

let mod: HostModule | null = null;
let host: InstanceType<HostModule["SandboxHost"]> | null = null;

async function ensureHost() {
  if (!mod) {
    const url = `${self.location.origin}/sandbox-host/soroban_sandbox_host.js`;
    mod = (await import(/* @vite-ignore */ url)) as HostModule;
    await mod.default();
  }
  host ??= new mod.SandboxHost();
  return { mod, host };
}

ctx.onmessage = async (ev: MessageEvent<HostRequest>) => {
  const req = ev.data;
  try {
    const { mod: m, host: h } = await ensureHost();
    let result: unknown = null;
    switch (req.op) {
      case "init":
        result = { protocolVersion: m.hostProtocolVersion(), entries: h.entryCount() };
        break;
      case "setLedgerInfo":
        h.setLedgerInfo(req.protocol, req.sequence, BigInt(req.timestamp), req.passphrase);
        break;
      case "setEntries":
        for (const e of req.entries) h.setLedgerEntry(e.key, e.entry, e.liveUntilLedgerSeq ?? undefined);
        result = { entries: h.entryCount() };
        break;
      case "invoke":
        result = JSON.parse(h.invoke(req.hostFn, req.diagnostics));
        break;
    }
    ctx.postMessage({ id: req.id, ok: true, result });
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
