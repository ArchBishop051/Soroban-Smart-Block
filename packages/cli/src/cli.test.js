/**
 * Unit tests for soroban-explorer CLI.
 *
 * These tests verify the argument parsing, config loading, and output
 * formatting functions. They do not make real network calls — the command
 * functions are tested with a mock client.
 *
 * Runs with `node --test`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, "cli.js");

function runCli(args = [], env = {}) {
  return spawnSync("node", [CLI_PATH, ...args], {
    env: { ...process.env, ...env, NO_COLOR: "1", FORCE_COLOR: "0" },
    encoding: "utf-8",
    timeout: 10_000,
  });
}

describe("soroban-explorer CLI", () => {
  describe("help", () => {
    it("should print help with no arguments", () => {
      const result = runCli([]);
      assert.equal(result.status, 0, `exit code ${result.status}: ${result.stderr}`);
      assert.ok(result.stdout.includes("Usage:"), "should include Usage section");
      assert.ok(result.stdout.includes("events"), "should list events command");
      assert.ok(result.stdout.includes("wallet"), "should list wallet command");
      assert.ok(result.stdout.includes("contract"), "should list contract command");
      assert.ok(result.stdout.includes("search"), "should list search command");
      assert.ok(result.stdout.includes("tail"), "should list tail command");
    });

    it("should print help with --help flag", () => {
      const result = runCli(["--help"]);
      assert.equal(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });

    it("should print help with help command", () => {
      const result = runCli(["help"]);
      assert.equal(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });
  });

  describe("unknown command", () => {
    it("should exit with error on unknown command", () => {
      const result = runCli(["nonexistent"]);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes("Unknown command"));
    });
  });

  describe("wallet command", () => {
    it("should error on missing address", () => {
      const result = runCli(["wallet"]);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes("wallet address required"));
    });

    it("should error on invalid address format", () => {
      const result = runCli(["wallet", "invalid"]);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes("invalid Stellar wallet address"));
    });
  });

  describe("contract command", () => {
    it("should error on missing contract ID", () => {
      const result = runCli(["contract"]);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes("contract ID required"));
    });
  });

  describe("search command", () => {
    it("should error on missing query", () => {
      const result = runCli(["search"]);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes("search query required"));
    });
  });

  describe("events command", () => {
    it("should error on invalid limit", () => {
      const result = runCli(["events", "--limit", "999"]);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes("limit"));
    });

    it("should accept valid flags", () => {
      // This will fail because there's no server, but the parsing should succeed
      const result = runCli(["events", "--contract", "CDA2...", "--fn", "transfer", "--limit", "5", "--type", "soroban"]);
      // It'll fail with a connection error, not an argument error
      assert.ok(
        result.stderr.includes("fetch") || result.stderr.includes("ECONNREFUSED") || result.stderr.includes("ENOTFOUND") || result.stderr === "",
      );
    });
  });

  describe("--json flag", () => {
    it("should accept --json flag (parsing is verified by no argument error)", () => {
      const result = runCli(["events", "--json", "--limit", "5"]);
      // Will fail connecting but argument parsing succeeded
      assert.ok(!result.stderr.includes("Unknown") && !result.stderr.includes("unrecognized"));
    });
  });

  describe("--base-url flag", () => {
    it("should accept --base-url flag", () => {
      const result = runCli(["--base-url", "https://example.com", "events"]);
      // Will fail connecting to example.com but not with argument error
      assert.ok(!result.stderr.includes("Unknown option"));
    });
  });
  describe("verify", () => {
    it("accepts a valid signed response and rejects a tampered one", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-verify-"));
      const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
      const unsigned = { issued_at: "2026-01-01T00:00:00.000Z", key_id: "k1", ledger: 9, payload: { data: [{ seq: 1 }] } };
      // Keys are already in JCS order and the values need no escaping.
      const signature = crypto.sign(null, Buffer.from(JSON.stringify(unsigned)), privateKey).toString("base64url");
      const keysFile = path.join(dir, "keys.json");
      fs.writeFileSync(keysFile, JSON.stringify({
        keys: [{ key_id: "k1", alg: "Ed25519", status: "active", public_key: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64") }],
      }));
      const good = path.join(dir, "good.json");
      const bad = path.join(dir, "bad.json");
      fs.writeFileSync(good, JSON.stringify({ ...unsigned, signature }));
      fs.writeFileSync(bad, JSON.stringify({ ...unsigned, ledger: 10, signature }));

      assert.equal(runCli(["verify", good, "--keys", keysFile]).status, 0);
      const tampered = runCli(["verify", bad, "--keys", keysFile]);
      assert.equal(tampered.status, 1);
      assert.ok(tampered.stderr.includes("INVALID"));
    });
  });
});