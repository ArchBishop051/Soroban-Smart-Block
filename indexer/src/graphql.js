import { logger } from "./logger.js";
import {
  buildSchema,
  execute as executeGraphQL,
  getOperationAST,
  parse,
  specifiedRules,
  validate,
  GraphQLError,
  Kind,
} from "graphql";
import { db } from "./db.js";
import config from "./config.js";

const MAX_PAGE_SIZE = 100;
const MAX_QUERY_LENGTH = 10_000;
const MAX_QUERY_COMPLEXITY = 2_000;

export const typeDefs = `
  type Event {
    event_id: String
    seq: Int
    contract_id: String
    function: String
    function_name: String
    ledger: Int
    ledger_sequence: Int
    tx_hash: String
    description: String
    cpu_instructions: Int
    mem_bytes: Int
    fee_charged: Int
    is_high_bloat_risk: Boolean
    is_clawback: Boolean
  }

  type PageInfo {
    has_next: Boolean!
    has_previous: Boolean!
    start_cursor: String
    end_cursor: String
  }

  type EventPage {
    data: [Event]
    next_cursor: String
    page_info: PageInfo
    total: Int
    count_is_estimate: Boolean
  }

  type Query {
    events(
      contract: String
      fn: String
      type: String
      cursor: String
      after: String
      before: String
      limit: Int
      count: String
    ): EventPage

    event(seq: Int!): Event
  }
`;

// ── Resolvers ─────────────────────────────────────────────────────────────────

const resolvers = {
  Query: {
    events: async (_root, args) => {
      let after_seq = 0;
      let after = args.after;
      if (typeof after === "number") {
        after_seq = after;
        after = undefined;
      } else if (typeof after === "string" && /^\d+$/.test(after)) {
        after_seq = Number(after);
        after = undefined;
      }
      return db.getEventsCursor({
        contract: args.contract || undefined,
        fn: args.fn || undefined,
        type: args.type || undefined,
        cursor: args.cursor || undefined,
        after: after || undefined,
        before: args.before || undefined,
        after_seq,
        limit: args.limit ? Math.min(args.limit, 200) : 25,
        count: args.count || undefined,
      });
    },
    event: async (_root, args) => {
      return db.getEvent(args.seq);
    },
  },
  // Field aliases so introspection and queries using the canonical names work.
  // The DB columns are `function` and `ledger`; these expose them under the
  // names required by the issue acceptance criteria.
  Event: {
    function_name: (row) => row.function ?? null,
    ledger_sequence: (row) => row.ledger ?? null,
  },
};

// ── Minimal GraphQL execution (no external runtime needed) ────────────────────

// ── Security: Depth and Complexity Validation ────────────────────────────────

/**
 * Calculate the maximum nesting depth in a parsed GraphQL query.
 * Used to prevent queries with excessive nesting that could cause DoS.
 *
 * @param {object} parsed - Parsed GraphQL query
 * @returns {number} Maximum depth found
 */
function calculateDepth(parsed) {
  // If the parser calculated depth directly, use it
  if (parsed.maxDepth !== undefined) {
    return parsed.maxDepth;
  }

  // Fallback calculation for backwards compatibility
  let maxDepth = 1; // Start at 1 for the root query

  if (parsed.topFields && parsed.topFields.length > 0) {
    maxDepth = 2; // Top level fields are depth 2
  }

  if (parsed.dataFields && parsed.dataFields.length > 0) {
    maxDepth = 3; // data.* fields are depth 3
  }

  return maxDepth;
}

/**
 * Calculate query complexity based on field costs.
 * List-returning fields have higher cost to reflect their DB impact.
 *
 * @param {object} parsed - Parsed GraphQL query
 * @returns {number} Total complexity cost
 */
function calculateComplexity(parsed) {
  let totalCost = 1; // Base cost for the query

  // Cost for top-level fields
  if (parsed.topFields) {
    for (const field of parsed.topFields) {
      if (isListField(field)) {
        totalCost += 10;
      } else {
        totalCost += 1;
      }
    }
  }

  // Cost for nested data fields — base cost of 1 each
  if (parsed.dataFields) {
    totalCost += parsed.dataFields.length;
  }

  return totalCost;
}

/**
 * Check if a field name indicates a list-returning field.
 * Used for complexity calculation.
 *
 * @param {string} fieldName
 * @returns {boolean}
 */
