#!/usr/bin/env node
// Docs build step (#948): replaces snippet markers in Markdown with code taken
// from the example sources, so tutorials never drift from runnable code.
//
//   <!-- snippet: examples/tutorials/01-index-contract-events/index.mjs#events -->
//
// `#region` is optional (whole file when omitted). Regions are delimited in the
// source by `// #region <name>` and `// #endregion <name>`.
//
//   node scripts/docs-snippets.mjs <markdown-dir> [--check]
//
// Rewrites files in place (run it on the assembled site copy), or with
// --check only validates. Exits non-zero if any snippet file/region is missing.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MARKER = /<!--\s*snippet:\s*([^#\s]+)(?:#([\w-]+))?\s*-->/g;
const LANG = { ".mjs": "js", ".js": "js", ".ts": "ts", ".rs": "rust", ".json": "json", ".sh": "bash" };

export function extract(file, region) {
  const abs = path.join(ROOT, file);
  if (!existsSync(abs)) throw new Error(`snippet file not found: ${file}`);
  const lines = readFileSync(abs, "utf8").split("\n");
  if (!region) return lines.join("\n").trimEnd();
  const start = lines.findIndex((l) => l.trim() === `// #region ${region}`);
  const end = lines.findIndex((l, i) => i > start && l.trim() === `// #endregion ${region}`);
  if (start < 0 || end < 0) throw new Error(`snippet region not found: ${file}#${region}`);
  return lines.slice(start + 1, end).join("\n");
}

const [dir, ...flags] = process.argv.slice(2);
if (!dir) {
  console.error("usage: docs-snippets.mjs <markdown-dir> [--check]");
  process.exit(2);
}
const check = flags.includes("--check");
const errors = [];
let count = 0;

for (const name of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
  const file = path.join(dir, name);
  const src = readFileSync(file, "utf8");
  const out = src.replace(MARKER, (marker, snippetFile, region) => {
    try {
      const code = extract(snippetFile, region);
      count++;
      return `${marker}\n\`\`\`${LANG[path.extname(snippetFile)] ?? ""}\n${code}\n\`\`\``;
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      return marker;
    }
  });
  if (!check && out !== src) writeFileSync(file, out);
}

if (errors.length) {
  for (const e of errors) console.error(`✘ ${e}`);
  process.exit(1);
}
console.log(`✔ ${count} snippet(s) ${check ? "validated" : "included"} in ${dir}`);
