import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import { sourceVerificationMessage, verifySourceVerification } from "../src/sourceVerification.js";

const wasm_hash = "a".repeat(64);
const compiler_hash = "b".repeat(64);

test("accepts a signature over the versioned artifact message", () => {
  const keypair = Keypair.random();
  const signature = keypair.sign(Buffer.from(sourceVerificationMessage(wasm_hash, compiler_hash))).toString("base64");

  assert.equal(verifySourceVerification({ wasm_hash, compiler_hash, signer: keypair.publicKey(), signature }), true);
});

test("rejects a signature for a different artifact", () => {
  const keypair = Keypair.random();
  const signature = keypair.sign(Buffer.from(sourceVerificationMessage(wasm_hash, compiler_hash))).toString("base64");

  assert.equal(
    verifySourceVerification({ wasm_hash: "c".repeat(64), compiler_hash, signer: keypair.publicKey(), signature }),
    false,
  );
});
