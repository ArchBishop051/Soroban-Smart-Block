#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const USAGE = "Usage: npm run backfill -- --from <ledger> --to <ledger> [--delay-ms <milliseconds>]";

export function parseBackfillArgs(args, defaultDelayMs = 250) {
  const options = { from: null, to: null, delayMs: defaultDelayMs };
  const names = { "--from": "from", "--to": "to", "--delay-ms": "delayMs" };

  for (let i = 0; i < args.length; i++) {
    const name = names[args[i]];
    const value = args[++i];
    if (!name || value === undefined || !/^\d+$/.test(value)) {
      throw new Error(USAGE);
    }
    options[name] = Number(value);
    if (!Number.isSafeInteger(options[name])) throw new Error(`Invalid ${args[i - 1]} value: ${value}`);
  }

  if (options.from === null || options.to === null || options.to < options.from) {
    throw new Error(USAGE);
  }
  if (!Number.isInteger(options.delayMs) || options.delayMs < 100) {
    throw new Error("--delay-ms must be an integer of at least 100");
  }
  return options;
}

export async function runBackfill(args, indexRange, defaultDelayMs = 250) {
  const options = parseBackfillArgs(args, defaultDelayMs);
  const result = await indexRange(options.from, {
    endLedger: options.to,
    pageDelayMs: options.delayMs,
    ignoreLeadership: true,
    suppressExternalEffects: true,
  });
  return { ...options, result };
}

async function main() {
  const [{ default: config }, { db, pool }, { indexLedger }] = await Promise.all([
    import("./config.js"),
    import("./db.js"),
    import("./index.js"),
  ]);
  const options = parseBackfillArgs(process.argv.slice(2), config.BACKFILL_PAGE_DELAY_MS);

  try {
    await db.init();
    console.info(`Backfilling ledgers ${options.from} through ${options.to}`);
    const result = await indexLedger(options.from, {
      endLedger: options.to,
      pageDelayMs: options.delayMs,
      ignoreLeadership: true,
      suppressExternalEffects: true,
    });
    console.info(`Backfill complete: ${options.from}-${options.to}, ${result.eventsProcessed} events processed`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Backfill failed: ${error.message}`);
    process.exitCode = 1;
  });
}
