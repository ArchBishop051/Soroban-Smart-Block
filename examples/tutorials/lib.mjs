// Shared helpers for the tutorials. Only Node.js built-ins plus `ws`.
export const API_URL = (process.env.EXPLORER_URL ?? "http://localhost:3001").replace(/\/+$/, "");
export const API_KEY = process.env.API_KEY;

export async function api(path, init = {}) {
  const headers = { "Content-Type": "application/json", ...(API_KEY ? { "X-API-Key": API_KEY } : {}), ...init.headers };
  const res = await fetch(`${API_URL}/api${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

/** Print a ✔ line (checked by run-all.mjs) or throw. */
export function check(condition, message) {
  if (!condition) throw new Error(`check failed: ${message}`);
  console.log(`✔ ${message}`);
}
