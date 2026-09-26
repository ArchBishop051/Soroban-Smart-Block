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

  type EventPage {
    data: [Event!]!
    next_cursor: Int
  }

  type Contract {
    id: String!
    name: String!
    description: String
    registered_by: String
    protocol_type: String
    is_verified: Boolean
    created_at: String
  }

  type ContractPage {
    data: [Contract!]!
    next_cursor: String
  }

  type SubInvocation {
    id: Int
    parent_tx_hash: String
    depth: Int
    contract_id: String
    function: String
    args: String
    ledger: Int
  }

  type SubInvocationPage {
    data: [SubInvocation!]!
    next_cursor: Int
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

function pageSize(args = {}) {
  const requested = args.first ?? args.limit ?? 25;
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_PAGE_SIZE) {
    throw new GraphQLError(`Page size must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  return requested;
}

function createRootValue() {
  return {
    events: async (args) => db.getEventsCursor({
      contract: args.contract || undefined,
      fn: args.fn || undefined,
      type: args.type || undefined,
      after_seq: args.after_seq ?? args.after ?? 0,
      limit: pageSize(args),
    }),
    event: async ({ seq }) => db.getEvent(seq),
    contracts: async (args) => db.listContractsCursor({
      type: args.type || undefined,
      after: args.after || undefined,
      limit: pageSize(args),
    }),
    wallet: async (args) => db.getWalletEventsCursor(args.address, {
      after_seq: args.after ?? args.after_seq ?? 0,
      limit: pageSize(args),
    }),
    subInvocations: async (args) => db.getSubInvocationsCursor({
      contract: args.contract || undefined,
      tx_hash: args.txHash || undefined,
      after_id: args.after ?? 0,
      limit: pageSize(args),
    }),
  };
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

function selectionComplexity(selectionSet, fragments, variables, visited = new Set()) {
  if (!selectionSet) return 0;
  let cost = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const nestedCost = Math.max(1, selectionComplexity(selection.selectionSet, fragments, variables, visited));
      const size = isListField(selection.name.value) && selection.name.value !== "data"
        ? Math.min(argumentValue(selection, "first", variables, argumentValue(selection, "limit", variables, 25)), MAX_PAGE_SIZE + 1)
        : 1;
      cost += nestedCost * size;
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      cost += selectionComplexity(selection.selectionSet, fragments, variables, visited);
    } else if (selection.kind === Kind.FRAGMENT_SPREAD && !visited.has(selection.name.value)) {
      const fragment = fragments.get(selection.name.value);
      if (fragment) {
        visited.add(selection.name.value);
        cost += selectionComplexity(fragment.selectionSet, fragments, variables, visited);
        visited.delete(selection.name.value);
      }
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

export function calculateComplexity(parsed, variables = {}, operationName) {
  if (parsed?.kind === Kind.DOCUMENT) {
    const fragments = new Map(parsed.definitions.filter((d) => d.kind === Kind.FRAGMENT_DEFINITION).map((d) => [d.name.value, d]));
    const operations = parsed.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION);
    const operation = operations.find((d) => d.name?.value === operationName) ?? operations[0];
    return selectionComplexity(operation?.selectionSet, fragments, variables);
  }
  if (Array.isArray(parsed?.topFields)) {
    return 1 + parsed.topFields.reduce((sum, field) => sum + (isListField(field) ? 10 : 1), 0) + (parsed.dataFields?.length ?? 0);
  }
  return 1;
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

export function parseQuery(query) {
  return parse(query, { maxTokens: 2_000 });
}

async function handleGraphQL(req, res, query, variables = {}, operationName) {
  if (!query || typeof query !== "string") return res.status(400).json({ errors: [{ message: "Missing query" }] });
  if (query.length > MAX_QUERY_LENGTH) return res.status(400).json({ errors: [{ message: "Query is too large" }] });

  try {
    const document = parseQuery(query);
    const operation = getOperationAST(document, operationName);
    if (!operation) return res.status(400).json({ errors: [{ message: "Operation name is missing or invalid" }] });
    const introspectionDenied = process.env.NODE_ENV === "production" && !isAuthenticated(req)
      && /\b__(?:schema|type)\b/.test(query);
    if (introspectionDenied) {
      return res.status(400).json({ errors: [{ message: "Introspection is disabled in production. Please authenticate." }] });
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

export function attachGraphQL(app) {
  app.post("/graphql", (req, res) => handleGraphQL(req, res, req.body?.query, req.body?.variables, req.body?.operationName));
  app.get("/graphql", (req, res) => {
    if (!req.query.query) return res.json({ info: "POST a JSON body with { query } to use GraphQL" });
    let variables = {};
    try {
      variables = req.query.variables ? JSON.parse(String(req.query.variables)) : {};
    } catch {
      return res.status(400).json({ errors: [{ message: "Invalid variables JSON" }] });
    }
    return handleGraphQL(req, res, String(req.query.query), variables, req.query.operationName);
  });
  logger.info(`[graphql] Endpoint mounted at /graphql with max page size ${MAX_PAGE_SIZE} and query complexity limit ${MAX_QUERY_COMPLEXITY}`);
}