// Parity tests for the in-browser Soroban host (#925): each invocation is run
// through Soroban RPC simulation and through packages/sandbox-host (loaded
// from its nodejs build) against the state imported from the RPC footprint.
// Return values and contract events must match exactly.
//
// Prereq: packages/sandbox-host/build.sh nodejs
// Run:    RPC_URL=https://soroban-testnet.stellar.org npm run test:parity
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  SorobanRpc,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

const require = createRequire(import.meta.url);
const hostPkg = require("../../../packages/sandbox-host/parity/pkg/soroban_sandbox_host.js");

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const server = new SorobanRpc.Server(RPC_URL);
const XLM = Asset.native().contractId(PASSPHRASE);

const holders = [
  "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR", // testnet friendbot
  ...Array.from({ length: 6 }, () => Keypair.random().publicKey()), // unfunded → identical errors
];
const addr = (a) => new Address(a).toScVal();

const CASES = [
  ["decimals", []],
  ["name", []],
  ["symbol", []],
  ...holders.map((h) => ["balance", [addr(h)]]),
  ...holders.map((h) => ["authorized", [addr(h)]]),
  ...holders.slice(0, 4).map((h) => ["allowance", [addr(h), addr(holders[0])]]),
  ["balance", [addr(XLM)]],
  ["transfer", [addr(holders[0]), addr(holders[1]), nativeToScVal(1n, { type: "i128" })]],
];

function contractEvents(diagnostics) {
  return (diagnostics ?? [])
    .filter((d) => d.inSuccessfulContractCall() && d.event().type().name === "contract")
    .map((d) => d.event().toXDR("base64"));
}

test(`parity cases (${CASES.length}) cover at least 20 invocations`, () => {
  assert.ok(CASES.length >= 20);
});

for (const [fn, args] of CASES) {
  test(`parity: ${fn}(${args.length} args)`, async () => {
    const source = new Account(holders[0], "0");
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(Operation.invokeContractFunction({ contract: XLM, function: fn, args }))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    const rpcOk = !SorobanRpc.Api.isSimulationError(sim);

    const host = new hostPkg.SandboxHost();
    host.setSourceAccount(Keypair.fromPublicKey(holders[0]).xdrAccountId().toXDR("base64"));
    const latest = await server.getLatestLedger();
    host.setLedgerInfo(latest.protocolVersion, latest.sequence, BigInt(Math.floor(Date.now() / 1000)), PASSPHRASE);

    if (rpcOk) {
      const fp = sim.transactionData.build().resources().footprint();
      const keys = [...fp.readOnly(), ...fp.readWrite()];
      if (keys.length) {
        const { entries } = await server.getLedgerEntries(...keys);
        for (const e of entries) {
          const entry = new xdr.LedgerEntry({ lastModifiedLedgerSeq: e.lastModifiedLedgerSeq ?? 0, data: e.val, ext: new xdr.LedgerEntryExt(0) });
          host.setLedgerEntry(e.key.toXDR("base64"), entry.toXDR("base64"), e.liveUntilLedgerSeq ?? undefined);
        }
      }
    }

    const hostFn = xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({ contractAddress: new Address(XLM).toScAddress(), functionName: fn, args }),
    );
    const local = JSON.parse(host.invoke(hostFn.toXDR("base64"), false));

    assert.equal(local.error == null, rpcOk, `success mismatch: rpc=${rpcOk} local=${local.error}`);
    if (rpcOk) {
      assert.equal(local.result, sim.result.retval.toXDR("base64"), "return value mismatch");
      assert.deepEqual(local.events, contractEvents(sim.events), "contract events mismatch");
    }
  });
}