function isListField(fieldName) {
  const listFields = new Set([
    "events",
    "data",
    "nodes",
    "edges",
    "items",
    "results",
    "records",
    "entries",
    "list",
    "feed",
    "page",
    "collection",
  ]);

  if (listFields.has(fieldName.toLowerCase())) return true;

  // Heuristic: plural names (ending in 's') are usually list-returning
  return fieldName.length > 1 && fieldName.endsWith("s");
}

/**
 * Validate query security constraints (depth and complexity).
 *
 * @param {object} parsed - Parsed GraphQL query
 * @returns {object|null} Error object if validation fails, null if valid
 */
function validateQuerySecurity(parsed) {
  // Check depth
  const depth = calculateDepth(parsed);
  if (depth > config.MAX_GRAPHQL_DEPTH) {
    return {
      message: `Query depth ${depth} exceeds maximum ${config.MAX_GRAPHQL_DEPTH}`,
    };
  }

  // Check complexity
  const complexity = calculateComplexity(parsed);
  if (complexity > config.MAX_GRAPHQL_COMPLEXITY) {
    return {
      message: `Query complexity ${complexity} exceeds maximum ${config.MAX_GRAPHQL_COMPLEXITY}`,
    };
  }

  return null;
}

/**
 * Check if the request is authenticated with a valid API key.
 *
 * @param {object} req - Express request object
 * @returns {boolean} True if authenticated
 */
function isAuthenticated(req) {
  const apiKey = req.headers["x-api-key"] || req.query.apiKey;
  return apiKey && apiKey === config.API_KEY;
}

/**
 * Check if introspection should be allowed for this request.
 *
 * @param {object} req - Express request object
 * @returns {boolean} True if introspection is allowed
 */
function isIntrospectionAllowed(req) {
  // Always allow in development
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  // In production, require authentication
  return isAuthenticated(req);
}

  type Query {
    events(contract: String, fn: String, type: String, after: Int, after_seq: Int, first: Int, limit: Int): EventPage!
    event(seq: Int!): Event
    contracts(type: String, after: String, first: Int, limit: Int): ContractPage!
    wallet(address: String!, after: Int, after_seq: Int, first: Int, limit: Int): EventPage!
    subInvocations(contract: String, txHash: String, after: Int, first: Int, limit: Int): SubInvocationPage!
  }
