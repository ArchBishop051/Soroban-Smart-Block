// Tutorial 2 — register an ABI and see decoded output.
// Registers a contract ABI through the REST API (API key required), then reads
// it back. Once registered, new events from the contract decode against it.
import { api, check } from "../lib.mjs";

// A syntactically valid placeholder; replace with your deployed contract ID.
const CONTRACT_ID = process.env.CONTRACT_ID ?? `C${"TUTORIAL".padEnd(55, "A")}`;

// #region register
const abi = {
  id: CONTRACT_ID,
  name: "TutorialToken",
  description: "SEP-41 token used by the tutorial series.",
  protocol_type: "token",
  functions: [
    { name: "transfer", description: "Move tokens", args: [{ name: "from", type: "Address" }, { name: "to", type: "Address" }, { name: "amount", type: "i128" }] },
    { name: "mint", description: "Create tokens", args: [{ name: "to", type: "Address" }, { name: "amount", type: "i128" }] },
  ],
};

try {
  await api("/contracts", { method: "POST", body: JSON.stringify(abi) });
  check(true, `registered ABI for ${CONTRACT_ID.slice(0, 12)}…`);
} catch (err) {
  // 409 means an earlier run already registered it — fine for a tutorial.
  if (!/HTTP 409/.test(err.message)) throw err;
  check(true, `ABI already registered for ${CONTRACT_ID.slice(0, 12)}…`);
}
// #endregion register

// #region read
// GET /contracts/:id returns the registered metadata; /contracts/:id/abi merges
// it with the on-chain WASM spec once the contract is deployed.
const stored = await api(`/contracts/${CONTRACT_ID}`);
const fns = typeof stored.functions === "string" ? JSON.parse(stored.functions) : stored.functions ?? [];
const names = fns.map((f) => f.name);
check(names.includes("transfer") && names.includes("mint"), `ABI lists functions: ${names.join(", ")}`);
// #endregion read
