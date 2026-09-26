import { Client } from 'pg';
import fs from 'fs/promises';
import path from 'path';

const PHASE_RE = /^\s*--\s*MIGRATION\s+PHASE\s*:\s*(.+?)\s*$/i;
const LOCKING_DDL_RE = /\b(ALTER\s+TABLE|CREATE\s+INDEX|DROP\s+INDEX|ALTER\s+TYPE|ALTER\s+COLUMN|DROP\s+COLUMN|RENAME\s+COLUMN)\b/i;

function splitStatements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function buildMigrationPlan(sql: string) {
  const lines = sql.split(/\r?\n/);
  const phases: { name: string; mode: 'transactional' | 'online'; statements: string[] }[] = [{ name: 'default', mode: 'transactional', statements: [] }];
  let current = phases[0];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const phaseMatch = line.match(PHASE_RE);
    if (phaseMatch) {
      const name = phaseMatch[1].trim();
      const next = { name, mode: /add-column|backfill|finalize|online/i.test(name) ? 'online' : 'transactional', statements: [] as string[] };
      phases.push(next);
      current = next;
      continue;
    }
    if (!line || line.startsWith('--')) continue;
    current.statements.push(line);
  }

  const normalized = phases.filter((phase) => phase.statements.length > 0);
  return normalized.map((phase) => {
    const statements = splitStatements(phase.statements.join('\n'));
    const lockRisk = statements.some((statement) => LOCKING_DDL_RE.test(statement) || /CONCURRENTLY/i.test(statement));
    return { ...phase, statements, mode: lockRisk ? 'online' : phase.mode, lockRisk };
  });
}

async function executePhase(dbClient: Client, phase: { name: string; mode: 'transactional' | 'online'; statements: string[] }, file: string) {
  if (!phase.statements.length) return;

  if (phase.mode === 'online') {
    for (const statement of phase.statements) {
      await dbClient.query(statement);
    }
    console.log(`Completed ${file} :: ${phase.name} (online)`);
    return;
  }

  await dbClient.query('BEGIN');
  try {
    for (const statement of phase.statements) {
      await dbClient.query(statement);
    }
    await dbClient.query('COMMIT');
    console.log(`Completed ${file} :: ${phase.name}`);
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw new Error(`Migration ${file} phase ${phase.name} failed: ${(err as Error).message}`);
  }
}

/**
 * Migration orchestrator for zero-downtime expand-migrate-contract schema changes.
 * Supports running migrations, dry-runs, and generating PR schema diffs.
 */
export class MigrationOrchestrator {
  constructor(private dbClient: Client) {}

  async initialize() {
    await this.dbClient.query(`
      CREATE TABLE IF NOT EXISTS migration_log (
        id SERIAL PRIMARY KEY,
        migration_version VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        duration_ms INTEGER,
        is_destructive BOOLEAN DEFAULT FALSE
      )
    `);
  }

  async runMigrations(directory: string, dryRun: boolean = false) {
    await this.initialize();

    // Advisory lock to prevent concurrent migration runs
    await this.dbClient.query('SELECT pg_advisory_lock(987654321)');

    try {
      const files = await fs.readdir(directory);
      const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

      for (const file of sqlFiles) {
        const content = await fs.readFile(path.join(directory, file), 'utf8');
        const versionMatch = file.match(/^V(\d+)__/);
        if (!versionMatch) continue;

        const version = versionMatch[1];
        const isExecuted = await this.dbClient.query(
          'SELECT 1 FROM migration_log WHERE migration_version = $1',
          [version],
        );

        if (isExecuted.rowCount > 0) continue;

        console.log(`Running migration: ${file}`);

        const isDestructive = content.toUpperCase().includes('DROP COLUMN') || content.toUpperCase().includes('DROP TABLE');
        const start = Date.now();

        if (!dryRun) {
          const plan = buildMigrationPlan(content);
          for (const phase of plan) {
            await executePhase(this.dbClient, phase, file);
          }

          const duration = Date.now() - start;
          await this.dbClient.query(
            'INSERT INTO migration_log (migration_version, description, duration_ms, is_destructive) VALUES ($1, $2, $3, $4)',
            [version, file, duration, isDestructive],
          );
          console.log(`Successfully completed ${file} in ${duration}ms`);
        }
      }
    } finally {
      await this.dbClient.query('SELECT pg_advisory_unlock(987654321)');
    }
  }
}
