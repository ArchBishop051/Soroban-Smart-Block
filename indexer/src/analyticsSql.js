import pg from "pg";
import { parse, toSql } from "pgsql-ast-parser";

const ALLOWED_TABLES = new Set(["events", "transactions", "rollups", "tokens"]);
const ALLOWED_FUNCTIONS = new Set([
  "abs",
  "avg",
  "coalesce",
  "count",
  "date_trunc",
  "lower",
  "max",
  "min",
  "nullif",
  "round",
  "sum",
  "upper",
]);
const ROW_LIMIT = 1000;
const MAX_QUERY_LENGTH = 16_384;
const MAX_EXPLAIN_COST = 100_000;
const QUOTAS = {
  unauthenticated: { queries: 0, cpuMs: 0 },
  free: { queries: 10, cpuMs: 5000 },
  pro: { queries: 100, cpuMs: 30_000 },
  enterprise: { queries: 1000, cpuMs: 120_000 },
};

export const analyticsPool = process.env.ANALYTICS_DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.ANALYTICS_DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 2000,
    })
  : null;

const dailyUsage = new Map();

export class AnalyticsQueryError extends Error {}

export function validateAnalyticsQuery(query) {
  if (typeof query !== "string" || query.length === 0 || query.length > MAX_QUERY_LENGTH) {
    throw new AnalyticsQueryError("query must be a non-empty string of at most 16384 characters");
  }

  let statements;
  try {
    statements = parse(query);
  } catch {
    throw new AnalyticsQueryError("query contains invalid SQL");
  }
  if (statements.length !== 1) throw new AnalyticsQueryError("exactly one SELECT statement is allowed");

  const statement = statements[0];
  if (!["select", "union", "union all"].includes(statement.type)) {
    throw new AnalyticsQueryError("only SELECT statements are allowed");
  }

  let tableCount = 0;
  let joinCount = 0;
  const inspect = (node) => {
    if (Array.isArray(node)) {
      node.forEach(inspect);
      return;
    }
    if (!node || typeof node !== "object") return;

    if (node.type === "with" || node.type === "with recursive") {
      throw new AnalyticsQueryError("CTEs are not allowed");
    }
    if (
      node.type === "select" &&
      Array.isArray(node.from) &&
      node.from.length > 1 &&
      node.from.slice(1).some((table) => !table.join)
    ) {
      throw new AnalyticsQueryError("implicit CROSS JOIN is not allowed");
    }
    if (node.type === "select" && node.limit) {
      const limit = node.limit.limit;
      const offset = node.limit.offset;
      if (limit && (limit.type !== "integer" || limit.value > ROW_LIMIT)) {
        throw new AnalyticsQueryError(`LIMIT must be an integer no greater than ${ROW_LIMIT}`);
      }
      if (offset && (offset.type !== "integer" || offset.value > 10_000)) {
        throw new AnalyticsQueryError("OFFSET must be an integer no greater than 10000");
      }
    }
    if (node.type === "table") {
      const { name, schema } = node.name;
      if (schema !== "analytics" || !ALLOWED_TABLES.has(name)) {
        throw new AnalyticsQueryError("queries may only read curated analytics views");
      }
      tableCount += 1;
    }
    if (node.type === "CROSS JOIN") {
      throw new AnalyticsQueryError("CROSS JOIN is not allowed");
    }
    if (node.for || node.skip) {
      throw new AnalyticsQueryError("locking clauses are not allowed");
    }
    if (["INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN"].includes(node.type)) {
      joinCount += 1;
      if (joinCount > 4) throw new AnalyticsQueryError("at most four joins are allowed");
    }
    if (node.type === "call") {
      const { name, schema } = node.function;
      if (schema || !ALLOWED_FUNCTIONS.has(name.toLowerCase()) || node.over) {
        throw new AnalyticsQueryError(`function ${name} is not allowed`);
      }
    }
    if (node.type === "cast") {
      throw new AnalyticsQueryError("explicit type casts are not allowed");
    }
    if (node.type === "parameter") {
      throw new AnalyticsQueryError("query parameters are not supported");
    }
    if (
      node.type === "keyword" &&
      ["current_catalog", "current_role", "current_schema", "session_user", "user", "current_user"].includes(
        node.keyword,
      )
    ) {
      throw new AnalyticsQueryError("session metadata is not available");
    }

    Object.values(node).forEach(inspect);
  };
  inspect(statement);
  if (tableCount === 0) throw new AnalyticsQueryError("query must read a curated analytics view");

  return toSql.statement(statement);
}

function reserveQuery(clientId, tier) {
  const quota = QUOTAS[tier] ?? QUOTAS.unauthenticated;
  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}:${clientId}`;
  for (const oldKey of dailyUsage.keys()) {
    if (!oldKey.startsWith(`${day}:`)) dailyUsage.delete(oldKey);
  }
  const usage = dailyUsage.get(key) ?? { queries: 0, cpuMs: 0 };
  if (usage.queries >= quota.queries) {
    throw Object.assign(new Error("Daily analytics query quota exceeded"), { statusCode: 429 });
  }
  if (!dailyUsage.has(key) && dailyUsage.size >= 10_000) {
    throw Object.assign(new Error("Analytics quota capacity is temporarily exhausted"), { statusCode: 503 });
  }
  usage.queries += 1;
  dailyUsage.set(key, usage);
  return { usage, quota };
}

export async function executeAnalyticsQuery(query, { clientId, tier, format = "json" }) {
  if (!analyticsPool) {
    throw Object.assign(new Error("Analytics database is not configured"), { statusCode: 503 });
  }
  if (!["json", "csv"].includes(format)) {
    throw Object.assign(new Error("format must be json or csv"), { statusCode: 400 });
  }

  const safeSql = validateAnalyticsQuery(query);
  const { usage, quota } = reserveQuery(clientId, tier);
  const client = await analyticsPool.connect();
  const startedAt = Date.now();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '3000ms'");
    await client.query("SET LOCAL work_mem = '16MB'");
    await client.query("SET LOCAL default_transaction_read_only = on");
    const explain = await client.query(`EXPLAIN (FORMAT JSON) ${safeSql}`);
    const planCost = Number(explain.rows[0]?.["QUERY PLAN"]?.[0]?.Plan?.["Total Cost"]);
    if (!Number.isFinite(planCost) || planCost > MAX_EXPLAIN_COST) {
      throw Object.assign(new Error("Query plan exceeds the allowed cost"), { statusCode: 400 });
    }

    const result = await client.query(`SELECT * FROM (${safeSql}) AS analytics_result LIMIT ${ROW_LIMIT + 1}`);
    const durationMs = Date.now() - startedAt;
    usage.cpuMs += durationMs;
    if (usage.cpuMs > quota.cpuMs) {
      throw Object.assign(new Error("Daily analytics CPU quota exceeded"), { statusCode: 429 });
    }
    await client.query("COMMIT");
    return {
      rows: result.rows.slice(0, ROW_LIMIT),
      row_count: Math.min(result.rowCount, ROW_LIMIT),
      truncated: result.rowCount > ROW_LIMIT,
      duration_ms: durationMs,
      plan_cost: planCost,
      format,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function toCsv(rows) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const encode = (value) => {
    const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((record) => record.map(encode).join(","))
    .join("\r\n");
}
