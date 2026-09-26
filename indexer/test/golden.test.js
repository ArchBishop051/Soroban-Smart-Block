import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { currentOutputs, compareWithSnapshots, SNAPSHOT_PATH } from "./golden/goldenCheck.js";
import { decoderStatus, decoderTag } from "../src/decoderVersions.js";

test("decoder output matches golden snapshots for the declared versions", () => {
  const problems = compareWithSnapshots(currentOutputs(), JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")));
  assert.deepEqual(problems, []);
});

test("changing output without a version bump is rejected", () => {
  const current = currentOutputs();
  const tampered = { ...current, openzeppelin: { ...current.openzeppelin, hash: "0".repeat(64) } };
  assert.match(compareWithSnapshots(current, tampered)[0], /bump it/);
  const bumped = { ...current, openzeppelin: { ...current.openzeppelin, hash: "0".repeat(64), version: "0.9.0" } };
  assert.match(compareWithSnapshots(current, bumped)[0], /update snapshots/);
});

test("decoder tags classify rows for re-decode", () => {
  assert.equal(decoderStatus(decoderTag("abi")), "current");
  assert.equal(decoderStatus("abi@0.1.0"), "outdated");
  assert.equal(decoderStatus("removed-decoder@1.0.0"), "retired");
  assert.equal(decoderStatus(null), "untagged");
});
