import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeOpenZeppelinEvent, expandConsecutiveMint } from "../src/decoders/openzeppelin/index.js";

const A = "G" + "A".repeat(55);
const B = "G" + "B".repeat(55);
const C = "C" + "C".repeat(55);

test("Ownable, AccessControl and Pausable events decode with full shape", () => {
  assert.equal(decodeOpenZeppelinEvent(["ownership_transfer"], { old_owner: A, new_owner: B, live_until_ledger: 500 }).module, "ownable");
  assert.deepEqual(decodeOpenZeppelinEvent(["ownership_transfer_completed"], { new_owner: B }).role, { role: "owner", address: B, revoked: false });
  const granted = decodeOpenZeppelinEvent(["role_granted", "minter", A], { caller: B });
  assert.deepEqual(granted.role, { role: "minter", address: A, revoked: false });
  assert.equal(decodeOpenZeppelinEvent(["role_revoked", "minter", A], { caller: B }).role.revoked, true);
  assert.deepEqual(decodeOpenZeppelinEvent(["paused"], { caller: C }).pause, { paused: true });
  assert.deepEqual(decodeOpenZeppelinEvent(["unpaused"], { caller: C }).pause, { paused: false });
});

test("look-alike events from non-OZ contracts are not claimed", () => {
  assert.equal(decodeOpenZeppelinEvent(["paused"], null), null);
  assert.equal(decodeOpenZeppelinEvent(["paused"], { caller: C, reason: "x" }), null);
  assert.equal(decodeOpenZeppelinEvent(["role_granted", "minter"], { caller: B }), null);
  assert.equal(decodeOpenZeppelinEvent(["transfer", A, B], 100n), null); // SEP-41 amount: generic decoder
});

test("NFT events feed the gallery and consecutive mints expand, bounded", () => {
  assert.equal(decodeOpenZeppelinEvent(["mint", A], 7).function, "mint_nft");
  assert.deepEqual(decodeOpenZeppelinEvent(["transfer", A, B], 7).nft.tokenIds, [7]);
  const range = decodeOpenZeppelinEvent(["consecutive_mint", A], { from_token_id: 10, to_token_id: 14 });
  assert.equal(range.function, "mint_nft");
  assert.deepEqual(range.nft.tokenIds, [10, 11, 12, 13, 14]);
  assert.equal(expandConsecutiveMint(0, 1_000_000).length, 1_000);
  assert.deepEqual(expandConsecutiveMint(5, 4), []);
});
