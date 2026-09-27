/**
 * Compile a validated filter AST (filters/filter.js) to a parameterized SQL
 * WHERE fragment over the `events` table (#902).
 *
 * Every value — including args paths — is passed as a bind parameter; the
 * SQL text only ever contains fixed column names, operators and `$n`
 * placeholders. i128 amounts are compared as `numeric` whatever their JSON
 * representation (explorer_numeric), and missing fields evaluate to false
 * (explorer_try_jsonb / COALESCE under NOT). Both helpers come from
 * migration 038.
 */

import { parseField, numeric, inList } from "./filter.js";

const SQL_OPS = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };

/**
 * @param {object} ast validated AST
 * @param {unknown[]} [params] existing params to append to
 * @returns {{ sql: string, params: unknown[] }}
 */
export function compileFilter(ast, params = []) {
  const bind = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  const textExpr = (f) => {
    if (f.kind === "column") return f.column;
    if (f.kind === "topic") return `(raw_topics->>${f.index})`;
    return `(explorer_try_jsonb(raw_data) #>> ${bind(f.path)}::text[])`;
  };

  const isNumericValue = (v) => typeof v !== "boolean" && numeric(v) !== null;

  const predicate = (n) => {
    const f = parseField(n.field);

    if (n.op === "exists") return `(${textExpr(f)} IS NOT NULL)`;

    // Integer columns: keep the bigint comparison so indexes are usable.
    if (f.kind === "column" && f.type === "number") {
      if (n.op === "in") return `(${f.column} = ANY(${bind(n.value.map(String))}::bigint[]))`;
      if (n.op === "between") {
        return `(${f.column} BETWEEN ${bind(String(n.value[0]))}::bigint AND ${bind(String(n.value[1]))}::bigint)`;
      }
      return `(${f.column} ${SQL_OPS[n.op]} ${bind(String(n.value))}::bigint)`;
    }

    // topic[0] equality matches the (raw_topics->0) expression index.
    if (f.kind === "topic" && f.index === 0 && n.op === "eq" && typeof n.value === "string") {
      return `(raw_topics->0 = to_jsonb(${bind(n.value)}::text))`;
    }

    const expr = textExpr(f);
    if (n.op === "in") {
      const values = inList(n.value);
      return values.every(isNumericValue)
        ? `(explorer_numeric(${expr}) = ANY(${bind(values.map(String))}::numeric[]))`
        : `(${expr} = ANY(${bind(values)}::text[]))`;
    }
    if (n.op === "between") {
      if (n.value.every(isNumericValue)) {
        return `(explorer_numeric(${expr}) BETWEEN ${bind(String(n.value[0]))}::numeric AND ${bind(String(n.value[1]))}::numeric)`;
      }
      return `(${expr} BETWEEN ${bind(String(n.value[0]))} AND ${bind(String(n.value[1]))})`;
    }
    if (isNumericValue(n.value)) {
      return `(explorer_numeric(${expr}) ${SQL_OPS[n.op]} ${bind(String(n.value))}::numeric)`;
    }
    return `(${expr} ${SQL_OPS[n.op]} ${bind(String(n.value))})`;
  };

  const walk = (n) => {
    if (n.and) return `(${n.and.map(walk).join(" AND ")})`;
    if (n.or) return `(${n.or.map(walk).join(" OR ")})`;
    // Missing fields yield NULL; treat them as false so NOT flips them to true,
    // matching the in-memory evaluator.
    if (n.not) return `(NOT COALESCE(${walk(n.not)}, FALSE))`;
    return predicate(n);
  };

  return { sql: walk(ast), params };
}
