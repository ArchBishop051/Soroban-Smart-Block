import { DeterministicPdfWriter } from "./pdfWriter.js";
import { computeReportHash, signReportHash } from "./signer.js";

/**
 * Extracts and canonicalizes contract metadata for deterministic report hashing.
 */
export function extractCanonicalContractData(contract) {
  return {
    id: contract.id || null,
    name: contract.name || null,
    description: contract.description || null,
    registered_by: contract.registered_by || null,
    protocol_type: contract.protocol_type || null,
    version: contract.version !== undefined && contract.version !== null ? Number(contract.version) : null,
    abi_version: contract.abi_version !== undefined && contract.abi_version !== null ? Number(contract.abi_version) : null,
    min_ledger: contract.min_ledger !== undefined && contract.min_ledger !== null ? Number(contract.min_ledger) : null,
    functions: Array.isArray(contract.functions)
      ? contract.functions.map((fn) => ({
          name: fn.name || null,
          description: fn.description || null,
          args: Array.isArray(fn.args)
            ? fn.args.map((a) => ({
                name: a.name || null,
                type: a.type || null,
              }))
            : [],
        }))
      : [],
  };
}

/**
 * Generates a deterministic signed PDF report for a smart contract.
 */
export function generateContractReportPdf(contract, { baseUrl = "https://soroban-explorer.stellar.org", secret } = {}) {
  const canonicalData = extractCanonicalContractData(contract);
  const verificationHash = computeReportHash(canonicalData);
  const signature = signReportHash(verificationHash, secret);
  const permalink = `${baseUrl}/contract/${canonicalData.id}`;

  const writer = new DeterministicPdfWriter({
    title: `Contract Audit Report: ${canonicalData.name || canonicalData.id || "Contract"}`,
    subtitle: "Soroban Smart Block Explorer — Smart Contract Audit",
    timestamp: "2026-01-01T00:00:00Z",
    verificationHash,
    signature,
    permalink,
  });

  // Section 1: Contract Identification
  writer.drawSectionTitle("Contract Metadata");
  writer.drawKeyValue("Contract Address", canonicalData.id || "—", { mono: true, highlight: true });
  writer.drawKeyValue("Registered Name", canonicalData.name || "—");
  writer.drawKeyValue("Description", canonicalData.description || "—");
  writer.drawKeyValue("Protocol Type", canonicalData.protocol_type || "Standard");
  writer.drawKeyValue("Registered By", canonicalData.registered_by || "—", { mono: true });
  writer.drawKeyValue("ABI Version (#844)", canonicalData.abi_version !== null ? `v${canonicalData.abi_version}` : "—");
  writer.drawKeyValue("Minimum Ledger", canonicalData.min_ledger !== null ? canonicalData.min_ledger.toLocaleString() : "—");

  // Section 2: Exported Functions Specification
  writer.drawSectionTitle(`Exported Interface (${canonicalData.functions.length} function${canonicalData.functions.length === 1 ? "" : "s"})`);

  if (canonicalData.functions.length > 0) {
    const fnRows = canonicalData.functions.map((fn) => {
      const argsList = (fn.args || []).map((a) => `${a.name || "arg"}: ${a.type || "any"}`).join(", ");
      return [fn.name || "—", argsList || "void", fn.description || "—"];
    });
    writer.drawTable(["Function", "Parameters", "Description"], fnRows, [140, 220, 155]);
  } else {
    writer.drawKeyValue("Functions", "— (No ABI functions registered)");
  }

  // Section 3: Verification Box
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
