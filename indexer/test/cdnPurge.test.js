import { test } from "node:test";
import assert from "node:assert/strict";
import { createPurgeQueue, createAdapter } from "../src/cdnPurge.js";
import { edgeCachePolicy } from "../src/cacheLayer.js";

test("purge queue batches and de-duplicates keys within the debounce window", async () => {
  const calls = [];
  const q = createPurgeQueue({ adapter: { name: "test", purge: async (keys) => calls.push(keys) }, debounceMs: 10_000 });
  q.enqueue(["latest", "contract:A"]);
  q.enqueue(["latest", "contract:B"]);
  await q.flushNow();
  assert.deepEqual(calls, [["latest", "contract:A", "contract:B"]]);
});

test("purge queue splits large purges into 256-key requests", async () => {
  const calls = [];
  const q = createPurgeQueue({ adapter: { name: "test", purge: async (keys) => calls.push(keys.length) }, debounceMs: 10_000 });
  q.enqueue(Array.from({ length: 600 }, (_, i) => `event:${i}`));
  await q.flushNow();
  assert.deepEqual(calls, [256, 256, 88]);
});

test("a failed purge marks the queue unhealthy until the next success", async () => {
  let fail = true;
  const q = createPurgeQueue({
    adapter: { name: "test", purge: async () => { if (fail) throw new Error("outage"); } },
    debounceMs: 10_000,
  });
  q.enqueue(["latest"]);
  await q.flushNow();
  assert.equal(q.isHealthy(), false);
  fail = false;
  q.enqueue(["latest"]);
  await q.flushNow();
  assert.equal(q.isHealthy(), true);
});

test("fastly and cloudflare adapters send surrogate keys / cache tags", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => { requests.push({ url, init }); return { ok: true }; };
  await createAdapter({ CDN_PROVIDER: "fastly", FASTLY_SERVICE_ID: "svc", FASTLY_API_TOKEN: "t" }, fetchImpl).purge(["latest", "contract:A"]);
  await createAdapter({ CDN_PROVIDER: "cloudflare", CLOUDFLARE_ZONE_ID: "z", CLOUDFLARE_API_TOKEN: "t" }, fetchImpl).purge(["latest"]);
  assert.equal(requests[0].url, "https://api.fastly.com/service/svc/purge");
  assert.equal(requests[0].init.headers["Surrogate-Key"], "latest contract:A");
  assert.deepEqual(JSON.parse(requests[1].init.body), { tags: ["latest"] });
  assert.equal(createAdapter({}).name, "none");
});

test("edge policy classifies endpoints", () => {
  assert.deepEqual(edgeCachePolicy({ method: "GET", path: "/api/events/42" }).keys, ["event:42"]);
  assert.equal(edgeCachePolicy({ method: "GET", path: "/api/events/42" }).class, "immutable");
  assert.deepEqual(edgeCachePolicy({ method: "GET", path: "/api/contracts/CABC/abi" }).keys, ["contract:CABC", "latest"]);
  assert.deepEqual(edgeCachePolicy({ method: "GET", path: "/api/events" }).keys, ["latest"]);
  assert.equal(edgeCachePolicy({ method: "GET", path: "/api/admin/keys" }).class, "private");
  assert.equal(edgeCachePolicy({ method: "POST", path: "/api/events" }).edge, "no-store");
});

test("edge policy falls back to short TTLs when purging is failing", () => {
  assert.match(edgeCachePolicy({ method: "GET", path: "/api/events" }, { purgeHealthy: false }).edge, /max-age=5,/);
  assert.match(edgeCachePolicy({ method: "GET", path: "/api/events/1" }, { purgeHealthy: false }).edge, /max-age=5,/);
});
