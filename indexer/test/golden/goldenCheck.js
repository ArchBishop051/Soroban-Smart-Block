/**
 * Golden snapshots for decoder output (#899).
 *
 * `node test/golden/goldenCheck.js --update` rewrites snapshots.json, but
 * refuses when a decoder's output changed while its version in
 * src/decoderVersions.js did not, so a behaviour change always comes with a
 * version bump (which triggers re-decoding of old rows).
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { decodeOpenZeppelinEvent } from "../../src/decoders/openzeppelin/index.js";
import { decodeSmartWalletEvent } from "../../src/smartWallet.js";
import { DECODER_VERSIONS } from "../../src/decoderVersions.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = path.join(DIR, "snapshots.json");
const DECODERS = { openzeppelin: decodeOpenZeppelinEvent, "smart-wallet": decodeSmartWalletEvent };

export function currentOutputs() {
  const fixtures = JSON.parse(fs.readFileSync(path.join(DIR, "fixtures.json"), "utf8"));
  return Object.fromEntries(
    Object.entries(DECODERS).map(([id, fn]) => {
      const outputs = fixtures[id].map((f) => fn(f.topics, f.data));
      const hash = crypto.createHash("sha256").update(JSON.stringify(outputs)).digest("hex");
      return [id, { version: DECODER_VERSIONS[id], hash, outputs }];
    }),
  );
}

/** Problems between current outputs and the stored snapshots. */
export function compareWithSnapshots(current, snapshots) {
  const problems = [];
  for (const [id, cur] of Object.entries(current)) {
    const snap = snapshots[id];
    if (!snap) {
      problems.push(`${id}: no snapshot (run: node test/golden/goldenCheck.js --update)`);
      continue;
    }
    if (snap.hash !== cur.hash && snap.version === cur.version) {
      problems.push(`${id}: output changed but version is still ${cur.version} — bump it in src/decoderVersions.js and update snapshots`);
    } else if (snap.hash !== cur.hash) {
      problems.push(`${id}: output changed (version ${snap.version} → ${cur.version}) — update snapshots`);
    } else if (snap.version !== cur.version) {
      problems.push(`${id}: version changed to ${cur.version} without an output change — update snapshots`);
    }
  }
  return problems;
}

if (process.argv.includes("--update")) {
  const current = currentOutputs();
  const previous = fs.existsSync(SNAPSHOT_PATH) ? JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) : {};
  const unbumped = Object.entries(current).filter(([id, c]) => previous[id] && previous[id].hash !== c.hash && previous[id].version === c.version);
  if (unbumped.length) {
    console.error(`Refusing to update: bump the version of ${unbumped.map(([id]) => id).join(", ")} first.`);
    process.exit(1);
  }
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + "\n");
  console.log(`Updated ${path.relative(process.cwd(), SNAPSHOT_PATH)}`);
}
