import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  extractCanonicalEventData,
  generateEventReportPdf,
  generateBatchEventsReportPdf,
} from "../src/reports/eventReport.js";
import {
  extractCanonicalContractData,
  generateContractReportPdf,
} from "../src/reports/contractReport.js";
import {
  canonicalize,
  computeReportHash,
  signReportHash,
  verifyReport,
} from "../src/reports/signer.js";

describe("Certified PDF Reports & Verification Suite (Issue #805)", () => {
  const SAMPLE_EVENT = {
    seq: 1042,
    ledger: 543210,
    contract_id: "CAAA1111222233334444555566667777888899990000AAAABBBBCCCCDD",
    tx_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    function: "transfer",
    is_clawback: false,
    is_reorg: false,
    created_at: "2026-03-15T14:30:00Z",
    raw_topics: ["AAAADwAAAAl0cmFuc2Zlcg==", "AAAAAQAAAAAAAAAAAAAA"],
    heuristic_params: {
      from: "GBBB1111222233334444555566667777888899990000AAAABBBBCCCCDD",
      to: "GCCC1111222233334444555566667777888899990000AAAABBBBCCCCDD",
      amount: "1500000000",
    },
    sub_invocations: [
      {
        depth: 0,
        contract_id: "CAAA1111222233334444555566667777888899990000AAAABBBBCCCCDD",
        function: "transfer",
        args: [{ amount: "1500000000" }],
      },
      {
        depth: 1,
        contract_id: "CTOKEN1111222233334444555566667777888899990000AAAABBBBCCCCDD",
        function: "debit",
        args: [{ amount: "1500000000" }],
      },
    ],
  };

  it("produces identical bytes when generating PDF for the same event twice (byte determinism)", () => {
    const report1 = generateEventReportPdf(SAMPLE_EVENT);
    const report2 = generateEventReportPdf(SAMPLE_EVENT);

    const hash1 = crypto.createHash("sha256").update(report1.buffer).digest("hex");
    const hash2 = crypto.createHash("sha256").update(report2.buffer).digest("hex");

    assert.equal(
      hash1,
      hash2,
      "Expected identical SHA-256 byte hashes for repeated PDF generation"
    );
    assert.deepEqual(
      report1.buffer,
      report2.buffer,
      "Expected byte-identical buffers for repeated PDF generation"
    );
  });

  it("verification footer hash matches an independent recomputation from canonical API data", () => {
    const report = generateEventReportPdf(SAMPLE_EVENT);
    const independentCanonical = extractCanonicalEventData(SAMPLE_EVENT);
    const recomputedHash = computeReportHash(independentCanonical);

    assert.equal(
      report.verificationHash,
      recomputedHash,
      "Verification hash must match independent recomputation"
    );

    // Verify through the standalone verification function
    const verification = verifyReport(independentCanonical, report.verificationHash, report.signature);
    assert.equal(verification.valid, true);
    assert.equal(verification.signatureValid, true);
  });

  it("tampered data or modified values fail signature verification", () => {
    const report = generateEventReportPdf(SAMPLE_EVENT);

    // Tamper with the event amount
    const tamperedData = extractCanonicalEventData({
      ...SAMPLE_EVENT,
      heuristic_params: {
        ...SAMPLE_EVENT.heuristic_params,
        amount: "9999999999", // Tampered amount
      },
    });

    const verification = verifyReport(tamperedData, report.verificationHash, report.signature);
    assert.equal(verification.valid, false, "Tampered data must fail verification");
    assert.ok(verification.reason.includes("does not match"));
  });

  it("tampered signature fails verification", () => {
    const report = generateEventReportPdf(SAMPLE_EVENT);
    const invalidSignature = report.signature.replace(/^[0-9a-f]/, (c) => (c === "0" ? "1" : "0"));

    const verification = verifyReport(
      report.canonicalData,
      report.verificationHash,
      invalidSignature
    );
    assert.equal(verification.valid, false);
    assert.equal(verification.signatureValid, false);
    assert.ok(verification.reason.includes("signature is invalid"));
  });

  it("renders a 200-sub-invocation event across multiple pages without clipping", () => {
    // Generate 200 sub-invocations with varying depths
    const hugeSubInvocations = [];
    for (let i = 0; i < 200; i++) {
      hugeSubInvocations.push({
        depth: (i % 5),
        contract_id: `CSUB${String(i).padStart(4, "0")}11223344556677889900AAAABBBBCCCCDD`,
        function: `execute_step_${i}`,
        args: [{ step: i, gas_used: 1500 + i * 10 }],
      });
    }

    const largeEvent = {
      ...SAMPLE_EVENT,
      seq: 2000,
      sub_invocations: hugeSubInvocations,
    };

    const report = generateEventReportPdf(largeEvent);
    const pdfString = report.buffer.toString("binary");

    // Must have multiple pages (Page 1 of N, Page 2 of N, etc.)
    assert.ok(pdfString.includes("/Count "), "PDF must define page count");
    assert.ok(pdfString.includes("Page 1 of "), "Must contain page 1 footer");
    assert.ok(pdfString.includes("execute_step_199"), "Last sub-invocation must not be clipped");
    assert.ok(pdfString.includes("execute_step_0"), "First sub-invocation must be present");

    // Extract total pages
    const countMatch = pdfString.match(/\/Count\s+(\d+)/);
    assert.ok(countMatch && Number(countMatch[1]) >= 4, "200 invocations should span at least 4 pages");
  });

  it("clearly marks events superseded by a ledger reorg with warning banner and watermark", () => {
    const reorgEvent = {
      ...SAMPLE_EVENT,
      seq: 3001,
      is_reorg: true,
    };

    const report = generateEventReportPdf(reorgEvent);
    const pdfString = report.buffer.toString("utf8");

    assert.ok(pdfString.includes("SUPERSEDED") && pdfString.includes("REORG"), "Must contain superseded watermark");
    assert.ok(
      pdfString.includes("superseded by a network ledger reorg"),
      "Must render warning banner"
    );
    assert.equal(report.canonicalData.is_reorg, true);
  });

  it("renders missing optional fields as explicit '—' without blank gaps", () => {
    const sparseEvent = {
      seq: 4001,
      ledger: 100,
      contract_id: null,
      tx_hash: null,
      function: null,
      raw_topics: [],
      heuristic_params: null,
      sub_invocations: [],
    };

    const report = generateEventReportPdf(sparseEvent);
    const pdfString = report.buffer.toString("utf8");

    assert.ok(pdfString.includes("—"), "Must render dash for missing fields");
    assert.equal(report.canonicalData.function, null);
  });

  it("passes automated tagged-PDF/accessibility check with /StructTreeRoot and /MarkInfo", () => {
    const report = generateEventReportPdf(SAMPLE_EVENT);
    const pdfString = report.buffer.toString("utf8");

    assert.ok(pdfString.includes("/MarkInfo << /Marked true >>"), "Must contain Marked true flag");
    assert.ok(pdfString.includes("/StructTreeRoot"), "Must contain StructTreeRoot");
    assert.ok(pdfString.includes("/StructElem"), "Must contain StructElem tagged document elements");
  });

  it("generates deterministic contract audit PDF report", () => {
    const contract = {
      id: "CCONTRACT1111222233334444555566667777888899990000AAAABBBBCCCC",
      name: "Stellar Liquidity Pool",
      description: "Automated market maker liquidity pool contract",
      protocol_type: "dex",
      registered_by: "GADMIN1111222233334444555566667777888899990000AAAABBBBCCCC",
      abi_version: 2,
      min_ledger: 100000,
      functions: [
        {
          name: "deposit",
          description: "Deposits token pair liquidity into the pool",
          args: [
            { name: "amount_a", type: "i128" },
            { name: "amount_b", type: "i128" },
          ],
        },
        {
          name: "withdraw",
          description: "Burns LP shares and returns underlying assets",
          args: [{ name: "shares", type: "i128" }],
        },
      ],
    };

    const report1 = generateContractReportPdf(contract);
    const report2 = generateContractReportPdf(contract);
    const pdfString = report1.buffer.toString("utf8");

    assert.deepEqual(report1.buffer, report2.buffer, "Contract reports must be byte-deterministic");
    assert.ok(pdfString.includes("Stellar Liquidity Pool"));
    assert.ok(pdfString.includes("deposit"));
    assert.ok(pdfString.includes("ABI Version") && pdfString.includes("v2"));
  });

  it("generates multi-page batch report for filtered event array", () => {
    const batch = [
      SAMPLE_EVENT,
      { ...SAMPLE_EVENT, seq: 1043, function: "swap" },
      { ...SAMPLE_EVENT, seq: 1044, function: "mint" },
    ];

    const batchReport = generateBatchEventsReportPdf(batch);
    const pdfString = batchReport.buffer.toString("utf8");

    assert.equal(batchReport.eventsCount, 3);
    assert.ok(pdfString.includes("Batch Audit Report") && pdfString.includes("3 Events"));
    assert.ok(pdfString.includes("Event #1042 Details"));
    assert.ok(pdfString.includes("Event #1043 Details"));
    assert.ok(pdfString.includes("Event #1044 Details"));
  });
});
