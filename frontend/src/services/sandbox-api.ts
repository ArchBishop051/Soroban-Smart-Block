import { SandboxFile } from "./webcontainer";

// ImportMetaEnv (including VITE_API_URL) is declared globally in src/env.d.ts.
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
const DEFAULT_RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
type SorobanReadMethod =
  | "simulateTransaction"
  | "getLedgerEntries"
  | "getLatestLedger"
  | "getNetwork"
  | "getEvents";

export async function sorobanRpcRequest<T>(
  rpcUrl: string,
  method: SorobanReadMethod,
  params: Record<string, unknown> = {},
): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  let proxyError = "";

  if (rpcUrl === DEFAULT_RPC_URL) {
    try {
      const response = await fetch(`${API_BASE}/api/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? `RPC proxy returned ${response.status}`);
      }
      return payload.result as T;
    } catch (error) {
      proxyError = (error as Error).message;
    }
  }

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message ?? `RPC returned ${response.status}`);
    }
    return payload.result as T;
  } catch (error) {
    const directError = (error as Error).message;
    throw new Error(proxyError ? `RPC proxy failed (${proxyError}); direct RPC failed (${directError})` : directError);
  }
}

export interface SavedSandbox {
  sandboxId: string;
  templateId: string;
  files: Record<string, SandboxFile>;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export async function saveSandbox(
  sandboxId: string,
  templateId: string,
  files: Map<string, SandboxFile>,
  metadata?: Record<string, any>,
): Promise<void> {
  const filesObj: Record<string, SandboxFile> = {};
  for (const [key, file] of files) {
    filesObj[key] = file;
  }

  const response = await fetch(`${API_BASE}/api/sandbox`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sandboxId,
      templateId,
      files: filesObj,
      metadata,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save sandbox: ${response.statusText}`);
  }
}

export async function loadSandbox(sandboxId: string): Promise<SavedSandbox> {
  const response = await fetch(`${API_BASE}/api/sandbox/${sandboxId}`);

  if (!response.ok) {
    throw new Error(`Failed to load sandbox: ${response.statusText}`);
  }

  return response.json();
}

export async function listSandboxes(
  limit: number = 20,
  offset: number = 0,
): Promise<{
  sandboxes: Omit<SavedSandbox, "files">[];
  total: number;
}> {
  const response = await fetch(`${API_BASE}/api/sandboxes?limit=${limit}&offset=${offset}`);

  if (!response.ok) {
    throw new Error(`Failed to list sandboxes: ${response.statusText}`);
  }

  return response.json();
}

export async function deleteSandbox(sandboxId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sandbox/${sandboxId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(`Failed to delete sandbox: ${response.statusText}`);
  }
}
