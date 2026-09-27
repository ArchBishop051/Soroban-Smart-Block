import crypto from "node:crypto";

function bytesOf(wasm) { return Buffer.isBuffer(wasm) ? wasm : wasm instanceof Uint8Array ? Buffer.from(wasm) : Buffer.from(String(wasm).replace(/^0x/, ""), /^[0-9a-f]+$/i.test(String(wasm).replace(/^0x/, "")) ? "hex" : "base64"); }

export function fingerprintWasm(wasm, { wasmHash } = {}) {
  const bytes = bytesOf(wasm);
  const exports = [], imports = [], sectionSizes = [];
  let offset = 8;
  while (offset < bytes.length) {
    const id = bytes[offset++]; let size = 0, shift = 0, b;
    do { b = bytes[offset++]; size |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80 && offset < bytes.length);
    sectionSizes.push({ id, size });
    if (size < 0 || offset + size > bytes.length) break;
    offset += size;
  }
  const body = crypto.createHash("sha256").update(bytes).digest("hex");
  const bits = Buffer.from(body, "hex");
  let simhash = "";
  for (let i = 0; i < 64; i++) simhash += ((bits[Math.floor(i / 8)] >> (i % 8)) & 1).toString();
  return { wasm_hash: wasmHash ?? crypto.createHash("sha256").update(bytes).digest("hex"), exports, imports, section_sizes: sectionSizes, function_body_hash: body, simhash, contract_spec_types: [] };
}

export function similarityScore(a, b) { const x = String(a.simhash ?? ""), y = String(b.simhash ?? ""); if (!x || !y || x.length !== y.length) return 0; let same = 0; for (let i = 0; i < x.length; i++) if (x[i] === y[i]) same++; return same / x.length; }
export function classifyProtocol({ fingerprint, labelled = [], threshold = 0.95 }) { const ranked = labelled.map((item) => ({ ...item, score: similarityScore(fingerprint, item.fingerprint ?? item) })).sort((a, b) => b.score - a.score); const best = ranked[0]; return best && best.score >= threshold ? { protocol_type_inferred: best.protocol_type, confidence: best.score, matched_wasm_hash: best.wasm_hash ?? null } : { protocol_type_inferred: "other", confidence: best?.score ?? 0, matched_wasm_hash: null }; }
