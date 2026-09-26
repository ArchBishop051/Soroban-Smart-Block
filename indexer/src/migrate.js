import { logger } from "./logger.js";
/**
 * Zero-downtime migration runner.
 *
 * Future schema changes should follow the phased pattern below:
 *
 *   -- MIGRATION PHASE: add-column
 *   ALTER TABLE events ADD COLUMN IF NOT EXISTS new_col TEXT;
 *
 *   -- MIGRATION PHASE: backfill
 *   UPDATE events SET new_col = '...' WHERE new_col IS NULL;
 *
 *   -- MIGRATION PHASE: finalize
 *   ALTER TABLE events ALTER COLUMN new_col SET DEFAULT '...';
 *
 * This prevents long lock windows on hot tables by keeping each phase small,
 * marking online-safe DDL separately from row updates, and avoiding a single
 * giant ALTER TABLE / CREATE INDEX transaction for production data sets.
 */
import { readdir, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

// `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block (and
// Postgres rejects it if it isn't the sole statement in its query message —
// the simple query protocol treats multiple ;-separated statements as one
// implicit transaction). Migrations that use it are split into individual
// statements and run outside BEGIN/COMMIT, each as its own query.
const CONCURRENTLY_RE = /\bCONCURRENTLY\b/i;
const PHASE_RE = /^\s*--\s*MIGRATION\s+PHASE\s*:\s*(.+?)\s*$/i;
const LOCKING_DDL_RE = /\b(ALTER\s+TABLE|CREATE\s+INDEX|DROP\s+INDEX|ALTER\s+TYPE|ALTER\s+COLUMN|CREATE\s+UNLOGGED\s+TABLE|DROP\s+COLUMN|RENAME\s+COLUMN)\b/i;

function stripComments(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

export function splitStatements(sql) {
  return stripComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseMigrationPlan(sql) {
  const lines = sql.split(/\r?\n/);
  const phases = [{ name: "default", mode: "transactional", statements: [] }];
  let current = phases[0];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const phaseMatch = line.match(PHASE_RE);
    if (phaseMatch) {
      const name = phaseMatch[1].trim();
      const next = { name, mode: /add-column|backfill|finalize|online/i.test(name) ? "online" : "transactional", statements: [] };
      phases.push(next);
      current = next;
      continue;
    }

    if (!line || line.startsWith("--")) continue;
    const statement = line.trim();
    if (!statement) continue;
    current.statements.push(statement);
  }

  const normalized = phases.filter((phase) => phase.statements.length > 0);
  if (!normalized.length) {
    return { phases: [{ name: "default", mode: "transactional", statements: splitStatements(sql) }], lockRisk: false };
  }

  for (const phase of normalized) {
    const statements = phase.statements.join(";").split(";").map((s) => s.trim()).filter(Boolean);
    phase.statements = statements;
    phase.lockRisk = statements.some((statement) => LOCKING_DDL_RE.test(statement) || CONCURRENTLY_RE.test(statement));
    if (phase.lockRisk && phase.mode !== "online") {
      phase.mode = "online";
    }
  }

  return { phases: normalized, lockRisk: normalized.some((phase) => phase.lockRisk) };
}

export async function executePhase(pool, phase, file) {
  const statements = phase.statements || [];
  if (!statements.length) return;

  if (phase.mode === "online") {
    for (const statement of statements) {
      await pool.query(statement);
    }
    logger.info(`[migrations] applied ${file} :: ${phase.name} (online)`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query("COMMIT");
    logger.info(`[migrations] applied ${file} :: ${phase.name}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`Migration ${file} phase ${phase.name} failed: ${err.message}`);
  } finally {
    client.release();
  }
}

/**
 * Run all pending migrations against the provided pg pool.
 * @param {import('pg').Pool} pool
 */
export async function runMigrations(pool) {
  // Ensure the tracking table exists (bootstraps itself on first run)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const { rows: applied } = await pool.query(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const appliedSet = new Set(applied.map((r) => r.version));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const plan = parseMigrationPlan(sql);

    if (plan.lockRisk || CONCURRENTLY_RE.test(sql)) {
      logger.warn(
        `[migrations] ${file} includes lock-prone DDL; running in phased, online-safe steps to reduce table locks`,
      );
    }

    try {
      for (const phase of plan.phases) {
        await executePhase(pool, phase, file);
      }
      await pool.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [file],
      );
      logger.info(`[migrations] applied ${file}`);
      ran++;
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }

  if (ran === 0) logger.info("[migrations] schema up to date");
  return ran;
}

// ── CLI entry point ───────────────────────────────────────────────────────────
// `node src/migrate.js` applies all pending migrations against DATABASE_URL and
// exits 0 on success / 1 on failure. Used by the CI migration check (see #425).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await runMigrations(pool);
    process.exitCode = 0;
  } catch (err) {
    logger.error(`[migrations] ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
