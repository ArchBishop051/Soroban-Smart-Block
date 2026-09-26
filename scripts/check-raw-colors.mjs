#!/usr/bin/env node

/**
 * Raw Color Linting Gate
 * Scans stylesheets and components in frontend/src/ to ensure all colors
 * use semantic design tokens (var(--...)) instead of hardcoded hex/rgb/hsl values.
 *
 * Exemptions:
 * - frontend/src/styles/tokens.css (source of truth for tokens)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONTEND_SRC = path.resolve(__dirname, "../frontend/src");

// Files allowed to declare raw colors (the design token definitions)
const WHITELISTED_FILES = [
  path.resolve(FRONTEND_SRC, "styles/tokens.css"),
];

// Regex to detect hex colors (e.g. #fff, #1a2b3c, #1a2b3c4d)
// Note: We ignore comments and string fragments like Issue #123
const HEX_REGEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

// Regex to detect rgb(a) or hsl(a) functions
const FUNCTION_COLOR_REGEX = /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi;

function isWhitelisted(filePath) {
  const resolved = path.resolve(filePath);
  return WHITELISTED_FILES.some((w) => resolved === w);
}

function scanFile(filePath) {
  if (isWhitelisted(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations = [];

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    // Ignore single line comments
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      return;
    }

    // Check for raw hex colors (making sure it's not a URL hash or issue reference)
    // Matches like `#ffffff`, `#111827`, etc.
    const hexMatches = line.match(HEX_REGEX);
    if (hexMatches) {
      for (const hex of hexMatches) {
        // Skip issue references like #123, #540
        if (/^#\d+$/.test(hex)) continue;

        // Skip if inside a comment
        const commentIdx = line.indexOf("//");
        if (commentIdx !== -1 && line.indexOf(hex) > commentIdx) continue;

        violations.push({
          file: filePath,
          line: lineNum,
          value: hex,
          content: trimmed,
        });
      }
    }

    // Check for raw rgba(...) or hsla(...)
    const fnMatches = line.match(FUNCTION_COLOR_REGEX);
    if (fnMatches) {
      const commentIdx = line.indexOf("//");
      for (const fn of fnMatches) {
        if (commentIdx !== -1 && line.indexOf(fn) > commentIdx) continue;
        violations.push({
          file: filePath,
          line: lineNum,
          value: fn.trim(),
          content: trimmed,
        });
      }
    }
  });

  return violations;
}

function walkDir(dir, filterExts) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walkDir(fullPath, filterExts));
    } else if (entry.isFile() && filterExts.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }

  return results;
}

function main() {
  console.log("🎨 Scanning frontend/src/ for raw color violations...");

  // Scan all CSS files in frontend/src
  const cssFiles = walkDir(FRONTEND_SRC, [".css"]);
  let totalViolations = 0;
  let scannedFiles = 0;

  for (const file of cssFiles) {
    scannedFiles++;
    const violations = scanFile(file);
    if (violations.length > 0) {
      totalViolations += violations.length;
      const relPath = path.relative(path.resolve(__dirname, ".."), file);
      console.error(`\n❌ ${relPath}: ${violations.length} raw color violation(s) found:`);
      for (const v of violations) {
        console.error(`   Line ${v.line}: raw color "${v.value}"`);
        console.error(`   > ${v.content}`);
      }
    }
  }

  console.log(`\nScan complete: ${scannedFiles} stylesheet(s) inspected.`);

  if (totalViolations > 0) {
    console.error(
      `\n⚠️  Found ${totalViolations} raw color violation(s). Replace raw hex/rgb colors with design tokens in frontend/src/styles/tokens.css (e.g. var(--surface), var(--border), var(--text-primary), var(--accent)).`
    );
    process.exit(1);
  } else {
    console.log("✅ Zero raw color violations found! All stylesheets adhere to design tokens.\n");
    process.exit(0);
  }
}

main();
