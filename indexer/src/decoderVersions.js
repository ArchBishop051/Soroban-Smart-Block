/**
 * Decoder versioning (#899).
 *
 * Every decoder path declares a semantic version; each decoded row stores
 * `decoder_id@version` (events.decoder_version). Bump a version whenever the
 * decoder's output changes — the golden snapshot test (test/golden) fails if
 * output changes without a bump. After deploy, reDecodeWorker re-decodes rows
 * whose tag no longer matches (in the background, throttled), keeping the
 * previous output in decoded_history. Rolling a version back re-decodes the
 * rows again. Rows from a decoder that no longer exists are marked
 * decoder_retired instead of being re-decoded.
 */

export const DECODER_VERSIONS = Object.freeze({
  "native-sac": "1.0.0",
  stellarswap: "1.0.0",
  blend: "1.0.0",
  "smart-wallet": "1.0.0",
  openzeppelin: "1.0.0",
  abi: "1.0.0",
  classic: "1.0.0",
});

export function decoderTag(id) {
  const version = DECODER_VERSIONS[id];
  if (!version) throw new Error(`unknown decoder: ${id}`);
  return `${id}@${version}`;
}

/** All current tags; rows with any other tag are outdated or retired. */
export const CURRENT_DECODER_TAGS = Object.freeze(Object.keys(DECODER_VERSIONS).map(decoderTag));

/** "id@version" → { id, version }, or null. */
export function parseDecoderTag(tag) {
  const m = /^([a-z0-9-]+)@(\d+\.\d+\.\d+)$/.exec(String(tag ?? ""));
  return m ? { id: m[1], version: m[2] } : null;
}

/** "current" | "outdated" (re-decode) | "retired" (decoder removed) | "untagged". */
export function decoderStatus(tag) {
  const parsed = parseDecoderTag(tag);
  if (!parsed) return "untagged";
  if (!(parsed.id in DECODER_VERSIONS)) return "retired";
  return DECODER_VERSIONS[parsed.id] === parsed.version ? "current" : "outdated";
}
