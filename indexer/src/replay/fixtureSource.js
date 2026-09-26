import fs from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./canonical.js";

export async function loadFixtures(directory, from, to) {
  const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const records = [];
  for (const name of names) {
    const value = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
    const ledger = Number(value.ledger ?? value.ledger_sequence);
    if (Number.isFinite(ledger) && (ledger < from || ledger > to)) continue;
    records.push(value);
  }
  return records;
}

export async function recordFixture(directory, ledger, payload) {
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, `ledger-${String(ledger).padStart(12, "0")}.json`);
  await fs.writeFile(filename, `${canonicalJson(payload)}\n`, "utf8");
  return filename;
}
