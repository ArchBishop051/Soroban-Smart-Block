import crypto from "node:crypto";

export class InvalidCursorError extends Error {
  constructor(message = "Invalid or tampered cursor") {
    super(message);
    this.name = "InvalidCursorError";
    this.code = "invalid_cursor";
  }
}

export class CursorFilterMismatchError extends Error {
  constructor(message = "Cursor filter parameters do not match current request filters") {
    super(message);
    this.name = "CursorFilterMismatchError";
    this.code = "cursor_filter_mismatch";
  }
}

/**
 * Deterministically hash active filter parameters.
 * Excludes pagination metadata: limit, cursor, after, before, offset, page, count.
 */
export function hashFilters(filters = {}) {
  const IGNORED_KEYS = new Set(["limit", "cursor", "after", "before", "offset", "page", "count", "after_seq"]);

  const normalized = {};
  for (const [key, val] of Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))) {
    if (val !== undefined && val !== null && val !== "" && !IGNORED_KEYS.has(key)) {
      normalized[key] = String(val);
    }
  }

  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

/**
 * Sign payload string using HMAC-SHA256.
 */
function sign(dataStr, secret) {
  return crypto.createHmac("sha256", secret).update(dataStr).digest("base64url");
}

/**
 * Encode an ordering tuple and filter hash into a signed, URL-safe base64 string.
 *
 * @param {Array<any>} tuple - The ordering column values (e.g. [seq] or [created_at, id])
 * @param {string} filterHash - Hash of the request filters
 * @param {string} secret - HMAC secret
 * @param {string} [direction='forward'] - 'forward' or 'backward'
 * @returns {string} URL-safe opaque cursor
 */
export function encodeCursor(tuple, filterHash, secret, direction = "forward") {
  if (!tuple || !Array.isArray(tuple)) {
    throw new Error("Ordering tuple must be an array of values");
  }

  const payload = {
    v: 1,
    t: tuple,
    fh: filterHash || "",
    d: direction === "backward" ? "b" : "f",
  };

  const payloadStr = JSON.stringify(payload);
  const signature = sign(payloadStr, secret);

  const tokenObj = {
    p: payload,
    s: signature,
  };

  return Buffer.from(JSON.stringify(tokenObj), "utf8").toString("base64url");
}

/**
 * Decode and verify an opaque cursor string.
 *
 * @param {string} cursorStr - The base64url cursor string
 * @param {string} currentFilterHash - Expected filter hash of the current request
 * @param {string} secret - HMAC secret
 * @returns {{ tuple: Array<any>, direction: string }} Decoded cursor tuple and direction
 * @throws {InvalidCursorError} If cursor format is invalid or signature does not match
 * @throws {CursorFilterMismatchError} If cursor was created with different filters
 */
export function decodeCursor(cursorStr, currentFilterHash, secret) {
  if (!cursorStr || typeof cursorStr !== "string") {
    throw new InvalidCursorError("Missing cursor parameter");
  }

  let tokenObj;
  try {
    const rawJson = Buffer.from(cursorStr, "base64url").toString("utf8");
    tokenObj = JSON.parse(rawJson);
  } catch {
    throw new InvalidCursorError("Malformed base64/JSON cursor");
  }

  if (!tokenObj || typeof tokenObj !== "object" || !tokenObj.p || !tokenObj.s) {
    throw new InvalidCursorError("Invalid cursor structure");
  }

  const { p: payload, s: signature } = tokenObj;

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.t)) {
    throw new InvalidCursorError("Invalid cursor payload");
  }

  // 1. Timing-safe verify HMAC signature
  const expectedSig = sign(JSON.stringify(payload), secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new InvalidCursorError("Cursor signature verification failed");
  }

  // 2. Verify filter parameters match
  if (currentFilterHash && payload.fh && payload.fh !== currentFilterHash) {
    throw new CursorFilterMismatchError("Cursor filter parameters do not match current request filters");
  }

  return {
    tuple: payload.t,
    direction: payload.d === "b" ? "backward" : "forward",
  };
}

/**
 * Format a standard keyset paginated API response.
 */
export function formatPageResponse({
  data,
  limit: _limit,
  hasExtraRow,
  isBackward = false,
  hasAnchor = false,
  extractTuple,
  filterHash,
  secret,
  total,
  countIsEstimate,
}) {
  let rows = [...data];

  if (isBackward) {
    rows.reverse();
  }

  const hasMore = hasExtraRow;
  if (hasMore) {
    if (isBackward) {
      rows.shift();
    } else {
      rows.pop();
    }
  }

  const hasNext = rows.length === 0 ? false : isBackward ? true : hasMore;
  const hasPrevious = rows.length === 0 ? false : isBackward ? hasMore : Boolean(hasAnchor);

  let startCursor = null;
  let endCursor = null;

  if (rows.length > 0) {
    const firstTuple = extractTuple(rows[0]);
    const lastTuple = extractTuple(rows[rows.length - 1]);
    startCursor = encodeCursor(firstTuple, filterHash, secret, "backward");
    endCursor = encodeCursor(lastTuple, filterHash, secret, "forward");
  }

  const response = {
    data: rows,
    page_info: {
      has_next: hasNext,
      has_previous: hasPrevious,
      start_cursor: startCursor,
      end_cursor: endCursor,
    },
    next_cursor: hasNext ? endCursor : null,
  };

  if (total !== undefined) {
    response.total = total;
  }
  if (countIsEstimate !== undefined) {
    response.count_is_estimate = countIsEstimate;
  }

  return response;
}
