/**
 * Event filter language (#902) — AST, textual parser, validation, planner and
 * an in-memory evaluator with the same semantics as the SQL compiler
 * (filters/sql.js). Grammar and examples: docs/guides/filters.md.
 *
 * AST
 *   { and: [node, ...] } | { or: [node, ...] } | { not: node }
 *   { field, op, value? }
 *     field: contract_id | function | ledger | seq | tx_hash
 *            | topic[0..3] | args.<path>   (path segments: identifiers or indices)
 *     op:    eq | ne | gt | gte | lt | lte | in | between | exists
 */

export const COLUMN_FIELDS = {
  contract_id: "text",
  function: "text",
  tx_hash: "text",
  ledger: "number",
  seq: "number",
};
export const OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "between", "exists"];
/** Per-tier limits for filtered queries (EXPLAIN total cost, statement timeout). */
export const FILTER_TIER_LIMITS = {
  unauthenticated: { maxCost: 10_000, timeoutMs: 1_000 },
  free: { maxCost: 100_000, timeoutMs: 2_000 },
  pro: { maxCost: 1_000_000, timeoutMs: 5_000 },
  enterprise: { maxCost: 10_000_000, timeoutMs: 15_000 },
};
export const LIMITS = { maxNodes: 64, maxDepth: 8, maxIn: 100, maxPathDepth: 8, maxString: 256 };
/** Widest ledger range allowed for filters on non-indexed fields (~ 7 days). */
export const MAX_UNINDEXED_LEDGER_SPAN = 120_000;

const TOPIC_RE = /^topic\[([0-3])\]$/;
const ARGS_RE = /^args((?:\.[A-Za-z_][A-Za-z0-9_]{0,63}|\.\d{1,4})+)$/;
const NUMERIC_RE = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

export class FilterError extends Error {}

/** Classify a field: { kind: "column"|"topic"|"args", ... } or null. */
export function parseField(field) {
  if (typeof field !== "string") return null;
  if (field in COLUMN_FIELDS) return { kind: "column", column: field, type: COLUMN_FIELDS[field] };
  const t = field.match(TOPIC_RE);
  if (t) return { kind: "topic", index: Number(t[1]) };
  const a = field.match(ARGS_RE);
  if (a) {
    const path = a[1].slice(1).split(".");
    if (path.length > LIMITS.maxPathDepth) return null;
    return { kind: "args", path };
  }
  return null;
}

const isScalar = (v) =>
  (typeof v === "string" && v.length <= LIMITS.maxString) || (typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean";

/** Validate an AST; throws FilterError with a readable message. */
export function validateFilter(node) {
  let count = 0;
  const walk = (n, depth) => {
    if (++count > LIMITS.maxNodes) throw new FilterError(`filter has more than ${LIMITS.maxNodes} nodes`);
    if (depth > LIMITS.maxDepth) throw new FilterError(`filter nests deeper than ${LIMITS.maxDepth}`);
    if (!n || typeof n !== "object" || Array.isArray(n)) throw new FilterError("filter node must be an object");
    if ("and" in n || "or" in n) {
      const list = n.and ?? n.or;
      if (!Array.isArray(list) || list.length === 0) throw new FilterError("and/or needs a non-empty array");
      list.forEach((c) => walk(c, depth + 1));
      return;
    }
    if ("not" in n) return walk(n.not, depth + 1);
    const f = parseField(n.field);
    if (!f) throw new FilterError(`unknown field: ${String(n.field).slice(0, 64)}`);
    if (!OPS.includes(n.op)) throw new FilterError(`unknown operator: ${String(n.op).slice(0, 16)}`);
    if (n.op === "exists") return;
    if (n.op === "in") {
      if (!Array.isArray(n.value) || n.value.length === 0 || n.value.length > LIMITS.maxIn || !n.value.every(isScalar)) {
        throw new FilterError(`in needs 1..${LIMITS.maxIn} scalar values`);
      }
    } else if (n.op === "between") {
      if (!Array.isArray(n.value) || n.value.length !== 2 || !n.value.every(isScalar)) {
        throw new FilterError("between needs [low, high]");
      }
    } else if (!isScalar(n.value)) {
      throw new FilterError(`${n.field} ${n.op} needs a string, number or boolean`);
    }
    if (f.kind === "column" && f.type === "number") {
      const vals = Array.isArray(n.value) ? n.value : [n.value];
      if (!vals.every((v) => typeof v !== "boolean" && /^-?\d{1,19}$/.test(String(v)))) {
        throw new FilterError(`${n.field} compares integers`);
      }
    }
  };
  walk(node, 0);
  return node;
}

// ── Textual form ─────────────────────────────────────────────────────────────
//   expr    := or
//   or      := and ("or" and)*
//   and     := unary ("and" unary)*
//   unary   := "not" unary | "(" expr ")" | pred
//   pred    := FIELD OP value | FIELD "in" "(" value ("," value)* ")"
//            | FIELD "between" value "and" value | FIELD "exists"
//   OP      := = != > >= < <=
//   value   := "string" | number | true | false

const SYMBOL_OPS = { "=": "eq", "!=": "ne", ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" };

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)(?![\w.])|(>=|<=|!=|[=<>(),])|([A-Za-z_][\w.[\]]*))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new FilterError(`unexpected input at ${pos}: ${src.slice(pos, pos + 16)}`);
    if (m[1] !== undefined) tokens.push({ t: "str", v: JSON.parse(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: "num", v: m[2] });
    else if (m[3] !== undefined) tokens.push({ t: "sym", v: m[3] });
    else tokens.push({ t: "word", v: m[4] });
    pos = re.lastIndex;
  }
  return tokens;
}

