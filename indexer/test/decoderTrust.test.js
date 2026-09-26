import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAbiEventShape } from "../src/decoder.js";

describe("ABI event trust gate", () => {
  const abi = {
    name: "transfer",
    params: [
      { name: "from", type: "Address" },
      { name: "amount", type: "i128" },
    ],
  };

  it("accepts an event whose arity and kinds match the ABI", () => {
    assert.deepEqual(validateAbiEventShape(abi, ["GABCDEF234567890", 12n]), {
      valid: true,
      warning: null,
    });
  });

  it("rejects a same-name event with an incompatible shape", () => {
    const result = validateAbiEventShape(abi, ["GABCDEF234567890"]);
    assert.equal(result.valid, false);
    assert.match(result.warning, /abi_arity_mismatch/);
  });
});