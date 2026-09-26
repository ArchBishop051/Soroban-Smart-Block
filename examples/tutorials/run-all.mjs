// Runs every tutorial marked `ci: true` in tutorials.json against the local
// stack and fails on a non-zero exit or any missing expected output line.
//   node run-all.mjs            # CI set
//   node run-all.mjs --all      # include tutorials that are still in progress
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const here = new URL(".", import.meta.url).pathname;
const tutorials = JSON.parse(readFileSync(`${here}tutorials.json`, "utf8"));
const all = process.argv.includes("--all");
let failed = 0;

for (const t of tutorials) {
  if (!t.ci && !all) {
    console.log(`- ${t.dir}: excluded from CI (${t.reason})`);
    continue;
  }
  const started = Date.now();
  const run = spawnSync(process.execPath, [`${here}${t.dir}/index.mjs`], {
    encoding: "utf8",
    env: { ...process.env, ...t.env },
    timeout: 60_000,
  });
  const missing = t.expect.filter((re) => !new RegExp(re).test(run.stdout));
  const ok = run.status === 0 && missing.length === 0;
  console.log(`${ok ? "✔" : "✘"} ${t.dir} (${Date.now() - started}ms)`);
  if (!ok) {
    failed++;
    process.stdout.write(run.stdout);
    process.stderr.write(run.stderr);
    for (const re of missing) console.error(`  missing expected output: /${re}/`);
  }
}

if (failed) {
  console.error(`${failed} tutorial(s) failed`);
  process.exit(1);
}