/** Parse the textual form into an AST (validated). */
export function parseFilter(src) {
  if (typeof src !== "string" || src.length > 4096) throw new FilterError("filter must be a string of at most 4096 characters");
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const isWord = (w) => peek()?.t === "word" && peek().v.toLowerCase() === w;
  const expectSym = (s) => {
    if (peek()?.t !== "sym" || peek().v !== s) throw new FilterError(`expected "${s}"`);
    i++;
  };
  const value = () => {
    const tok = tokens[i++];
    if (!tok) throw new FilterError("expected a value");
    if (tok.t === "str") return tok.v;
    if (tok.t === "num") return Number.isSafeInteger(Number(tok.v)) || tok.v.includes(".") ? Number(tok.v) : tok.v;
    if (tok.t === "word" && (tok.v === "true" || tok.v === "false")) return tok.v === "true";
    throw new FilterError(`expected a value, got ${tok.v}`);
  };
  const pred = () => {
    const f = tokens[i++];
    if (f?.t !== "word") throw new FilterError("expected a field name");
    if (isWord("exists")) return i++, { field: f.v, op: "exists" };
    if (isWord("in")) {
      i++;
      expectSym("(");
      const vals = [value()];
      while (peek()?.v === ",") i++, vals.push(value());
      expectSym(")");
      return { field: f.v, op: "in", value: vals };
    }
    if (isWord("between")) {
      i++;
      const lo = value();
      if (!isWord("and")) throw new FilterError('expected "and" in between');
      i++;
      return { field: f.v, op: "between", value: [lo, value()] };
    }
    const op = tokens[i++];
    if (op?.t !== "sym" || !SYMBOL_OPS[op.v]) throw new FilterError(`expected an operator after ${f.v}`);
    return { field: f.v, op: SYMBOL_OPS[op.v], value: value() };
  };
  const unary = () => {
    if (isWord("not")) return i++, { not: unary() };
    if (peek()?.v === "(" && peek()?.t === "sym") {
      i++;
      const e = or();
      expectSym(")");
      return e;
    }
    return pred();
  };
  const and = () => {
    const parts = [unary()];
    while (isWord("and")) i++, parts.push(unary());
    return parts.length === 1 ? parts[0] : { and: parts };
  };
  const or = () => {
    const parts = [and()];
    while (isWord("or")) i++, parts.push(and());
    return parts.length === 1 ? parts[0] : { or: parts };
  };
  const ast = or();
  if (i !== tokens.length) throw new FilterError(`unexpected "${tokens[i].v}"`);
  return validateFilter(ast);
}

/** Accept a JSON AST (object or JSON string) or the textual form. */
export function toFilterAst(input) {
  if (input && typeof input === "object") return validateFilter(input);
  if (typeof input === "string" && input.trim().startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new FilterError("filter JSON is malformed");
    }
    return validateFilter(parsed);
  }
  return parseFilter(input);
}

// ── Planner ──────────────────────────────────────────────────────────────────

const INDEXED = new Set(["contract_id", "function", "tx_hash", "ledger", "seq", "topic[0]"]);
const SELECTIVE_OPS = new Set(["eq", "in", "between", "gt", "gte", "lt", "lte"]);

function conjuncts(node) {
  return node.and ? node.and.flatMap(conjuncts) : [node];
}

function hasUnindexed(node) {
  if (node.and || node.or) return (node.and ?? node.or).some(hasUnindexed);
  if (node.not) return hasUnindexed(node.not);
  return !INDEXED.has(node.field);
}

