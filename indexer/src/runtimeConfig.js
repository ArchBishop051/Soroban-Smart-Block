import { logger } from "./logger.js";
/**
 * Hot-reloadable runtime configuration (#894).
 *
 * Boot-time settings (DB URL, ports, network) stay in config.js and need a
 * restart. Runtime settings — rate-limit overrides, feature flags and alert
 * thresholds — live in the versioned `runtime_config` table and change
 * without a restart:
 *
 *   - apply() validates, then inserts version N+1 only if the caller saw
 *     version N (optimistic concurrency), and NOTIFYs every instance.
 *   - Each instance LISTENs and reloads, so a change is live everywhere
 *     within about a second. If the DB is unavailable, the last-known-good
 *     config stays in effect.
 *   - Readers call get() on every use and never cache values, so nothing
 *     holds a stale setting. subscribe() lets components react to changes.
 *   - After a change, a guardrail watches the 5xx rate and indexer lag; if
 *     they degrade beyond the limits within the watch window, the previous
 *     version is re-applied automatically and an alert is raised.
 */

import { EventEmitter } from "events";
import { z } from "zod";

export const CHANNEL = "runtime_config";

const rpm = z.number().int().positive().max(1_000_000);
export const runtimeConfigSchema = z
  .object({
    // { [endpointGroup]: { [tier]: rpm } }
    rateLimitOverrides: z.record(z.string(), z.record(z.string(), rpm)).default({}),
    featureFlags: z.record(z.string(), z.boolean()).default({}),
    alertThresholds: z
      .object({
        ledgerGap: z.number().int().positive().optional(),
        dlqSize: z.number().int().positive().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export const DEFAULT_RUNTIME_CONFIG = runtimeConfigSchema.parse({});

export class RuntimeConfigError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Validate a candidate config; throws RuntimeConfigError with readable issues. */
export function validateRuntimeConfig(candidate) {
  const result = runtimeConfigSchema.safeParse(candidate);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new RuntimeConfigError(`Invalid runtime config — ${issues.join("; ")}`);
  }
  return result.data;
}

const bus = new EventEmitter();
let current = { version: 0, config: DEFAULT_RUNTIME_CONFIG, author: null, comment: null };

/** Read a top-level runtime setting (always the live value). */
export function get(key) {
  return current.config[key];
}

export function getCurrent() {
  return current;
}

/** Call `listener(next, previous)` on every change; returns an unsubscribe function. */
export function subscribe(listener) {
  bus.on("change", listener);
  return () => bus.off("change", listener);
}

/** Replace the in-memory config (from a DB row); invalid rows are ignored. */
export function setCurrent(row) {
  if (!row || row.version === current.version) return false;
  let config;
  try {
    config = validateRuntimeConfig(row.config);
  } catch (err) {
    logger.error(`[runtimeConfig] ignoring invalid stored version ${row.version}: ${err.message}`);
    return false;
  }
  const previous = current;
  current = { version: Number(row.version), config, author: row.author ?? null, comment: row.comment ?? null };
  bus.emit("change", current, previous);
  return true;
}

// ── Persistence ──────────────────────────────────────────────────────────────

/** Latest stored version, or null. Errors propagate so callers keep last-known-good. */
export async function loadLatest(pool) {
  const { rows } = await pool.query(
    "SELECT version, config, author, comment, created_at FROM runtime_config ORDER BY version DESC LIMIT 1",
  );
  return rows[0] ?? null;
}

export async function listHistory(pool, limit = 50) {
  const { rows } = await pool.query(
    "SELECT version, config, author, comment, created_at FROM runtime_config ORDER BY version DESC LIMIT $1",
    [limit],
  );
  return rows;
}

/**
 * Validate and store a new version. Fails with 409 if another change landed
 * after `expectedVersion` was read.
 */
export async function apply(pool, { config, expectedVersion, author, comment }) {
  const valid = validateRuntimeConfig(config);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE runtime_config IN SHARE ROW EXCLUSIVE MODE");
    const { rows } = await client.query("SELECT COALESCE(MAX(version), 0)::INT AS version FROM runtime_config");
    if (rows[0].version !== Number(expectedVersion)) {
      throw new RuntimeConfigError(
        `Config changed since you loaded it (now version ${rows[0].version}, you had ${expectedVersion}); reload and retry`,
        409,
      );
    }
    const version = rows[0].version + 1;
    const { rows: inserted } = await client.query(
      `INSERT INTO runtime_config (version, config, author, comment) VALUES ($1, $2, $3, $4)
       RETURNING version, config, author, comment, created_at`,
      [version, JSON.stringify(valid), author ?? null, comment ?? null],
    );
    await client.query(`NOTIFY ${CHANNEL}, '${version}'`);
    await client.query("COMMIT");
    setCurrent(inserted[0]);
    return inserted[0];
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Re-apply an earlier version's config as a new version. */
export async function revertTo(pool, targetVersion, { author, comment } = {}) {
  const { rows } = await pool.query("SELECT config FROM runtime_config WHERE version = $1", [targetVersion]);
  if (!rows[0]) throw new RuntimeConfigError(`Version ${targetVersion} not found`, 404);
  return apply(pool, {
    config: rows[0].config,
    expectedVersion: current.version,
    author,
    comment: comment ?? `revert to version ${targetVersion}`,
  });
}

/**
 * Load the latest config and LISTEN for changes from other instances.
 * On DB errors the last-known-good (or default) config stays in effect.
 */
export async function initRuntimeConfig(pool) {
  try {
    setCurrent(await loadLatest(pool));
  } catch (err) {
    logger.warn(`[runtimeConfig] could not load (keeping last-known-good): ${err.message}`);
  }
  try {
    const client = await pool.connect();
    client.on("notification", (msg) => {
      if (msg.channel !== CHANNEL) return;
      loadLatest(pool)
        .then(setCurrent)
        .catch((err) => logger.warn(`[runtimeConfig] reload failed (keeping version ${current.version}): ${err.message}`));
    });
    client.on("error", (err) => logger.warn(`[runtimeConfig] listener error: ${err.message}`));
    await client.query(`LISTEN ${CHANNEL}`);
  } catch (err) {
    logger.warn(`[runtimeConfig] LISTEN unavailable, changes need a reload: ${err.message}`);
  }
}

// ── Guardrail ────────────────────────────────────────────────────────────────

/**
 * Watch health after a change and revert if it degrades.
 *
 * @param {object} opts
 * @param {() => Promise<{ errorRate: number, lagLedgers: number }>} opts.sample
 * @param {() => Promise<void>} opts.revert       re-applies the previous version
 * @param {(message: string) => Promise<void>} [opts.alert]
 * @param {{ errorRate: number, lagLedgers: number }} opts.baseline  health before the change
 * @param {number} [opts.windowMs]   how long to watch (default 5 min)
 * @param {number} [opts.intervalMs] sampling interval (default 10 s)
 * @returns {Promise<"kept" | "reverted">}
 */
export async function watchGuardrail({ sample, revert, alert = async () => {}, baseline, windowMs = 300_000, intervalMs = 10_000 }) {
  const maxErrorRate = Math.max(0.05, baseline.errorRate * 2);
  const maxLag = baseline.lagLedgers + 10;
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const now = await sample().catch(() => null);
    if (!now) continue;
    if (now.errorRate > maxErrorRate || now.lagLedgers > maxLag) {
      await revert();
      await alert(
        `Runtime config change reverted: error rate ${(now.errorRate * 100).toFixed(1)}% (limit ${(maxErrorRate * 100).toFixed(1)}%), lag ${now.lagLedgers} ledgers (limit ${maxLag})`,
      );
      return "reverted";
    }
  }
  return "kept";
}

/**
 * Health sampler for the guardrail from the Prometheus registry: 5xx share
 * of API requests since the previous sample, and current indexer lag.
 */
export function createHealthSampler(registry) {
  let prev = null;
  return async () => {
    const hist = registry.getSingleMetric("api_request_duration_seconds");
    const lagGauge = registry.getSingleMetric("soroban_indexer_lag_ledgers");
    const counts = hist ? (await hist.get()).values.filter((v) => String(v.metricName ?? "").endsWith("_count")) : [];
    let total = 0;
    let errors = 0;
    for (const v of counts) {
      total += v.value;
      if (Number(v.labels?.status) >= 500) errors += v.value;
    }
    const lagLedgers = lagGauge ? ((await lagGauge.get()).values[0]?.value ?? 0) : 0;
    const delta = prev ? { total: total - prev.total, errors: errors - prev.errors } : { total: 0, errors: 0 };
    prev = { total, errors };
    return { errorRate: delta.total > 0 ? delta.errors / delta.total : 0, lagLedgers };
  };
}
