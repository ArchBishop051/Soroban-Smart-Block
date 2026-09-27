#!/usr/bin/env node

/**
 * Bundle Size Check Script
 * 
 * Compares bundle sizes against a baseline and posts a PR comment with the delta.
 * Fails the build if a chunk exceeds its budget.
 * 
 * Usage: node scripts/check-bundle-size.js [baseline-file]
 * 
 * If baseline-file is provided, compares against it (for PRs).
 * Otherwise, saves the current sizes as the new baseline (for main branch).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "..", "frontend", "dist");
const BASELINE_FILE = path.join(__dirname, "..", ".bundle-baseline.json");

// Bundle size budgets in KB
const BUDGETS = {
  // Main entry point - should be small
  "index-[hash].js": 150,
  // Vendor chunks - can be larger but should be monitored
  "react-vendor-[hash].js": 200,
  "query-vendor-[hash].js": 50,
  "stellar-vendor-[hash].js": 100,
  "monaco-vendor-[hash].js": 500,
  "viz-vendor-[hash].js": 300,
  "webcontainer-vendor-[hash].js": 200,
  // Route chunks - should be small due to code splitting
  "*-[hash].js": 100,
};

/**
 * Get all JS files in the dist directory with their sizes
 */
function getBundleSizes() {
  const assetsDir = path.join(DIST_DIR, "assets");
  if (!fs.existsSync(assetsDir)) {
    console.error(`Error: ${assetsDir} does not exist. Build the frontend first.`);
    process.exit(1);
  }

  const files = fs.readdirSync(assetsDir);
  const sizes = {};

  for (const file of files) {
    if (file.endsWith(".js")) {
      const filePath = path.join(assetsDir, file);
      const stats = fs.statSync(filePath);
      const sizeKb = stats.size / 1024;
      sizes[file] = Math.round(sizeKb * 100) / 100;
    }
  }

  return sizes;
}

/**
 * Match a file pattern to a budget key
 */
function matchBudgetKey(fileName) {
  // Try exact match first
  if (BUDGETS[fileName]) return fileName;

  // Try pattern match
  for (const key of Object.keys(BUDGETS)) {
    if (key.includes("*")) {
      const pattern = key.replace("*", ".*");
      const regex = new RegExp(`^${pattern}$`);
      if (regex.test(fileName)) return key;
    }
  }

  // Default to wildcard if exists
  if (BUDGETS["*-[hash].js"]) return "*-[hash].js";

  return null;
}

/**
 * Check if bundles exceed budgets
 */
function checkBudgets(sizes) {
  const violations = [];

  for (const [file, size] of Object.entries(sizes)) {
    const budgetKey = matchBudgetKey(file);
    if (!budgetKey) continue;

    const budget = BUDGETS[budgetKey];
    if (size > budget) {
      violations.push({
        file,
        size,
        budget,
        budgetKey,
        overage: size - budget,
      });
    }
  }

  return violations;
}

/**
 * Compare current sizes against baseline
 */
function compareWithBaseline(currentSizes, baselineSizes) {
  const deltas = {};

  for (const [file, currentSize] of Object.entries(currentSizes)) {
    const baselineSize = baselineSizes[file];
    if (baselineSize !== undefined) {
      const delta = currentSize - baselineSize;
      const deltaPercent = ((delta / baselineSize) * 100).toFixed(1);
      deltas[file] = {
        current: currentSize,
        baseline: baselineSize,
        delta,
        deltaPercent,
      };
    }
  }

  return deltas;
}

/**
 * Generate a PR comment with bundle size changes
 */
function generateComment(deltas, violations) {
  let comment = "## 📦 Bundle Size Report\n\n";

  if (Object.keys(deltas).length === 0) {
    comment += "No baseline comparison available.\n\n";
  } else {
    comment += "| File | Current (KB) | Baseline (KB) | Delta (KB) | Delta % |\n";
    comment += "|------|-------------|---------------|------------|---------|\n";

    const sortedDeltas = Object.entries(deltas).sort((a, b) => b[1].delta - a[1].delta);

    for (const [file, data] of sortedDeltas) {
      const deltaSign = data.delta >= 0 ? "+" : "";
      const deltaColor = data.delta > 10 ? "🔴" : data.delta > 0 ? "🟡" : "🟢";
      comment += `| ${file} | ${data.current} | ${data.baseline} | ${deltaSign}${data.delta.toFixed(2)} | ${deltaSign}${data.deltaPercent}% ${deltaColor} |\n`;
    }

    comment += "\n";
  }

  if (violations.length > 0) {
    comment += "### ⚠️ Budget Violations\n\n";
    comment += "| File | Size (KB) | Budget (KB) | Overage (KB) |\n";
    comment += "|------|-----------|-------------|-------------|\n";

    for (const violation of violations) {
      comment += `| ${violation.file} | ${violation.size} | ${violation.budget} | +${violation.overage.toFixed(2)} |\n`;
    }

    comment += "\n";
    comment += "**These chunks exceed their size budgets. Please optimize before merging.**\n";
  } else {
    comment += "### ✅ All chunks within budget\n\n";
  }

  return comment;
}

/**
 * Save current sizes as baseline
 */
function saveBaseline(sizes) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(sizes, null, 2));
  console.log(`Baseline saved to ${BASELINE_FILE}`);
}

/**
 * Load baseline sizes
 */
function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
}

/**
 * Post comment to PR (if running in CI)
 */
async function postPRComment(comment) {
  if (!process.env.GITHUB_EVENT_PATH) {
    console.log("Not running in GitHub Actions, skipping PR comment");
    return;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));

  if (!event.pull_request) {
    console.log("Not a PR, skipping comment");
    return;
  }

  const { owner, repo } = process.env;
  const prNumber = event.pull_request.number;
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    console.log("GITHUB_TOKEN not set, skipping comment");
    return;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: comment }),
    }
  );

  if (!response.ok) {
    console.error("Failed to post PR comment:", await response.text());
  } else {
    console.log("PR comment posted successfully");
  }
}

// Main execution
const currentSizes = getBundleSizes();
const violations = checkBudgets(currentSizes);

const baselineFile = process.argv[2];
if (baselineFile && fs.existsSync(baselineFile)) {
  const baselineSizes = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  const deltas = compareWithBaseline(currentSizes, baselineSizes);
  const comment = generateComment(deltas, violations);
  console.log(comment);
  await postPRComment(comment);
} else if (process.env.GITHUB_REF === "refs/heads/main") {
  // Save baseline on main branch
  saveBaseline(currentSizes);
} else {
  // Check against existing baseline for PRs
  const baselineSizes = loadBaseline();
  if (baselineSizes) {
    const deltas = compareWithBaseline(currentSizes, baselineSizes);
    const comment = generateComment(deltas, violations);
    console.log(comment);
    await postPRComment(comment);
  } else {
    console.log("No baseline found, skipping comparison");
  }
}

// Fail if there are budget violations
if (violations.length > 0) {
  console.error("\n❌ Bundle size budget violations detected!");
  process.exit(1);
}

console.log("\n✅ All bundle sizes within budget");
