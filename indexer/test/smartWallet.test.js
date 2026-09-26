import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSmartWalletEvent, deriveWalletState, classifyCredentialSignature, isSmartWalletAbi } from "../src/smartWallet.js";

test("detects smart wallets from the ABI", () => {
  assert.equal(isSmartWalletAbi([{ name: "__check_auth" }, { name: "add_signer" }]), true);
  assert.equal(isSmartWalletAbi([{ name: "transfer" }, { name: "add_signer" }]), false);
});

test("decodes namespaced (passkey-kit style) signer events", () => {
  const added = decodeSmartWalletEvent(["sw_v1", "add_signer", "passkey-id-1"], ["Secp256r1", "passkey-id-1", { expiration: 500 }]);
  assert.equal(added.subject, "signer");
  assert.equal(added.action, "added");
  assert.equal(added.type, "secp256r1");
  assert.equal(added.expiration, 500);
  assert.equal(decodeSmartWalletEvent(["sw_v1", "remove_signer", "passkey-id-1"], null).action, "removed");
});

test("decodes plain-named signer and policy events", () => {
  assert.equal(decodeSmartWalletEvent(["signer_added", "GKEY"], { Ed25519: "GKEY" }).type, "ed25519");
  assert.equal(decodeSmartWalletEvent(["policy_added", "CPOLICY"], { limit: "100" }).subject, "policy");
  assert.equal(decodeSmartWalletEvent(["transfer", "GA", "GB"], "1"), null);
});

test("derives current state; a removed then re-added signer is active", () => {
  const events = [
    { subject: "signer", action: "added", key: "k1", type: "ed25519", expiration: null, ledger: 1 },
    { subject: "signer", action: "added", key: "k2", type: "secp256r1", expiration: 900, ledger: 2 },
    { subject: "signer", action: "removed", key: "k1", ledger: 3 },
    { subject: "signer", action: "added", key: "k1", type: "ed25519", expiration: null, ledger: 4 },
    { subject: "policy", action: "added", key: "p1", type: "policy", expiration: null, ledger: 5 },
  ];
  const state = deriveWalletState(events);
  assert.deepEqual(state.signers.map((s) => s.key).sort(), ["k1", "k2"]);
  assert.equal(state.signers.find((s) => s.key === "k1").since_ledger, 4);
  assert.equal(state.policies.length, 1);
});

test("classifies credential signatures without verifying them", () => {
  assert.equal(classifyCredentialSignature(Buffer.alloc(64)).type, "ed25519");
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", origin: "https://wallet.example", challenge: "abc" }));
  const webauthn = classifyCredentialSignature({ id: "pk1", authenticator_data: Buffer.alloc(37), client_data_json: clientData, signature: Buffer.alloc(64) });
  assert.equal(webauthn.type, "secp256r1");
  assert.deepEqual(webauthn.webauthn, { type: "webauthn.get", origin: "https://wallet.example", challenge: "abc" });
  assert.equal(classifyCredentialSignature([Buffer.alloc(64), Buffer.alloc(64)]).signers, 2);
});
