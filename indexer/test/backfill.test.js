import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseBackfillArgs, runBackfill } from "../src/backfill.js";

describe("backfill CLI", () => {
  it("parses an inclusive range and defaults the page delay", () => {
    assert.deepEqual(parseBackfillArgs(["--from", "100", "--to", "250"], 400), {
      from: 100,
      to: 250,
      delayMs: 400,
    });
  });

  it("rejects malformed, reversed, and unsafe ledger ranges", () => {
    assert.throws(() => parseBackfillArgs(["--from", "x", "--to", "5"]), /Usage:/);
    assert.throws(() => parseBackfillArgs(["--from", "8", "--to", "5"]), /Usage:/);
    assert.throws(
      () => parseBackfillArgs(["--from", "9007199254740992", "--to", "9007199254740993"]),
      /Invalid --from value/,
    );
  });

  it("requires at least 100ms between pages", () => {
    assert.throws(
      () => parseBackfillArgs(["--from", "1", "--to", "2", "--delay-ms", "99"]),
      /at least 100/,
    );
  });

  it("runs the requested range without updating daemon state or sending external effects", async () => {
    const indexRange = async () => ({ eventsProcessed: 3 });
    const result = await runBackfill(
      ["--from", "10", "--to", "20", "--delay-ms", "500"],
      indexRange,
    );

    assert.deepEqual(result, {
      from: 10,
      to: 20,
      delayMs: 500,
      result: { eventsProcessed: 3 },
    });

    const options = await runBackfill(["--from", "10", "--to", "20"], async (_from, opts) => opts);
    assert.deepEqual(options.result, {
      endLedger: 20,
      pageDelayMs: 250,
      ignoreLeadership: true,
      suppressExternalEffects: true,
    });
  });
});
