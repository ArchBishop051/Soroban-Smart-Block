import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,

  // ── Application + test source (ESM) ────────────────────────────────────────
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // ── Test files: add the test-runner globals (jest + node:test share names) ──
  {
    files: ["test/**/*.js", "tests/**/*.js", "**/*.test.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },

  // ── CommonJS: legacy pg-migrate migrations and two optional CJS helpers ─────
  {
    files: [
      "migrations/**/*.js",
      "src/optional/eventInserter.js",
      "src/optional/rpcPool.js",
    ],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
    },
  },

  {
    ignores: ["node_modules/**", "coverage/**", "reports/**"],
  },
];
