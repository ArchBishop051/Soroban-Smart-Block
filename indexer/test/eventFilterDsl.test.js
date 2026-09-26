import { describe, it } from "node:test";
import assert from "node:assert";
import {
  validateFilter,
  filterToSql,
  estimateFilterCost,
  extractContractIds,
} from "../src/eventFilterDsl.js";

describe("eventFilterDsl", () => {
  describe("validateFilter", () => {
    it("validates a simple condition", () => {
      const filter = {
        field: "contract",
        operator: "eq",
        value: "CABC123...",
      };
      const result = validateFilter(filter);
      assert.strictEqual(result.valid, true);
    });

    it("validates a logical group", () => {
      const filter = {
        operator: "and",
        conditions: [
          { field: "contract", operator: "eq", value: "CABC123..." },
          { field: "function", operator: "eq", value: "transfer" },
        ],
      };
      const result = validateFilter(filter);
      assert.strictEqual(result.valid, true);
    });

    it("rejects invalid operator", () => {
      const filter = {
        field: "contract",
        operator: "invalid",
        value: "CABC123...",
      };
      const result = validateFilter(filter);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes("Invalid operator"));
    });

    it("rejects missing field", () => {
      const filter = {
        operator: "eq",
        value: "CABC123...",
      };
      const result = validateFilter(filter);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes("field"));
    });

    it("rejects NOT with multiple conditions", () => {
      const filter = {
        operator: "not",
        conditions: [
          { field: "contract", operator: "eq", value: "CABC123..." },
          { field: "function", operator: "eq", value: "transfer" },
        ],
      };
      const result = validateFilter(filter);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes("NOT"));
    });

    it("validates topic field format", () => {
      const filter = {
        field: "topic[1]",
        operator: "eq",
        value: "GABC123...",
      };
      const result = validateFilter(filter);
      assert.strictEqual(result.valid, true);
    });

    it("rejects invalid topic field format", () => {
      const filter = {
        field: "topic[abc]",
        operator: "eq",
        value: "GABC123...",
      };
      const result = validateFilter(filter);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes("topic"));
    });

    it("validates arg field format", () => {
      const filter = {
        field: "arg.amount",
        operator: "eq",
        value: "100",
      };
      const result = validateFilter(filter);
      assert.strictEqual(result.valid, true);
    });

    it("rejects invalid arg field format", () => {
      const filter = {
        field: "arg",
        operator: "eq",
        value: "100",
      };
      const result = validateFilter(filter);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes("arg"));
    });
  });

  describe("filterToSql", () => {
    it("converts simple condition to SQL", () => {
      const filter = {
        field: "contract",
        operator: "eq",
        value: "CABC123...",
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("contract_id ="));
      assert.strictEqual(result.params.length, 1);
      assert.strictEqual(result.params[0], "CABC123...");
    });

    it("converts function filter to SQL", () => {
      const filter = {
        field: "function",
        operator: "eq",
        value: "transfer",
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("function ="));
      assert.strictEqual(result.params[0], "transfer");
    });

    it("converts ledger filter to SQL", () => {
      const filter = {
        field: "ledger",
        operator: "gte",
        value: 100000,
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("ledger >="));
      assert.strictEqual(result.params[0], 100000);
    });

    it("converts topic filter to SQL", () => {
      const filter = {
        field: "topic[1]",
        operator: "eq",
        value: "GABC123...",
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("raw_topics->>1"));
      assert.strictEqual(result.params[0], "GABC123...");
    });

    it("converts arg filter to SQL", () => {
      const filter = {
        field: "arg.amount",
        operator: "eq",
        value: "100",
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("raw_data->'amount'"));
      assert.strictEqual(result.params[0], "100");
    });

    it("converts IN operator to SQL", () => {
      const filter = {
        field: "function",
        operator: "in",
        value: ["transfer", "mint", "burn"],
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("ANY"));
      assert.strictEqual(result.params[0].length, 3);
    });

    it("converts contains operator to SQL with wildcards", () => {
      const filter = {
        field: "contract",
        operator: "contains",
        value: "ABC",
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("ILIKE"));
      assert.strictEqual(result.params[0], "%ABC%");
    });

    it("converts starts_with operator to SQL with wildcard", () => {
      const filter = {
        field: "function",
        operator: "starts_with",
        value: "transfer",
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("ILIKE"));
      assert.strictEqual(result.params[0], "transfer%");
    });

    it("converts ends_with operator to SQL with wildcard", () => {
      const filter = {
        field: "contract",
        operator: "ends_with",
        value: "123",
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("ILIKE"));
      assert.strictEqual(result.params[0], "%123");
    });

    it("converts AND group to SQL", () => {
      const filter = {
        operator: "and",
        conditions: [
          { field: "contract", operator: "eq", value: "CABC123..." },
          { field: "function", operator: "eq", value: "transfer" },
        ],
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("AND"));
      assert.strictEqual(result.params.length, 2);
    });

    it("converts OR group to SQL", () => {
      const filter = {
        operator: "or",
        conditions: [
          { field: "function", operator: "eq", value: "transfer" },
          { field: "function", operator: "eq", value: "mint" },
        ],
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("OR"));
      assert.strictEqual(result.params.length, 2);
    });

    it("converts NOT group to SQL", () => {
      const filter = {
        operator: "not",
        conditions: [{ field: "function", operator: "eq", value: "transfer" }],
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("NOT"));
      assert.strictEqual(result.params.length, 1);
    });

    it("converts nested groups to SQL", () => {
      const filter = {
        operator: "and",
        conditions: [
          { field: "contract", operator: "eq", value: "CABC123..." },
          {
            operator: "or",
            conditions: [
              { field: "function", operator: "eq", value: "transfer" },
              { field: "function", operator: "eq", value: "mint" },
            ],
          },
        ],
      };
      const result = filterToSql(filter);
      assert.ok(result.where.includes("AND"));
      assert.ok(result.where.includes("OR"));
      assert.strictEqual(result.params.length, 3);
    });
  });

  describe("estimateFilterCost", () => {
    it("estimates low cost for indexed fields", () => {
      const filter = {
        field: "contract",
        operator: "eq",
        value: "CABC123...",
      };
      const cost = estimateFilterCost(filter);
      assert.ok(cost < 20);
    });

    it("estimates higher cost for topic filters", () => {
      const filter = {
        field: "topic[1]",
        operator: "eq",
        value: "GABC123...",
      };
      const cost = estimateFilterCost(filter);
      assert.ok(cost >= 20);
    });

    it("estimates highest cost for arg filters", () => {
      const filter = {
        field: "arg.amount",
        operator: "eq",
        value: "100",
      };
      const cost = estimateFilterCost(filter);
      assert.ok(cost >= 30);
    });

    it("adds cost for LIKE operators", () => {
      const filter = {
        field: "contract",
        operator: "contains",
        value: "ABC",
      };
      const cost = estimateFilterCost(filter);
      assert.ok(cost >= 20);
    });

    it("adds cost for IN operator based on array size", () => {
      const filter = {
        field: "function",
        operator: "in",
        value: ["transfer", "mint", "burn", "approve", "transfer_from"],
      };
      const cost = estimateFilterCost(filter);
      assert.ok(cost >= 20);
    });

    it("estimates cost for complex nested filter", () => {
      const filter = {
        operator: "and",
        conditions: [
          { field: "contract", operator: "eq", value: "CABC123..." },
          { field: "function", operator: "eq", value: "transfer" },
          { field: "topic[1]", operator: "eq", value: "GABC123..." },
          { field: "arg.amount", operator: "gte", value: "100" },
        ],
      };
      const cost = estimateFilterCost(filter);
      assert.ok(cost > 50);
    });

    it("caps cost at 100", () => {
      const filter = {
        operator: "and",
        conditions: Array(20).fill({
          field: "arg.amount",
          operator: "eq",
          value: "100",
        }),
      };
      const cost = estimateFilterCost(filter);
      assert.strictEqual(cost, 100);
    });
  });

  describe("extractContractIds", () => {
    it("extracts contract ID from simple filter", () => {
      const filter = {
        field: "contract",
        operator: "eq",
        value: "CABC123...",
      };
      const ids = extractContractIds(filter);
      assert.strictEqual(ids.length, 1);
      assert.strictEqual(ids[0], "CABC123...");
    });

    it("extracts multiple contract IDs from IN operator", () => {
      const filter = {
        field: "contract",
        operator: "in",
        value: ["CABC123...", "CDEF456...", "CGHI789..."],
      };
      const ids = extractContractIds(filter);
      assert.strictEqual(ids.length, 3);
    });

    it("extracts contract IDs from nested groups", () => {
      const filter = {
        operator: "or",
        conditions: [
          { field: "contract", operator: "eq", value: "CABC123..." },
          { field: "contract", operator: "eq", value: "CDEF456..." },
        ],
      };
      const ids = extractContractIds(filter);
      assert.strictEqual(ids.length, 2);
    });

    it("returns empty array when no contract field", () => {
      const filter = {
        field: "function",
        operator: "eq",
        value: "transfer",
      };
      const ids = extractContractIds(filter);
      assert.strictEqual(ids.length, 0);
    });
  });
});