`;

const schema = buildSchema(typeDefs);

export function isListField(fieldName) {
  return new Set(["events", "contracts", "wallet", "subInvocations", "data", "nodes", "edges", "items", "results", "records", "entries", "list", "feed", "page", "collection"]).has(fieldName);
}

/**
 * Parse GraphQL fields and calculate nesting depth.
 * Handles nested field structures for security analysis.
 */
function parseFieldsWithDepth(fieldsText) {
  // Remove trailing closing braces and clean up
  let cleaned = fieldsText.replace(/\s*\}\s*$/, "").trim();

  const topFields = [];
  let dataFields = null;

  // Calculate depth by counting the maximum brace nesting
  const maxDepth = calculateMaxBraceDepth(cleaned) + 1; // +1 for the operation level

  // Extract top-level field names (simple approach)
  const fieldMatches = cleaned.match(/^\s*(\w+)/gm) || [];
  topFields.push(...fieldMatches.map((m) => m.trim()));

  // Special handling for 'data' field if present
  const dataMatch = cleaned.match(/data\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/s);
  if (dataMatch) {
    const dataContent = dataMatch[1];
    dataFields = extractSimpleFields(dataContent);
  }

  return { topFields, dataFields, maxDepth };
}

/**
 * Calculate the maximum brace nesting depth in a string.
 */
function calculateMaxBraceDepth(text) {
  let maxDepth = 0;
  let currentDepth = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (text[i] === "}") {
      currentDepth--;
    }
  }

  return maxDepth;
}

/**
 * Extract simple field names from content (no nested analysis).
 */
function extractSimpleFields(content) {
  if (!content) return [];

  // For simple cases, just extract word tokens that could be field names
  const fields = [];
  const words = content.match(/\w+/g) || [];

  // Filter out obvious non-field tokens
  for (const word of words) {
    // Skip if it looks like it might be part of a nested structure we can't handle
    if (word.length > 0 && !["true", "false", "null"].includes(word.toLowerCase())) {
      fields.push(word);
    }
  }

  return fields.slice(0, 10); // Limit to prevent abuse
}

function resolveEventFields(row) {
  if (!row) return row;
  return {
    ...row,
    function_name: row.function ?? null,
    ledger_sequence: row.ledger ?? null,
  };
}

function maxSelectionDepth(selectionSet, fragments, depth = 0, visited = new Set()) {
  if (!selectionSet) return depth;
  let maxDepth = depth;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      maxDepth = Math.max(maxDepth, depth + 1);
      maxDepth = Math.max(maxDepth, maxSelectionDepth(selection.selectionSet, fragments, depth + 1, visited));
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      maxDepth = Math.max(maxDepth, maxSelectionDepth(selection.selectionSet, fragments, depth, visited));
    } else if (selection.kind === Kind.FRAGMENT_SPREAD && !visited.has(selection.name.value)) {
      const fragment = fragments.get(selection.name.value);
      if (fragment) {
        visited.add(selection.name.value);
        maxDepth = Math.max(maxDepth, maxSelectionDepth(fragment.selectionSet, fragments, depth, visited));
        visited.delete(selection.name.value);
      }
    }
  }
  return maxDepth;
}

function argumentValue(field, name, variables, defaultValue) {
  const argument = field.arguments?.find((entry) => entry.name.value === name);
  if (!argument) return defaultValue;
  if (argument.value.kind === Kind.VARIABLE) return variables?.[argument.value.name.value] ?? defaultValue;
  if (argument.value.kind === Kind.INT) return Number(argument.value.value);
  return defaultValue;
}

  // Shape result to match requested fields
  if (parsed.opName === "events") {
    const page = result;
    const out = {};
    if (!parsed.topFields || parsed.topFields.includes("next_cursor")) {
      out.next_cursor = page.next_cursor;
    }
    if (!parsed.topFields || parsed.topFields.includes("page_info")) {
      out.page_info = page.page_info;
    }
    if (!parsed.topFields || parsed.topFields.includes("total")) {
      out.total = page.total;
    }
    if (!parsed.topFields || parsed.topFields.includes("count_is_estimate")) {
      out.count_is_estimate = page.count_is_estimate;
    }
    if (!parsed.topFields || parsed.topFields.some((f) => f === "data" || parsed.dataFields)) {
      out.data = (page.data || []).map((ev) => {
        const resolved = resolveEventFields(ev);
        return parsed.dataFields ? project(resolved, parsed.dataFields) : resolved;
      });
    }
  }
  return cost;
}

export function calculateDepth(parsed, operationName) {
  if (typeof parsed?.maxDepth === "number") return parsed.maxDepth;
  if (parsed?.kind === Kind.DOCUMENT) {
    const fragments = new Map(parsed.definitions.filter((d) => d.kind === Kind.FRAGMENT_DEFINITION).map((d) => [d.name.value, d]));
    const operations = parsed.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION);
    const operation = operations.find((d) => d.name?.value === operationName) ?? operations[0];
    return maxSelectionDepth(operation?.selectionSet, fragments);
  }
  if (Array.isArray(parsed?.topFields)) return parsed.dataFields?.length ? 3 : 2;
  return 1;
}

  return {
    __schema: {
      queryType: { name: "Query" },
      types: [
        {
          kind: "OBJECT",
          name: "Event",
          fields: eventFields,
        },
        {
          kind: "OBJECT",
          name: "PageInfo",
          fields: [
            { name: "has_next", type: { name: "Boolean", kind: "SCALAR" } },
            { name: "has_previous", type: { name: "Boolean", kind: "SCALAR" } },
            { name: "start_cursor", type: { name: "String", kind: "SCALAR" } },
            { name: "end_cursor", type: { name: "String", kind: "SCALAR" } },
          ],
        },
        {
          kind: "OBJECT",
          name: "EventPage",
          fields: [
            { name: "data", type: { name: "Event", kind: "OBJECT" } },
            { name: "next_cursor", type: { name: "String", kind: "SCALAR" } },
            { name: "page_info", type: { name: "PageInfo", kind: "OBJECT" } },
            { name: "total", type: { name: "Int", kind: "SCALAR" } },
            { name: "count_is_estimate", type: { name: "Boolean", kind: "SCALAR" } },
          ],
        },
        {
          kind: "OBJECT",
          name: "Query",
          fields: [
            { name: "events", type: { name: "EventPage", kind: "OBJECT" } },
            { name: "event", type: { name: "Event", kind: "OBJECT" } },
          ],
        },
      ],
    },
  };
}

export function validateQuerySecurity(document, variables = {}, operationName) {
  const depth = calculateDepth(document, operationName);
  const maxDepth = Number(config.MAX_GRAPHQL_DEPTH) || 5;
  if (depth > maxDepth) return { message: `Query depth ${depth} exceeds maximum ${maxDepth}` };
  const complexity = calculateComplexity(document, variables, operationName);
  const maxComplexity = Math.min(Number(config.MAX_GRAPHQL_COMPLEXITY) || MAX_QUERY_COMPLEXITY, MAX_QUERY_COMPLEXITY);
  if (complexity > maxComplexity) return { message: `Query complexity ${complexity} exceeds maximum ${maxComplexity}` };
  return null;
}

export function isAuthenticated(req) {
  const apiKey = req.headers["x-api-key"] || req.query.apiKey;
  return Boolean(apiKey && apiKey === config.API_KEY);
}

export function isIntrospectionAllowed(req) {
  return process.env.NODE_ENV !== "production" || isAuthenticated(req);
}

    // Handle introspection queries with security check
    if (isIntrospectionQuery(query)) {
      if (!isIntrospectionAllowed(req)) {
        return res.status(400).json({
          errors: [{ message: "Introspection is disabled in production. Please authenticate." }],
        });
      }
      return res.json({ data: buildIntrospectionResponse() });
    }

    try {
      const parsed = parseQuery(query);

      // Security validation
      const securityError = validateQuerySecurity(parsed);
      if (securityError) {
        return res.status(400).json({ errors: [securityError] });
      }

      // Merge inline args with variables (variables take precedence)
      if (variables) Object.assign(parsed.args, variables);
      const data = await execute(parsed);
      res.json({ data });
    } catch (err) {
      res.status(400).json({ errors: [{ message: err.message }] });
    }
    const securityError = validateQuerySecurity(document, variables, operationName);
    if (securityError) return res.status(400).json({ errors: [securityError] });

    const validationErrors = validate(schema, document, specifiedRules);
    if (validationErrors.length) return res.status(400).json({ errors: validationErrors });

    const result = await executeGraphQL({
      schema,
      document,
      rootValue: createRootValue(),
      variableValues: variables,
      operationName,
      fieldResolver(source, args, context, info) {
        if (info.parentType.name === "Event" && info.fieldName === "function_name") return source.function ?? null;
        if (info.parentType.name === "Event" && info.fieldName === "ledger_sequence") return source.ledger ?? null;
        if (info.parentType.name === "SubInvocation" && info.fieldName === "args") {
          return source.args == null ? null : JSON.stringify(source.args);
        }
        const value = source?.[info.fieldName];
        return typeof value === "function" ? value(args, context, info) : value;
      },
    });
    if (result.errors?.length) return res.status(400).json({ errors: result.errors });
    return res.json({ data: result.data });
  } catch (error) {
    return res.status(400).json({ errors: [{ message: error.message }] });
  }
}

  // GET /graphql?query=… — convenience for browser testing
  app.get("/graphql", async (req, res) => {
    const query = req.query.query;
    if (!query) {
      return res.json({
        info: "POST a JSON body with { query } to use GraphQL",
      });
    }

    if (isIntrospectionQuery(String(query))) {
      if (!isIntrospectionAllowed(req)) {
        return res.status(400).json({
          errors: [{ message: "Introspection is disabled in production. Please authenticate." }],
        });
      }
      return res.json({ data: buildIntrospectionResponse() });
    }

    try {
      const parsed = parseQuery(String(query));

      // Security validation
      const securityError = validateQuerySecurity(parsed);
      if (securityError) {
        return res.status(400).json({ errors: [securityError] });
      }

      const data = await execute(parsed);
      res.json({ data });
    } catch (err) {
      res.status(400).json({ errors: [{ message: err.message }] });
    }
    return handleGraphQL(req, res, String(req.query.query), variables, req.query.operationName);
  });

  logger.info("[graphql] Endpoint mounted at /graphql with security limits:");
  logger.info(`[graphql]   Max depth: ${config.MAX_GRAPHQL_DEPTH}`);
  logger.info(`[graphql]   Max complexity: ${config.MAX_GRAPHQL_COMPLEXITY}`);
  logger.info(`[graphql]   Introspection: ${process.env.NODE_ENV !== "production" ? "enabled" : "auth required"}`);
}

// Export helper functions for testing
export {
  parseQuery,
  calculateDepth,
  calculateComplexity,
  isListField,
  validateQuerySecurity,
  isAuthenticated,
  isIntrospectionAllowed,
};
