/**
 * Event filter DSL for the TUI filter bar.
 *
 *   fn:transfer contract:CDA2 !fn:approve ledger>=1200 swap
 *
 * Terms are ANDed. `key:value` matches a field by substring (case-insensitive),
 * `!` negates a term, `ledger`/`seq` accept >, >=, <, <=, = comparisons, and a
 * bare word matches the function, description or contract ID.
 */

const FIELDS = { fn: "function", function: "function", contract: "contract_id", tx: "tx_hash", desc: "description" };
const NUMERIC = /^(ledger|seq)(>=|<=|>|<|=)(\d+)$/;

function compileTerm(raw) {
  const negate = raw.startsWith("!");
  const term = negate ? raw.slice(1) : raw;
  let test;

  const numeric = term.match(NUMERIC);
  if (numeric) {
    const [, field, op, value] = numeric;
    const n = Number(value);
    const cmp = { ">": (a) => a > n, ">=": (a) => a >= n, "<": (a) => a < n, "<=": (a) => a <= n, "=": (a) => a === n }[op];
    test = (ev) => cmp(Number(ev[field]));
  } else if (term.includes(":") && FIELDS[term.split(":")[0].toLowerCase()]) {
    const idx = term.indexOf(":");
    const field = FIELDS[term.slice(0, idx).toLowerCase()];
    const needle = term.slice(idx + 1).toLowerCase();
    test = (ev) => String(ev[field] ?? "").toLowerCase().includes(needle);
  } else {
    const needle = term.toLowerCase();
    test = (ev) => [ev.function, ev.description, ev.contract_id].some((v) => String(v ?? "").toLowerCase().includes(needle));
  }
  return negate ? (ev) => !test(ev) : test;
}

/** Compile a filter string into a predicate. An empty string matches everything. */
export function compileFilter(source = "") {
  const terms = source.trim().split(/\s+/).filter(Boolean).map(compileTerm);
  return (ev) => terms.every((t) => t(ev));
}
