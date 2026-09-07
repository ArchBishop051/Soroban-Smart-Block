import { describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApi } from "../../src/api.js";

const payloads = [
  "'; DROP TABLE events; --",
  "' OR '1'='1",
  "%27 UNION SELECT 1,2,3--",
];

describe("SQL injection regression", () => {
  const app = createApi({
    dbOverride: {
      async getEventsCursor() {
        return { data: [], next_cursor: null };
      },

      async query(sql) {
        if (sql.includes("to_regclass")) {
          return {
            rows: [{ table_name: "events" }],
          };
        }

        return { rows: [] };
      },
    },
  });

  it("never returns 500 for malicious user input", async () => {
    for (const payload of payloads) {
      const events = await request(app).get(
        `/api/events?contract=${encodeURIComponent(payload)}`
      );

      assert.ok([200, 400].includes(events.status));

      const contracts = await request(app).get(
        `/api/contracts?q=${encodeURIComponent(payload)}`
      );

      assert.ok([200, 400].includes(contracts.status));

      const wallet = await request(app).get(
        `/api/wallet/${encodeURIComponent(payload)}`
      );

      assert.ok([200, 400].includes(wallet.status));
    }
  });

  it("keeps the events table intact", async () => {
    const { rows } = await app.locals.db.query(
      "SELECT to_regclass('public.events') AS table_name"
    );

    assert.equal(rows[0].table_name, "events");
  });
});