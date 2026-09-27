import { gunzipSync, brotliDecompressSync, unzipSync } from 'node:zlib';
import { safeFetch } from '../safeHttp.js';

// DATALAKE_URL is operator-configured and may be a private bucket endpoint.
const defaultFetch = (url) => safeFetch(url, { allowPrivate: true, maxBytes: 512 * 1024 * 1024, timeoutMs: 120_000 });

/**
 * Reads Galexie/CDP LedgerCloseMeta exports. Parsing is injected so the
 * source remains independent of a particular SDK XDR version and tests can
 * use deterministic JSON fixtures. `decodeBatch` receives one decompressed
 * file and returns `{ ledgers: [{ sequence, events, txResults, stateChanges }] }`.
 */
export class DataLakeSource {
  constructor({ baseUrl, schema = { ledgersPerFile: 1, filesPerPartition: 1000 }, fetchImpl = defaultFetch, decodeBatch, decompress = defaultDecompress } = {}) {
    if (!baseUrl) throw new Error('DATALAKE_URL is required');
    if (typeof decodeBatch !== 'function') throw new Error('decodeBatch is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.schema = schema;
    this.fetch = fetchImpl;
    this.decodeBatch = decodeBatch;
    this.decompress = decompress;
  }

  fileUrl(ledger) {
    const file = Math.floor(ledger / this.schema.ledgersPerFile);
    const partition = Math.floor(file / this.schema.filesPerPartition);
    return `${this.baseUrl}/${partition}/${file}.xdr.zst`;
  }

  async readRange(from, to) {
    const bySequence = new Map();
    const first = Math.floor(from / this.schema.ledgersPerFile);
    const last = Math.floor(to / this.schema.ledgersPerFile);
    for (let file = first; file <= last; file += 1) {
      const url = this.fileUrl(file * this.schema.ledgersPerFile);
      const response = await this.fetch(url);
      if (!response.ok) {
        const error = new Error(`data lake file missing: ${url}`);
        error.code = 'GAP';
        error.from = from;
        error.to = to;
        throw error;
      }
      const raw = Buffer.from(await response.arrayBuffer());
      const batch = await this.decodeBatch(await this.decompress(raw), { url, from, to });
      for (const ledger of batch.ledgers || []) {
        if (ledger.sequence >= from && ledger.sequence <= to) bySequence.set(ledger.sequence, ledger);
      }
    }
    return { ledgers: [...bySequence.values()].sort((a, b) => a.sequence - b.sequence), events: [...bySequence.values()].flatMap((l) => l.events || []) };
  }
}

function defaultDecompress(buffer) {
  // Fixtures may be plain JSON/gzip/brotli. zstd decoding is supplied by the
  // deployment's decoder adapter because Node versions differ in zstd support.
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) return gunzipSync(buffer);
  if (buffer[0] === 0xce && buffer[1] === 0xb2) return brotliDecompressSync(buffer);
  try { return unzipSync(buffer); } catch { return buffer; }
}

export default DataLakeSource;
