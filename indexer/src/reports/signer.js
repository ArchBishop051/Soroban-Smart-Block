import crypto from "node:crypto";

/**
 * Report Signing and Canonical Hashing
 * Issue #805: Certified, verifiable audit reports for Soroban contracts and events.
 */

export const DEFAULT_REPORT_SECRET =
  process.env.REPORT_SIGNING_KEY || "soroban-explorer-audit-report-secret-key-v1";

/**
 * Recursively canonicalizes data into a deterministic JSON representation
 * with alphabetically sorted keys and consistent primitive formatting.
 */
export function canonicalize(obj) {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(canonicalize);
  }
  const sortedKeys = Object.keys(obj).sort();
  const result = {};
  for (const key of sortedKeys) {
    result[key] = canonicalize(obj[key]);
  }
  return result;
}

/**
 * Computes the SHA-256 digest of canonicalized report data.
 * @param {object} data
 * @returns {string} 64-char hex string
 */
export function computeReportHash(data) {
  const canonical = canonicalize(data);
  const jsonString = JSON.stringify(canonical);
  return crypto.createHash("sha256").update(jsonString, "utf8").digest("hex");
}

/**
 * Generates an HMAC-SHA256 detached signature over the report hash.
 * @param {string} reportHash 64-char hex string
 * @param {string} [secret] optional signing key
 * @returns {string} 64-char hex signature
 */
export function signReportHash(reportHash, secret = DEFAULT_REPORT_SECRET) {
  return crypto.createHmac("sha256", secret).update(reportHash, "utf8").digest("hex");
}

/**
 * Verifies a report's data against a provided hash and signature.
 * @param {object} data original report payload
 * @param {string} expectedHash
 * @param {string} signature
 * @param {string} [secret]
 * @returns {{ valid: boolean, calculatedHash: string, signatureValid: boolean, reason?: string }}
 */
export function verifyReport(data, expectedHash, signature, secret = DEFAULT_REPORT_SECRET) {
  const calculatedHash = computeReportHash(data);
  const hashMatches = calculatedHash.toLowerCase() === (expectedHash || "").toLowerCase();
  
  if (!hashMatches) {
    return {
      valid: false,
      calculatedHash,
      signatureValid: false,
      reason: "Calculated data hash does not match expected report hash (data was altered).",
    };
  }

  const expectedSignature = signReportHash(calculatedHash, secret);
  const signatureValid =
    expectedSignature.toLowerCase() === (signature || "").toLowerCase();

  if (!signatureValid) {
    return {
      valid: false,
      calculatedHash,
      signatureValid: false,
      reason: "Report signature is invalid for the provided signing key.",
    };
  }

  return {
    valid: true,
    calculatedHash,
    signatureValid: true,
  };
}
