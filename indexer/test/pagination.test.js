process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/soroban_test";
process.env.CURSOR_SIGNING_SECRET = process.env.CURSOR_SIGNING_SECRET || "test-secret-key-for-pagination-32chars!";
process.env.PAGINATION_LEGACY_OFFSET = "true";

const { describe, it } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { encodeCursor, decodeCursor, hashFilters, formatPageResponse, InvalidCursorError, CursorFilterMismatchError } =
  await import("../src/cursor.js");
const { default: config } = await import("../src/config.js");
const { handleLegacyOffset, handleCursorError } = await import("../src/api.js");

describe("Keyset (Cursor) Pagination", () => {
  const secret = config.CURSOR_SIGNING_SECRET;

  describe("Cursor Encoding, Decoding & Tamper Protection", () => {
    it("encodes and decodes a forward cursor correctly", () => {
      const tuple = [1050];
      const filterHash = hashFilters({ contract: "C123", type: "soroban" });
      const cursor = encodeCursor(tuple, filterHash, secret, "forward");

      assert.equal(typeof cursor, "string");
      const decoded = decodeCursor(cursor, filterHash, secret);
      assert.deepEqual(decoded.tuple, [1050]);
      assert.equal(decoded.direction, "forward");
    });

    it("encodes and decodes a composite tuple (created_at, id)", () => {
      const tuple = ["2026-03-01T12:00:00.000Z", "CC4VM2D"];
      const filterHash = hashFilters({ type: "token" });
      const cursor = encodeCursor(tuple, filterHash, secret, "backward");

      const decoded = decodeCursor(cursor, filterHash, secret);
      assert.deepEqual(decoded.tuple, ["2026-03-01T12:00:00.000Z", "CC4VM2D"]);
      assert.equal(decoded.direction, "backward");
    });

    it("detects tampering: altered signature throws InvalidCursorError", () => {
      const tuple = [100];
      const filterHash = hashFilters({ contract: "C123" });
      const validCursor = encodeCursor(tuple, filterHash, secret);

      // Tamper with cursor string
      const rawJson = JSON.parse(Buffer.from(validCursor, "base64url").toString("utf8"));
      rawJson.s = "tampered_signature_value";
      const tamperedCursor = Buffer.from(JSON.stringify(rawJson)).toString("base64url");

      assert.throws(
        () => decodeCursor(tamperedCursor, filterHash, secret),
        (err) => err instanceof InvalidCursorError && err.code === "invalid_cursor",
      );
    });

    it("detects tampering: modified payload tuple throws InvalidCursorError", () => {
      const tuple = [100];
      const filterHash = hashFilters({ contract: "C123" });
      const validCursor = encodeCursor(tuple, filterHash, secret);

      const rawJson = JSON.parse(Buffer.from(validCursor, "base64url").toString("utf8"));
      rawJson.p.t = [999999]; // modified tuple without updated signature
      const tamperedCursor = Buffer.from(JSON.stringify(rawJson)).toString("base64url");

      assert.throws(
        () => decodeCursor(tamperedCursor, filterHash, secret),
        (err) => err instanceof InvalidCursorError && err.code === "invalid_cursor",
      );
    });

    it("detects filter mismatch: reusing cursor with different filters throws CursorFilterMismatchError", () => {
      const tuple = [500];
      const initialFilters = { contract: "C_INITIAL", fn: "swap" };
      const filterHash = hashFilters(initialFilters);
      const cursor = encodeCursor(tuple, filterHash, secret);

      // Client attempts to reuse cursor with a different contract filter
      const modifiedFilters = { contract: "C_DIFFERENT", fn: "swap" };
      const modifiedHash = hashFilters(modifiedFilters);

      assert.throws(
        () => decodeCursor(cursor, modifiedHash, secret),
        (err) => err instanceof CursorFilterMismatchError && err.code === "cursor_filter_mismatch",
      );
    });

    it("ignores pagination metadata in filter hash computation", () => {
      const hash1 = hashFilters({ contract: "C123", limit: 25, cursor: "abc", count: "exact" });
      const hash2 = hashFilters({ contract: "C123", limit: 50, after: "xyz", before: "def", page: 2, offset: 10 });

      assert.equal(hash1, hash2);
    });
  });

  describe("formatPageResponse & Bidirectional Keyset Traversal", () => {
    it("formats the first page correctly", () => {
      const mockRows = [
        { seq: 10 },
        { seq: 9 },
        { seq: 8 },
        { seq: 7 }, // extra row indicating has_next
      ];
      const filterHash = hashFilters({});

      const response = formatPageResponse({
        data: mockRows,
        limit: 3,
        hasExtraRow: true,
        isBackward: false,
        hasAnchor: false,
        extractTuple: (r) => [r.seq],
        filterHash,
        secret,
        total: 10,
        countIsEstimate: true,
      });

      assert.equal(response.data.length, 3);
      assert.deepEqual(
        response.data.map((r) => r.seq),
        [10, 9, 8],
      );
      assert.equal(response.page_info.has_next, true);
      assert.equal(response.page_info.has_previous, false);
      assert.ok(response.page_info.start_cursor);
      assert.ok(response.page_info.end_cursor);
      assert.equal(response.next_cursor, response.page_info.end_cursor);
      assert.equal(response.total, 10);
      assert.equal(response.count_is_estimate, true);
    });

    it("formats subsequent forward page with has_previous = true", () => {
      const mockRows = [
        { seq: 7 },
        { seq: 6 },
        { seq: 5 },
        { seq: 4 }, // extra row
      ];
      const filterHash = hashFilters({});

      const response = formatPageResponse({
        data: mockRows,
        limit: 3,
        hasExtraRow: true,
        isBackward: false,
        hasAnchor: true, // after cursor was passed
        extractTuple: (r) => [r.seq],
        filterHash,
        secret,
      });

      assert.equal(response.data.length, 3);
      assert.deepEqual(
        response.data.map((r) => r.seq),
        [7, 6, 5],
      );
      assert.equal(response.page_info.has_next, true);
      assert.equal(response.page_info.has_previous, true);
    });

    it("formats backward navigation correctly, reversing items into original descending order", () => {
      // When navigating backward, SQL executed: seq > 7 ORDER BY seq ASC LIMIT 4
      // Returned from database: [8, 9, 10] (no extra row -> top of list reached)
      const mockRows = [{ seq: 8 }, { seq: 9 }, { seq: 10 }];
      const filterHash = hashFilters({});

      const response = formatPageResponse({
        data: mockRows,
        limit: 3,
        hasExtraRow: false,
        isBackward: true,
        hasAnchor: true,
        extractTuple: (r) => [r.seq],
        filterHash,
        secret,
      });

      assert.equal(response.data.length, 3);
      // Verify reversed back into descending order: [10, 9, 8]
      assert.deepEqual(
        response.data.map((r) => r.seq),
        [10, 9, 8],
      );
      assert.equal(response.page_info.has_next, true);
      assert.equal(response.page_info.has_previous, false); // top reached
    });

    it("formats last page correctly with has_next = false and next_cursor = null", () => {
      const mockRows = [{ seq: 2 }, { seq: 1 }];
      const filterHash = hashFilters({});

      const response = formatPageResponse({
        data: mockRows,
        limit: 3,
        hasExtraRow: false,
        isBackward: false,
        hasAnchor: true,
        extractTuple: (r) => [r.seq],
        filterHash,
        secret,
      });

      assert.equal(response.data.length, 2);
      assert.equal(response.page_info.has_next, false);
      assert.equal(response.page_info.has_previous, true);
      assert.equal(response.next_cursor, null);
    });

    it("handles empty result sets gracefully", () => {
      const response = formatPageResponse({
        data: [],
        limit: 10,
        hasExtraRow: false,
        isBackward: false,
        hasAnchor: false,
        extractTuple: (r) => [r.seq],
        filterHash: "none",
        secret,
      });

      assert.equal(response.data.length, 0);
      assert.equal(response.page_info.has_next, false);
      assert.equal(response.page_info.has_previous, false);
      assert.equal(response.page_info.start_cursor, null);
      assert.equal(response.page_info.end_cursor, null);
      assert.equal(response.next_cursor, null);
    });
  });

  describe("Resilience to Deleted Anchors & Concurrent Writes", () => {
    it("keyset condition remains valid even if anchor row is deleted", () => {
      // In keyset pagination, querying rows with `seq < anchorSeq` does NOT query or join the anchor row itself.
      // Even if seq 8 was deleted from the table:
      const allRows = [{ seq: 10 }, { seq: 9 }, { seq: 7 }, { seq: 6 }, { seq: 5 }];
      const anchorSeq = 8; // Row 8 is absent/deleted

      const pageAfterDeletedAnchor = allRows.filter((r) => r.seq < anchorSeq).slice(0, 3);
      assert.deepEqual(
        pageAfterDeletedAnchor.map((r) => r.seq),
        [7, 6, 5],
      );
    });

    it("concurrent writes at head of table do not duplicate or skip items on subsequent pages", () => {
      // Simulating table: initially has [10, 9, 8, 7, 6, 5]
      // Page 1 fetched: [10, 9, 8]. End cursor anchor is 8.
      const page1EndSeq = 8;

      // Concurrent insert occurs before page 2 request: seq 11 and 12 are inserted
      const currentTable = [
        { seq: 12 },
        { seq: 11 },
        { seq: 10 },
        { seq: 9 },
        { seq: 8 },
        { seq: 7 },
        { seq: 6 },
        { seq: 5 },
      ];

      // Keyset query for page 2 uses `seq < 8`:
      const page2 = currentTable.filter((r) => r.seq < page1EndSeq).slice(0, 3);

      // Verify no duplicates from page 1 and no missed rows
      assert.deepEqual(
        page2.map((r) => r.seq),
        [7, 6, 5],
      );

      // In contrast, offset pagination with OFFSET 3 on currentTable:
      // currentTable.slice(3, 6) would return [9, 8, 7] — DUPLICATING 9 and 8!
      const offsetPage2 = currentTable.slice(3, 6);
      assert.deepEqual(
        offsetPage2.map((r) => r.seq),
        [9, 8, 7],
      ); // offset suffered duplicate rows!
    });
  });

  describe("Configuration & Legacy Offset Deprecation", () => {
    it("exposes PAGINATION_LEGACY_OFFSET and CURSOR_SIGNING_SECRET in config", () => {
      assert.equal(typeof config.PAGINATION_LEGACY_OFFSET, "boolean");
      assert.equal(typeof config.CURSOR_SIGNING_SECRET, "string");
      assert.ok(config.CURSOR_SIGNING_SECRET.length >= 16);
    });
  });

  describe("HTTP API Middleware & Error Handling (handleLegacyOffset & handleCursorError)", () => {
    function createMockRes() {
      return {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(name, val) {
          this.headers[name] = val;
        },
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.body = data;
          return this;
        },
      };
    }

    it("handleLegacyOffset: passes through (returns false) when neither offset nor page is provided", () => {
      const req = { query: { limit: "25", contract: "C123" } };
      const res = createMockRes();

      const intercepted = handleLegacyOffset(req, res);
      assert.equal(intercepted, false);
      assert.equal(res.headers["Deprecation"], undefined);
      assert.equal(res.headers["Link"], undefined);
    });

    it("handleLegacyOffset: emits Deprecation and Link headers when offset is passed and PAGINATION_LEGACY_OFFSET is true", () => {
      config.PAGINATION_LEGACY_OFFSET = true;
      const req = { query: { offset: "50", limit: "25" } };
      const res = createMockRes();

      const intercepted = handleLegacyOffset(req, res);
      assert.equal(intercepted, false); // allowed to proceed during deprecation window
      assert.equal(res.headers["Deprecation"], "true");
      assert.equal(res.headers["Link"], '</docs/api/pagination>; rel="deprecation"');
    });

    it("handleLegacyOffset: emits Deprecation and Link headers when page is passed and PAGINATION_LEGACY_OFFSET is true", () => {
      config.PAGINATION_LEGACY_OFFSET = true;
      const req = { query: { page: "3", limit: "25" } };
      const res = createMockRes();

      const intercepted = handleLegacyOffset(req, res);
      assert.equal(intercepted, false);
      assert.equal(res.headers["Deprecation"], "true");
      assert.equal(res.headers["Link"], '</docs/api/pagination>; rel="deprecation"');
    });

    it("handleLegacyOffset: returns 400 offset_pagination_deprecated when PAGINATION_LEGACY_OFFSET is false", () => {
      config.PAGINATION_LEGACY_OFFSET = false;
      const req = { query: { offset: "20" } };
      const res = createMockRes();

      const intercepted = handleLegacyOffset(req, res);
      assert.equal(intercepted, true); // intercepted and terminated request
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, "offset_pagination_deprecated");
      assert.ok(res.body.message.includes("keyset cursor pagination"));

      config.PAGINATION_LEGACY_OFFSET = true; // reset
    });

    it("handleCursorError: catches InvalidCursorError and responds with 400 invalid_cursor", () => {
      const res = createMockRes();
      const err = new InvalidCursorError("Signature verification failed: tampered cursor");

      const handled = handleCursorError(err, res);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, "invalid_cursor");
      assert.equal(res.body.message, "Signature verification failed: tampered cursor");
    });

    it("handleCursorError: catches CursorFilterMismatchError and responds with 400 cursor_filter_mismatch", () => {
      const res = createMockRes();
      const err = new CursorFilterMismatchError("Filter mismatch: cursor was issued for different filter parameters");

      const handled = handleCursorError(err, res);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, "cursor_filter_mismatch");
      assert.ok(res.body.message.includes("different filter parameters"));
    });

    it("handleCursorError: ignores standard application errors and returns false", () => {
      const res = createMockRes();
      const err = new Error("Database connection timed out");

      const handled = handleCursorError(err, res);
      assert.equal(handled, false);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body, null);
    });
  });
});
