import { DeterministicPdfWriter } from "./pdfWriter.js";
import { computeReportHash, signReportHash, canonicalize } from "./signer.js";

/**
 * Extracts and canonicalizes event fields for deterministic report hashing.
 */
export function extractCanonicalEventData(event) {
  return {
    seq: Number(event.seq || 0),
    ledger: Number(event.ledger || 0),
    contract_id: event.contract_id || null,
    tx_hash: event.tx_hash || null,
    function: event.function || null,
    type: event.type || (event.contract_id ? "soroban" : "classic"),
    is_clawback: Boolean(event.is_clawback),
    is_reorg: Boolean(event.is_reorg || event.superseded),
    created_at: event.created_at || null,
    raw_topics: Array.isArray(event.raw_topics) ? event.raw_topics : [],
    heuristic_params: event.heuristic_params || null,
    sub_invocations: Array.isArray(event.sub_invocations)
      ? event.sub_invocations.map((sub) => ({
          depth: Number(sub.depth || 0),
          contract_id: sub.contract_id || null,
          function: sub.function || null,
          args: sub.args || null,
        }))
      : [],
  };
}

/**
 * Generates a deterministic, signed PDF report for a single decoded event.
 */
export function generateEventReportPdf(event, { baseUrl = "https://soroban-explorer.stellar.org", secret } = {}) {
  const canonicalData = extractCanonicalEventData(event);
  const verificationHash = computeReportHash(canonicalData);
  const signature = signReportHash(verificationHash, secret);
  const permalink = `${baseUrl}/event/${canonicalData.seq}`;

  const isReorg = canonicalData.is_reorg;
  const watermark = isReorg ? "SUPERSEDED (ledger reorg)" : null;

  const writer = new DeterministicPdfWriter({
    title: `Event Audit Report #${canonicalData.seq}`,
    subtitle: "Soroban Smart Block Explorer — Certified Event Audit",
    timestamp: canonicalData.created_at || "2026-01-01T00:00:00Z",
    verificationHash,
    signature,
    permalink,
    watermark,
  });

  // If reorg, render prominent alert banner
  if (isReorg) {
    writer.drawBanner({
      text: "WARNING: This event was superseded by a network ledger reorg. Historical data preserved for audit trail.",
      type: "danger",
    });
  }

  // Section 1: Event Summary
  writer.drawSectionTitle("Event Specification");
  writer.drawKeyValue("Event Sequence", `#${canonicalData.seq}`, { highlight: true });
  writer.drawKeyValue("Ledger Sequence", canonicalData.ledger.toLocaleString());
  writer.drawKeyValue("Contract Address", canonicalData.contract_id || "Classic (Non-Contract)", { mono: true });
  writer.drawKeyValue("Function Invoked", canonicalData.function || "—", { highlight: true });
  writer.drawKeyValue("Transaction Hash", canonicalData.tx_hash || "—", { mono: true });
  writer.drawKeyValue("Execution Timestamp", canonicalData.created_at || "—");
  writer.drawKeyValue("Execution Status", isReorg ? "SUPERSEDED (REORG)" : "CONFIRMED ON-CHAIN");

  if (canonicalData.is_clawback) {
    writer.drawBanner({
      text: "COMPLIANCE NOTICE: Clawback intervention event detected.",
      type: "warning",
    });
  }

  // Section 2: Parameters & Heuristics
  writer.drawSectionTitle("Decoded Event Parameters & State");
  if (canonicalData.heuristic_params && Object.keys(canonicalData.heuristic_params).length > 0) {
    const rows = Object.entries(canonicalData.heuristic_params).map(([k, v]) => [
      k,
      typeof v === "object" ? JSON.stringify(v) : String(v ?? "—"),
    ]);
    writer.drawTable(["Parameter / Key", "Decoded Value"], rows, [160, 355]);
  } else {
    writer.drawKeyValue("Decoded Parameters", "— (No parameters or unverified ABI)");
  }

  // Section 3: Raw Topics & XDR
  writer.drawSectionTitle("Raw Event Topics (XDR)");
  if (canonicalData.raw_topics.length > 0) {
    const topicRows = canonicalData.raw_topics.map((t, idx) => [`Topic [${idx}]`, t]);
    writer.drawTable(["Topic Index", "Raw Value / Symbol"], topicRows, [120, 395]);
  } else {
    writer.drawKeyValue("Raw Topics", "— (None)");
  }

  // Section 4: Sub-Invocation Call Hierarchy
  writer.drawSubInvocationTree(canonicalData.sub_invocations);

  // Section 5: Verification Box
  writer.drawVerificationBox();

  const buffer = writer.compile();

  return {
    buffer,
    canonicalData,
    verificationHash,
    signature,
    permalink,
  };
}

/**
 * Generates a multi-page batch report for an array of events.
 */
export function generateBatchEventsReportPdf(events, { baseUrl = "https://soroban-explorer.stellar.org", secret } = {}) {
  const boundedEvents = (events || []).slice(0, 100);
  const canonicalList = boundedEvents.map(extractCanonicalEventData);
  const verificationHash = computeReportHash(canonicalList);
  const signature = signReportHash(verificationHash, secret);
  const permalink = `${baseUrl}/search?batch=${verificationHash.slice(0, 12)}`;

  const writer = new DeterministicPdfWriter({
    title: `Batch Audit Report (${boundedEvents.length} Events)`,
    subtitle: "Soroban Smart Block Explorer — Multi-Event Export",
    timestamp: "2026-01-01T00:00:00Z",
    verificationHash,
    signature,
    permalink,
  });

  writer.drawSectionTitle(`Batch Overview (${boundedEvents.length} Records)`);
  const summaryRows = canonicalList.map((e) => [
    `#${e.seq}`,
    String(e.ledger),
    e.contract_id ? `${e.contract_id.slice(0, 8)}…` : "Classic",
    e.function || "—",
    e.is_reorg ? "REORG" : "OK",
  ]);

  writer.drawTable(["Seq", "Ledger", "Contract", "Function", "Status"], summaryRows, [65, 80, 130, 160, 80]);

  // Render detail breakdown for each event
  for (let i = 0; i < canonicalList.length; i++) {
    const ev = canonicalList[i];
    writer.addPage();
    writer.drawSectionTitle(`Event #${ev.seq} Details`);
    writer.drawKeyValue("Ledger", ev.ledger.toLocaleString());
    writer.drawKeyValue("Contract", ev.contract_id || "Classic", { mono: true });
    writer.drawKeyValue("Function", ev.function || "—");
    writer.drawKeyValue("Tx Hash", ev.tx_hash || "—", { mono: true });
    writer.drawKeyValue("Status", ev.is_reorg ? "SUPERSEDED (REORG)" : "CONFIRMED");

    if (ev.sub_invocations && ev.sub_invocations.length > 0) {
      writer.drawSubInvocationTree(ev.sub_invocations);
    }
  }

  writer.drawVerificationBox();

  const buffer = writer.compile();

  return {
    buffer,
    eventsCount: boundedEvents.length,
    verificationHash,
    signature,
    permalink,
  };
}
