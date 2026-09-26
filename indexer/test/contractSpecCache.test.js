import { test } from "node:test";
import assert from "node:assert/strict";
import { xdr } from "@stellar/stellar-sdk";
import { specFromWasm, nameArgs, SAC_SPEC, primeSpec, getCachedSpec, invalidateContract, contractErrorName } from "../src/contractSpecCache.js";

const leb = (n) => {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
};

/** Minimal WASM with a contractspecv0 custom section holding `entries`. */
function wasmWithSpec(entries) {
  const payload = Buffer.concat(entries.map((e) => e.toXDR()));
  const name = Buffer.from("contractspecv0");
  const body = Buffer.concat([leb(name.length), name, payload]);
  return Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0]), Buffer.from([0]), leb(body.length), body]);
}

const fnEntry = (name, inputs) =>
  xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc: "",
      name,
      inputs: inputs.map(([n, t]) => new xdr.ScSpecFunctionInputV0({ doc: "", name: n, type: t })),
      outputs: [],
    }),
  );
const errEntry = xdr.ScSpecEntry.scSpecEntryUdtErrorEnumV0(
  new xdr.ScSpecUdtErrorEnumV0({
    doc: "",
    lib: "",
    name: "Error",
    cases: [new xdr.ScSpecUdtErrorEnumCaseV0({ doc: "", name: "InsufficientBalance", value: 3 })],
  }),
);

test("extracts named functions and error codes from contractspecv0", () => {
  const spec = specFromWasm(
    wasmWithSpec([fnEntry("deposit", [["user", xdr.ScSpecTypeDef.scSpecTypeAddress()], ["amount", xdr.ScSpecTypeDef.scSpecTypeI128()]]), errEntry]),
  );
  assert.equal(spec.functions[0].name, "deposit");
  assert.deepEqual(spec.functions[0].inputs.map((i) => i.name), ["user", "amount"]);
  assert.equal(spec.errors.get(3), "InsufficientBalance");
});

test("arguments are named when they match the spec, else flagged", () => {
  const spec = { functions: [{ name: "deposit", inputs: [{ name: "user" }, { name: "amount" }] }] };
  assert.deepEqual(nameArgs(spec, "deposit", ["GA", "100"]), { source: "spec", args: { user: "GA", amount: "100" } });
  assert.equal(nameArgs(spec, "deposit", ["GA"]).source, "spec_mismatch");
  assert.equal(nameArgs(spec, "withdraw", []).source, "spec_mismatch");
});

test("SAC events decode with the built-in spec", () => {
  assert.equal(nameArgs(SAC_SPEC, "transfer", ["GA", "GB", "USDC:G…", "100"]).args.amount, "100");
});

test("hostile or missing specs are treated as absent", () => {
  assert.equal(specFromWasm(Buffer.from("not wasm")), null);
  const huge = wasmWithSpec(Array.from({ length: 3000 }, (_, i) => fnEntry(`f${i}`, [])));
  assert.equal(specFromWasm(huge), null);
});

test("cache is keyed by WASM hash and invalidated on upgrade", () => {
  const spec = { functions: [], types: [], errors: new Map([[1, "Paused"]]) };
  primeSpec("CA", "aa", spec);
  primeSpec("CB", "aa", spec);
  assert.equal(getCachedSpec("CB"), spec);
  assert.equal(contractErrorName("CA", 1), "Paused");
  invalidateContract("CA");
  assert.equal(getCachedSpec("CA"), null);
  assert.equal(getCachedSpec("CB"), spec);
});
