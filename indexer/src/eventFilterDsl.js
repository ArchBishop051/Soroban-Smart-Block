/**
 * Event Filter DSL Parser
 * 
 * Parses a JSON-based DSL for filtering events with support for:
 * - Field comparisons (contract, function, ledger, type)
 * - Topic position predicates (raw_topics[index])
 * - Decoded arg path predicates (raw_data.path)
 * - Logical operators (and, or, not)
 * - Nested groups
 * 
 * DSL Schema:
 * {
 *   operator: "and" | "or" | "not",
 *   conditions: [
 *     {
 *       field: "contract" | "function" | "ledger" | "type" | "topic[N]" | "arg.path",
 *       operator: "eq" | "ne" | "gt" | "lt" | "gte" | "lte" | "contains" | "starts_with" | "ends_with" | "in",
 *       value: any
 *     }
 *   ]
 * }
 * 
 * Example:
 * {
 *   "operator": "and",
 *   "conditions": [
 *     { "field": "contract", "operator": "eq", "value": "C..." },
 *     { "field": "function", "operator": "in", "value": ["transfer", "mint"] },
 *     { "field": "topic[1]", "operator": "eq", "value": "G..." },
 *     {
 *       "operator": "or",
 *       "conditions": [
 *         { "field": "ledger", "operator": "gte", "value": 100000 },
 *         { "field": "ledger", "operator": "lte", "value": 50000 }
 *       ]
 *     }
 *   ]
 * }
 */

import { logger } from "./logger.js";

/**
 * Validate a DSL filter object
 * @param {object} filter - The DSL filter to validate
 * @returns {object} { valid: boolean, error?: string }
 */
export function validateFilter(filter) {
  if (!filter || typeof filter !== "object") {
    return { valid: false, error: "Filter must be an object" };
  }

  // Top-level can be either a single condition or a logical group
  if (filter.operator && filter.conditions) {
    return validateLogicalGroup(filter);
  } else if (filter.field && filter.operator) {
    return validateCondition(filter);
  }

  return { valid: false, error: "Filter must have either operator+conditions or field+operator" };
}

/**
 * Validate a logical group (and/or/not)
 * @param {object} group - The logical group to validate
 * @returns {object} { valid: boolean, error?: string }
 */