function ledgerSpan(parts) {
  let lo = -Infinity;
  let hi = Infinity;
  for (const p of parts) {
    if (p.field !== "ledger") continue;
    const v = Array.isArray(p.value) ? p.value.map(Number) : Number(p.value);
    if (p.op === "eq") (lo = Math.max(lo, v)), (hi = Math.min(hi, v));
    if (p.op === "between") (lo = Math.max(lo, v[0])), (hi = Math.min(hi, v[1]));
    if (p.op === "gt" || p.op === "gte") lo = Math.max(lo, v);
    if (p.op === "lt" || p.op === "lte") hi = Math.min(hi, v);
  }
  return hi - lo;
}

/**
 * Refuse filters that cannot use an index. Each OR branch must have an
 * indexed, selective conjunct; filters touching non-indexed fields (args,
 * topic[1..3]) must also be bounded by contract_id and a ledger range of at
 * most MAX_UNINDEXED_LEDGER_SPAN.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function planFilter(ast) {
  const branches = ast.or ? ast.or : [ast];
  for (const branch of branches) {
    const parts = conjuncts(branch);
    const indexed = parts.some((p) => INDEXED.has(p.field) && SELECTIVE_OPS.has(p.op));
    if (!indexed) {
      return { ok: false, reason: "each branch needs a condition on contract_id, function, tx_hash, ledger, seq or topic[0]" };
    }
    if (hasUnindexed(branch)) {
      const hasContract = parts.some((p) => p.field === "contract_id" && (p.op === "eq" || p.op === "in"));
      const span = ledgerSpan(parts);
      if (!hasContract || !(span <= MAX_UNINDEXED_LEDGER_SPAN)) {
        return {
          ok: false,
          reason: `filters on args or topic[1..3] must also fix contract_id and a ledger range of at most ${MAX_UNINDEXED_LEDGER_SPAN} ledgers`,
        };
      }
    }
  }
  return { ok: true };
}

// ── Evaluator (live events: WS subscriptions, webhooks) ─────────────────────

export function numeric(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && NUMERIC_RE.test(v)) return v;
  return null;
}

/** Compare two numeric values exactly (i128-safe for integers). */
function cmpNumeric(a, b) {
  const intLike = (x) => /^-?\d+$/.test(String(x));
  if (intLike(a) && intLike(b)) {
    const x = BigInt(String(a));
    const y = BigInt(String(b));
    return x === y ? 0 : x < y ? -1 : 1;
  }
  const x = Number(a);
  const y = Number(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

function fieldValue(event, f) {
  if (f.kind === "column") return event[f.column];
  const topics = Array.isArray(event.raw_topics) ? event.raw_topics : [];
  if (f.kind === "topic") return topics[f.index];
  let data = event.raw_data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  return f.path.reduce((o, k) => (o !== null && typeof o === "object" ? o[k] : undefined), data);
}

/** Numeric comparison when the filter value is numeric, text otherwise (as in SQL). */
function compare(op, actual, expected) {
  if (actual === undefined || actual === null || typeof actual === "object") return false;
  const e = typeof expected === "boolean" ? null : numeric(expected);
  if (e !== null) {
    const a = numeric(actual);
    if (a === null) return false;
    const c = cmpNumeric(a, e);
    return { eq: c === 0, ne: c !== 0, gt: c > 0, gte: c >= 0, lt: c < 0, lte: c <= 0 }[op];
  }
  const x = String(actual);
  const y = String(expected);
  return { eq: x === y, ne: x !== y, gt: x > y, gte: x >= y, lt: x < y, lte: x <= y }[op];
}

/** `in` lists compare numerically only when every value is numeric (as in SQL). */
export function inList(values) {
  return values.every((v) => typeof v !== "boolean" && numeric(v) !== null) ? values : values.map(String);
}

/** Build a predicate `(event) => boolean` from a validated AST. */
export function evaluateFilter(ast) {
  const build = (n) => {
    if (n.and) {
      const fs = n.and.map(build);
      return (e) => fs.every((f) => f(e));
    }
    if (n.or) {
      const fs = n.or.map(build);
      return (e) => fs.some((f) => f(e));
    }
    if (n.not) {
      const f = build(n.not);
      return (e) => !f(e);
    }
    const field = parseField(n.field);
    return (e) => {
      const v = fieldValue(e, field);
      switch (n.op) {
        case "exists":
          return v !== undefined && v !== null;
        case "in":
          return inList(n.value).some((x) => compare("eq", v, x));
        case "between":
          return compare("gte", v, n.value[0]) && compare("lte", v, n.value[1]);
        default:
          return compare(n.op, v, n.value);
      }
    };
  };
  return build(ast);
}
