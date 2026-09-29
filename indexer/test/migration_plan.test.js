import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMigrationPlan } from "../src/migrate.js";

describe("migration plan", () => {
  it("converts multi-phase online-safe migrations into explicit steps", () => {
    const sql = `
      -- MIGRATION PHASE: add-column
      ALTER TABLE events ADD COLUMN IF NOT EXISTS new_col TEXT;

      -- MIGRATION PHASE: backfill
      UPDATE events SET new_col = 'v1' WHERE new_col IS NULL;

      -- MIGRATION PHASE: finalize
      ALTER TABLE events ALTER COLUMN new_col SET DEFAULT 'v1';
    `;

    const plan = parseMigrationPlan(sql);
    assert.equal(plan.phases.length, 3);
    assert.deepEqual(plan.phases.map((phase) => phase.name), ["add-column", "backfill", "finalize"]);
    assert.equal(plan.phases[0].mode, "online");
    assert.equal(plan.phases[1].mode, "transactional");
    assert.equal(plan.phases[2].mode, "online");
  });

  it("keeps lock-prone DDL out of a single giant transaction by default", () => {
    const sql = `
      ALTER TABLE events ADD COLUMN IF NOT EXISTS new_num INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_new_num ON events(new_num);
    `;

    const plan = parseMigrationPlan(sql);
    assert.equal(plan.lockRisk, true);
    assert.equal(plan.phases[0].mode, "online");
  });
});