function validateLogicalGroup(group) {
  const validOperators = ["and", "or", "not"];
  if (!validOperators.includes(group.operator)) {
    return { valid: false, error: `Invalid operator: ${group.operator}. Must be one of: ${validOperators.join(", ")}` };
  }

  if (!Array.isArray(group.conditions) || group.conditions.length === 0) {
    return { valid: false, error: "Logical group must have non-empty conditions array" };
  }

  // NOT can only have one condition
  if (group.operator === "not" && group.conditions.length !== 1) {
    return { valid: false, error: "NOT operator must have exactly one condition" };
  }

  // Validate each nested condition
  for (const cond of group.conditions) {
    const result = cond.operator ? validateLogicalGroup(cond) : validateCondition(cond);
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
}

/**
 * Validate a single condition
 * @param {object} condition - The condition to validate
 * @returns {object} { valid: boolean, error?: string }
 */
function validateCondition(condition) {
  if (!condition.field) {
    return { valid: false, error: "Condition must have a field" };
  }

  if (!condition.operator) {
    return { valid: false, error: "Condition must have an operator" };
  }

  const validOperators = ["eq", "ne", "gt", "lt", "gte", "lte", "contains", "starts_with", "ends_with", "in"];
  if (!validOperators.includes(condition.operator)) {
    return { valid: false, error: `Invalid operator: ${condition.operator}. Must be one of: ${validOperators.join(", ")}` };
  }

  if (condition.value === undefined || condition.value === null) {
    return { valid: false, error: "Condition must have a value" };
  }

  // Validate field format
  if (condition.field.startsWith("topic[")) {
    const match = condition.field.match(/^topic\[(\d+)\]$/);
    if (!match) {
      return { valid: false, error: `Invalid topic field format: ${condition.field}. Use topic[N] where N is a number` };
    }
  }

  if (condition.field.startsWith("arg.")) {
    // arg paths can be any dot-separated path
    if (condition.field.length <= 4) {
      return { valid: false, error: `Invalid arg field format: ${condition.field}. Use arg.path.to.field` };
    }
  }

  return { valid: true };
}

/**
 * Convert a DSL filter to SQL WHERE clause and parameters
 * @param {object} filter - The validated DSL filter
 * @returns {object} { where: string, params: any[] }
 */
export function filterToSql(filter) {
  const params = [];
  let paramIndex = 1;

  function convert(node, isNegated = false) {
    if (node.operator && node.conditions) {
      // Logical group
      const sqlConditions = node.conditions.map((c) => convert(c, isNegated || node.operator === "not"));
      const joined = sqlConditions.join(node.operator === "or" ? " OR " : " AND ");
      return isNegated ? `NOT (${joined})` : `(${joined})`;
    } else {
      // Single condition
      return conditionToSql(node, params, paramIndex++);
    }
  }

  const where = convert(filter);
  return { where, params };
}

/**
 * Convert a single condition to SQL
 * @param {object} condition - The condition to convert
 * @param {array} params - Parameters array (modified in place)
 * @param {number} index - Current parameter index
 * @returns {string} SQL fragment
 */
function conditionToSql(condition, params, index) {
  const { field, operator, value } = condition;
  let sqlField;
  let sqlValue = `$${index}`;

  // Map DSL fields to SQL columns
  if (field === "contract") {
    sqlField = "contract_id";
  } else if (field === "function") {
    sqlField = "function";
  } else if (field === "ledger") {
    sqlField = "ledger";
  } else if (field === "type") {
    sqlField = "type";
  } else if (field.startsWith("topic[")) {
    const match = field.match(/^topic\[(\d+)\]$/);
    const topicIndex = match[1];
    sqlField = `raw_topics->>${topicIndex}`;
  } else if (field.startsWith("arg.")) {
    const path = field.slice(4); // Remove "arg."
    sqlField = `raw_data->'${path.replace(/\./g, "'->'")}'`;
  } else {
    throw new Error(`Unknown field: ${field}`);
  }

  // Handle type-specific conversions
  if (field === "ledger" && typeof value === "number") {
    params.push(value);
  } else if (operator === "in") {
    if (!Array.isArray(value)) {
      throw new Error(`IN operator requires array value, got ${typeof value}`);
    }
    params.push(value);
    sqlValue = `ANY($${index})`;
  } else {
    params.push(value);
  }

  // Map operators to SQL
  const operatorMap = {
    eq: "=",
    ne: "!=",
    gt: ">",
    lt: "<",
    gte: ">=",
    lte: "<=",
    contains: "ILIKE",
    starts_with: "ILIKE",
    ends_with: "ILIKE",
  };

  const sqlOp = operatorMap[operator];
  if (!sqlOp) {
    throw new Error(`Unknown operator: ${operator}`);
  }

  // Handle string operators with wildcards
  if (operator === "contains") {
    params[index - 1] = `%${value}%`;
  } else if (operator === "starts_with") {
    params[index - 1] = `${value}%`;
  } else if (operator === "ends_with") {
    params[index - 1] = `%${value}`;
  }

  return `${sqlField} ${sqlOp} ${sqlValue}`;
}

/**
 * Estimate query cost for a filter (for UI cost indicator)
 * Higher cost = more expensive query
 * @param {object} filter - The DSL filter
 * @returns {number} Cost score (0-100)
 */
export function estimateFilterCost(filter) {
  let cost = 0;

  function traverse(node) {
    if (node.operator && node.conditions) {
      // Logical groups add cost based on complexity
      cost += node.conditions.length * 5;
      node.conditions.forEach(traverse);
    } else {
      // Field-specific costs
      if (node.field === "contract") {
        cost += 5; // Indexed, cheap
      } else if (node.field === "function") {
        cost += 5; // Indexed, cheap
      } else if (node.field === "ledger") {
        cost += 10; // Range scan, moderate
      } else if (node.field.startsWith("topic[")) {
        cost += 20; // JSON array access, expensive
      } else if (node.field.startsWith("arg.")) {
        cost += 30; // JSON nested path, very expensive
      } else if (node.field === "type") {
        cost += 5; // Computed column, cheap
      }

      // Operator-specific costs
      if (node.operator === "contains" || node.operator === "starts_with" || node.operator === "ends_with") {
        cost += 15; // LIKE operations are expensive
      } else if (node.operator === "in") {
        cost += Array.isArray(node.value) ? node.value.length * 3 : 10;
      }
    }
  }

  traverse(filter);
  return Math.min(cost, 100); // Cap at 100
}

/**
 * Extract contract IDs from a filter for prefetching ABI metadata
 * @param {object} filter - The DSL filter
 * @returns {string[]} Array of contract IDs
 */
export function extractContractIds(filter) {
  const contractIds = new Set();

  function traverse(node) {
    if (node.operator && node.conditions) {
      node.conditions.forEach(traverse);
    } else if (node.field === "contract" && node.value) {
      if (node.operator === "in" && Array.isArray(node.value)) {
        node.value.forEach((id) => contractIds.add(id));
      } else {
        contractIds.add(node.value);
      }
    }
  }

  traverse(filter);
  return Array.from(contractIds);
}
