import { applyStateVersions, snapshotAt } from "../src/stateHistoryIndexer.js";

describe("contract state history", () => {
  test("returns the value valid at a requested ledger", () => {
    const history = applyStateVersions([], [
      { contract_id: "C1", key_xdr: "k", ledger_from: 10, ledger_to: null, value_xdr: "a", change_type: "created", tx_index: 0 },
      { contract_id: "C1", key_xdr: "k", ledger_from: 20, ledger_to: null, value_xdr: "b", change_type: "updated", tx_index: 0 },
    ]);
    expect(snapshotAt(history, "C1", 15)[0].value_xdr).toBe("a");
    expect(snapshotAt(history, "C1", 20)[0].value_xdr).toBe("b");
  });
});
