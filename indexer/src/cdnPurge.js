import { logger } from "./logger.js";
import { safeFetch } from "./safeHttp.js";
/**
 * CDN surrogate-key purging (#905).
 *
 * The daemon enqueues the surrogate keys touched by each committed ledger
 * (`latest`, `contract:<id>`, and `ledger:<n>` on reorg). Keys are batched and
 * debounced, then purged through a CDN-agnostic adapter:
 *
 *   CDN_PROVIDER=fastly      FASTLY_API_TOKEN, FASTLY_SERVICE_ID
 *   CDN_PROVIDER=cloudflare  CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID (Cache-Tag purge)
 *   CDN_PROVIDER=http        CDN_PURGE_URL — POSTs {"keys": [...]}; use it for
 *                            Varnish (xkey), or a function that turns keys into
 *                            CloudFront invalidations
 *   CDN_PROVIDER=none        (default) no-op, for local development
 *
 * If a purge fails, `isPurgeHealthy()` turns false until the next successful
 * purge and edge TTLs fall back to a few seconds (see edgeCachePolicy in
 * cacheLayer.js), so clients never see long-stale "latest" data.
 */

const MAX_KEYS_PER_REQUEST = 256; // Fastly's per-request surrogate-key limit

function createAdapter(env = process.env, fetchImpl = safeFetch) {
  const provider = (env.CDN_PROVIDER || "none").toLowerCase();

  const post = async (url, headers, body) => {
    const res = await fetchImpl(url, { method: "POST", headers, body });
    if (!res.ok) throw new Error(`${provider} purge failed: HTTP ${res.status}`);
  };

  switch (provider) {
    case "fastly":
      return {
        name: provider,
        purge: (keys) =>
          post(
            `https://api.fastly.com/service/${env.FASTLY_SERVICE_ID}/purge`,
            { "Fastly-Key": env.FASTLY_API_TOKEN, "Surrogate-Key": keys.join(" "), Accept: "application/json" },
            undefined,
          ),
      };
    case "cloudflare":
      return {
        name: provider,
        purge: (keys) =>
          post(
            `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`,
            { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
            JSON.stringify({ tags: keys }),
          ),
      };
    case "http":
      return {
        name: provider,
        purge: (keys) =>
          post(env.CDN_PURGE_URL, { "Content-Type": "application/json" }, JSON.stringify({ keys })),
      };
    default:
      return { name: "none", purge: async () => {} };
  }
}

/**
 * Create a batched, debounced purge queue. Exported for tests; the module
 * also exposes a default instance configured from the environment.
 */
export function createPurgeQueue({
  adapter = createAdapter(),
  debounceMs = Number(process.env.CDN_PURGE_DEBOUNCE_MS ?? 250),
} = {}) {
  const pending = new Set();
  let timer = null;
  let healthy = true;
  let inFlight = Promise.resolve();

  async function flush() {
    timer = null;
    if (pending.size === 0) return;
    const keys = [...pending];
    pending.clear();
    for (let i = 0; i < keys.length; i += MAX_KEYS_PER_REQUEST) {
      const batch = keys.slice(i, i + MAX_KEYS_PER_REQUEST);
      try {
        await adapter.purge(batch);
        healthy = true;
      } catch (err) {
        healthy = false;
        logger.warn(`[cdn] purge of ${batch.length} key(s) failed, falling back to short TTLs: ${err.message}`);
      }
    }
  }

  return {
    /** Queue surrogate keys for purging; flushed after `debounceMs`. */
    enqueue(keys) {
      if (adapter.name === "none") return;
      for (const k of keys) pending.add(k);
      if (!timer) {
        timer = setTimeout(() => {
          inFlight = inFlight.then(flush);
        }, debounceMs);
        timer.unref?.();
      }
    },
    /** Flush immediately (tests / shutdown). */
    async flushNow() {
      if (timer) clearTimeout(timer);
      inFlight = inFlight.then(flush);
      await inFlight;
    },
    /** False after a failed purge until the next successful one. */
    isHealthy: () => healthy,
    pendingKeys: () => [...pending],
  };
}

const defaultQueue = createPurgeQueue();

export const enqueuePurge = (keys) => defaultQueue.enqueue(keys);
export const isPurgeHealthy = () => defaultQueue.isHealthy();
export const flushPurges = () => defaultQueue.flushNow();
export { createAdapter };
