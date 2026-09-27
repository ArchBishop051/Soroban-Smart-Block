/**
 * Workload DSL (#946).
 *
 * A workload is a deterministic list of steps built from a seed. Steps refer to
 * accounts and contracts by alias; the runner resolves aliases to real
 * addresses at execution time. Every step that should surface in the indexer
 * carries an expectation, collected into the manifest used by the e2e suite.
 * Expectations assert on content (contract + event name + count), never on
 * ledger numbers, because ledger timing varies between runs.
 */

export type Step =
  | { kind: "account"; alias: string }
  | { kind: "deploy"; alias: string; wasm: string; source: string }
  | { kind: "sac"; alias: string; code: string; issuer: string }
  | { kind: "invoke"; contract: string; source: string; fn: string; args: Record<string, string | number>; expectFailure?: boolean; feeBump?: string }
  | { kind: "extend"; contract: string; source: string; ledgers: number }
  | { kind: "restore"; contract: string; source: string }
  | { kind: "upgrade"; contract: string; wasm: string; source: string };

export interface Expectation {
  scenario: string;
  contract: string; // alias, resolved to a contract ID in the manifest
  event: string; // event topic / decoded function name
  count: number; // minimum number of indexed events
}

export interface Workload {
  seed: number;
  steps: Step[];
  expectations: Expectation[];
  skipped: { scenario: string; reason: string }[];
}

/** mulberry32 — tiny, fast, deterministic PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WorkloadBuilder {
  readonly rand: () => number;
  private readonly w: Workload;
  private scenario = "setup";

  constructor(seed: number) {
    this.rand = prng(seed);
    this.w = { seed, steps: [], expectations: [], skipped: [] };
  }

  /** Integer in [min, max], drawn from the seeded PRNG. */
  int(min: number, max: number): number {
    return min + Math.floor(this.rand() * (max - min + 1));
  }

  begin(name: string): this {
    this.scenario = name;
    return this;
  }

  skip(reason: string): this {
    this.w.skipped.push({ scenario: this.scenario, reason });
    return this;
  }

  step(step: Step): this {
    this.w.steps.push(step);
    return this;
  }

  expect(contract: string, event: string, count = 1): this {
    const existing = this.w.expectations.find((e) => e.scenario === this.scenario && e.contract === contract && e.event === event);
    if (existing) existing.count += count;
    else this.w.expectations.push({ scenario: this.scenario, contract, event, count });
    return this;
  }

  build(): Workload {
    return structuredClone(this.w);
  }
}
