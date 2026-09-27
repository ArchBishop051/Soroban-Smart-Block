/**
 * `soroban-explorer tui` entry point (#947).
 *
 *   soroban-explorer tui [--contract <id>] [--filter "<dsl>"] [--profile <name>] [--no-color]
 *
 * Profiles live in ~/.soroban-explorer.json:
 *   { "profiles": { "testnet": { "baseUrl": "https://…", "apiKey": "…" }, "local": { "baseUrl": "http://localhost:3001" } } }
 */
import fs from "fs/promises";
import path from "path";
import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import { EventStore } from "./store.js";
import { connectStream, fetchSince } from "./stream.js";

/** Resolve baseUrl/apiKey from --profile, falling back to the CLI's globals. */
export function resolveProfile(config, flags, defaults) {
  const name = flags.profile ?? config.defaultProfile;
  if (!name) return defaults;
  const profile = config.profiles?.[name];
  if (!profile) throw new Error(`Unknown profile "${name}" (define it under "profiles" in ~/.soroban-explorer.json)`);
  return { baseUrl: flags.baseUrl ?? profile.baseUrl ?? defaults.baseUrl, apiKey: flags.apiKey ?? profile.apiKey ?? defaults.apiKey };
}

export async function exportNdjson(events, dir = process.cwd()) {
  const file = path.join(dir, `soroban-events-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`);
  await fs.writeFile(file, events.map((ev) => JSON.stringify(ev)).join("\n") + (events.length ? "\n" : ""));
  return file;
}

export async function runTui({ baseUrl, apiKey, flags, config }) {
  if (!process.stdin.isTTY) throw new Error("tui requires an interactive terminal (use `tail` or `events --json` when piping)");
  const conn = resolveProfile(config, flags, { baseUrl, apiKey });
  const color = !flags.noColor && !process.env.NO_COLOR && process.stdout.hasColors?.() !== false;
  const store = new EventStore();
  const statusRef = { current: null };
  const setStatus = (s) => statusRef.current?.(s);

  // Seed with recent history so the screen is not empty on start.
  fetchSince({ ...conn, contract: flags.contract, lastSeq: 0 })
    .then((events) => store.add(events.slice(-500)))
    .catch((err) => setStatus(`initial load failed: ${err.message}`));

  const stream = connectStream({ ...conn, contract: flags.contract, onEvents: (evs) => store.add(evs), onStatus: setStatus });
  const app = render(
    React.createElement(App, { store, exportView: exportNdjson, initialFilter: flags.filter ?? "", status: `connecting to ${conn.baseUrl}`, color, statusRef }),
  );
  await app.waitUntilExit();
  stream.close();
  store.dispose();
}
