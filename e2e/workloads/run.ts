/**
 * Workload runner (#946).
 *
 *   npx tsx workloads/run.ts [--seed 42] [--dry-run] [--out workloads/manifest.json]
 *
 * Executes the seeded workload against a local `stellar/quickstart --standalone`
 * network using the `stellar` CLI, then writes a manifest of expected indexed
 * results (contract IDs resolved) for test/workloads/manifest.test.js.
 * `--dry-run` prints the plan only; the same seed always yields the same plan.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { buildWorkload } from "./scenarios.ts";
import type { Step } from "./dsl.ts";

const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const seed = Number(flag("--seed", process.env.WORKLOAD_SEED ?? "42"));
const out = flag("--out", new URL("./manifest.json", import.meta.url).pathname)!;
const dryRun = argv.includes("--dry-run");

const NETWORK = [
  "--rpc-url", process.env.WORKLOAD_RPC_URL ?? "http://localhost:8000/soroban/rpc",
  "--network-passphrase", process.env.WORKLOAD_PASSPHRASE ?? "Standalone Network ; February 2017",
];
const PREFIX = `wl${seed}-`;
const contracts = new Map<string, string>();
const accounts = new Map<string, string>();

function stellar(args: string[], { network = true } = {}): string {
  return execFileSync("stellar", network ? [...args, ...NETWORK] : args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const key = (alias: string) => PREFIX + alias;
const resolve = (value: string | number) =>
  typeof value === "number" ? String(value) : accounts.get(value) ?? contracts.get(value) ?? value;

function invokeArgs(step: Extract<Step, { kind: "invoke" }>, extra: string[] = []): string[] {
  const args = ["contract", "invoke", "--id", contracts.get(step.contract)!, "--source", key(step.source), ...extra, "--", step.fn];
  for (const [name, value] of Object.entries(step.args)) args.push(`--${name}`, resolve(value));
  return args;
}

function execute(step: Step) {
  switch (step.kind) {
    case "account":
      stellar(["keys", "generate", key(step.alias), "--fund", "--overwrite", ...NETWORK], { network: false });
      accounts.set(step.alias, stellar(["keys", "address", key(step.alias)], { network: false }));
      return;
    case "sac": {
      const asset = `${step.code}:${accounts.get(step.issuer)}`;
      try {
        stellar(["contract", "asset", "deploy", "--asset", asset, "--source", key(step.issuer)]);
      } catch {
        // Already deployed for this issuer — the ID lookup below still works.
      }
      contracts.set(step.alias, stellar(["contract", "id", "asset", "--asset", asset]));
      return;
    }
    case "deploy":
      contracts.set(step.alias, stellar(["contract", "deploy", "--wasm", step.wasm, "--source", key(step.source)]));
      return;
    case "invoke": {
      const run = () => stellar(invokeArgs(step));
      if (step.expectFailure) {
        let failed = false;
        try {
          run();
        } catch {
          failed = true;
        }
        if (!failed) throw new Error(`expected ${step.contract}.${step.fn} to fail`);
        return;
      }
      if (step.feeBump) {
        // Build the inner tx, wrap it in a fee bump paid by the sponsor, then submit.
        const pipe = (args: string[], input: string) => execFileSync("stellar", [...args, ...NETWORK], { input, encoding: "utf8" }).trim();
        const inner = stellar(invokeArgs(step, ["--build-only"]));
        const simulated = pipe(["tx", "simulate", "--source", key(step.source)], inner);
        const signed = pipe(["tx", "sign", "--sign-with-key", key(step.source)], simulated);
        const bumped = pipe(["tx", "fee-bump", "--source", key(step.feeBump), "--fee", "1000000"], signed);
        pipe(["tx", "send"], pipe(["tx", "sign", "--sign-with-key", key(step.feeBump)], bumped));
        return;
      }
      run();
      return;
    }
    case "extend":
      stellar(["contract", "extend", "--id", contracts.get(step.contract)!, "--durability", "persistent", "--ledgers-to-extend", String(step.ledgers), "--source", key(step.source)]);
      return;
    case "restore":
      stellar(["contract", "restore", "--id", contracts.get(step.contract)!, "--durability", "persistent", "--source", key(step.source)]);
      return;
    case "upgrade": {
      const hash = stellar(["contract", "upload", "--wasm", step.wasm, "--source", key(step.source)]);
      stellar(["contract", "invoke", "--id", contracts.get(step.contract)!, "--source", key(step.source), "--", "upgrade", "--new_wasm_hash", hash]);
      return;
    }
  }
}

const workload = buildWorkload(seed);
if (dryRun) {
  console.log(JSON.stringify(workload, null, 2));
  process.exit(0);
}

const started = Date.now();
for (const [i, step] of workload.steps.entries()) {
  process.stdout.write(`[${i + 1}/${workload.steps.length}] ${step.kind} ${"alias" in step ? step.alias : `${step.contract}${"fn" in step ? `.${step.fn}` : ""}`}\n`);
  execute(step);
}

const manifest = {
  seed,
  generated_at: new Date().toISOString(),
  duration_ms: Date.now() - started,
  contracts: Object.fromEntries(contracts),
  skipped: workload.skipped,
  expectations: workload.expectations.map((e) => ({ ...e, contract_id: contracts.get(e.contract) })),
};
writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`manifest written to ${out} (${manifest.expectations.length} expectations, ${manifest.skipped.length} skipped scenarios)`);
