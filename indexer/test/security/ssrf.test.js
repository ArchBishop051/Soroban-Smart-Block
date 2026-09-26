// SSRF hardening tests for src/safeHttp.js (#928).
import { test } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import http from "node:http";
import { Resolver } from "node:dns/promises";
import { safeFetch, isBlockedAddress, SsrfError } from "../../src/safeHttp.js";

// Resolver stub: every hostname resolves to the given addresses.
const resolvesTo = (...addresses) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

const BLOCKED_URLS = [
  "http://127.0.0.1/",
  "http://127.1/",
  "http://0.0.0.0/",
  "http://0/",
  "http://2130706433/", // decimal 127.0.0.1
  "http://0x7f000001/", // hex
  "http://0x7f.0.0.1/",
  "http://0177.0.0.1/", // octal
  "http://017700000001/",
  "http://169.254.169.254/latest/meta-data/", // cloud metadata
  "http://0xa9fea9fe/", // hex metadata
  "http://10.0.0.1/",
  "http://172.16.0.1/",
  "http://172.31.255.255/",
  "http://192.168.1.1/",
  "http://100.64.0.1/", // CGNAT
  "http://224.0.0.1/", // multicast
  "http://255.255.255.255/",
  "http://198.18.0.1/",
  "http://[::1]/",
  "http://[::]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::ffff:7f00:1]/",
  "http://[::ffff:169.254.169.254]/",
  "http://[0:0:0:0:0:ffff:127.0.0.1]/",
  "http://[fe80::1]/",
  "http://[fc00::1]/",
  "http://[fd12:3456::1]/",
  "http://[ff02::1]/",
  "http://[64:ff9b::7f00:1]/", // NAT64 → 127.0.0.1
  "http://[2002:7f00:1::]/", // 6to4 → 127.0.0.1
  "http://[2002:a9fe:a9fe::]/", // 6to4 → metadata
  "http://localhost/",
  "http://LOCALHOST./",
  "http://foo.localhost/",
  "http://printer.local/",
  "http://metadata.google.internal/",
  "http://user:pass@example.com/",
  "file:///etc/passwd",
  "gopher://127.0.0.1:6379/_INFO",
  "ftp://example.com/",
  "dict://127.0.0.1:11211/",
  "not a url",
];

for (const url of BLOCKED_URLS) {
  test(`blocks ${url}`, async () => {
    await assert.rejects(safeFetch(url, { lookup: resolvesTo("93.184.216.34") }), SsrfError);
  });
}

test("blocks hostnames resolving to a private address", async () => {
  await assert.rejects(safeFetch("http://evil.example/", { lookup: resolvesTo("10.1.2.3") }), /private/);
});

test("blocks hostnames where any one of several answers is private", async () => {
  await assert.rejects(safeFetch("http://evil.example/", { lookup: resolvesTo("93.184.216.34", "127.0.0.1") }), /private/);
});

test("blocks hostnames resolving to an IPv4-mapped IPv6 loopback", async () => {
  await assert.rejects(safeFetch("http://evil.example/", { lookup: resolvesTo("::ffff:127.0.0.1") }), /private/);
});

test("requires https in production", async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(safeFetch("http://example.com/", { lookup: resolvesTo("93.184.216.34") }), /https/);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("enforces per-purpose host allow-list", async () => {
  await assert.rejects(
    safeFetch("https://evil.example/", { allowedHosts: ["api.github.com"], lookup: resolvesTo("93.184.216.34") }),
    /not allowed/,
  );
});

test("allows public IPv4 and IPv6 addresses", () => {
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

// ── Live local server tests (allowPrivate lets us reach 127.0.0.1) ────────────

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(server.address().port);
  } finally {
    server.close();
  }
}

test("does not follow redirects by default", async () => {
  await withServer(
    (_req, res) => { res.writeHead(302, { location: "http://169.254.169.254/" }); res.end(); },
    async (port) => {
      const res = await safeFetch(`http://127.0.0.1:${port}/`, { allowPrivate: true });
      assert.equal(res.status, 302);
    },
  );
});

test("re-validates each redirect hop", async () => {
  await withServer(
    (_req, res) => { res.writeHead(302, { location: "http://evil.example/" }); res.end(); },
    async (port) => {
      // First hop is on the allow-list; the redirect target is not.
      await assert.rejects(
        safeFetch(`http://127.0.0.1:${port}/`, { allowPrivate: true, maxRedirects: 3, allowedHosts: ["127.0.0.1"] }),
        /not allowed/,
      );
    },
  );
});

test("enforces response size limit", async () => {
  await withServer(
    (_req, res) => { res.end("x".repeat(2048)); },
    async (port) => {
      await assert.rejects(safeFetch(`http://127.0.0.1:${port}/`, { allowPrivate: true, maxBytes: 1024 }), /exceeds/);
    },
  );
});

test("enforces time limit", async () => {
  await withServer(
    () => {},
    async (port) => {
      await assert.rejects(safeFetch(`http://127.0.0.1:${port}/`, { allowPrivate: true, timeoutMs: 200 }));
    },
  );
});

test("enforces expected content-type", async () => {
  await withServer(
    (_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html>"); },
    async (port) => {
      await assert.rejects(
        safeFetch(`http://127.0.0.1:${port}/`, { allowPrivate: true, expectContentType: "application/json" }),
        /content-type/,
      );
    },
  );
});

// ── DNS rebinding: a local DNS server that flips its answer ───────────────────

/** Minimal UDP DNS server answering every A query with answers[n] (n = query count). */
async function startFlippingDns(answers) {
  const sock = dgram.createSocket("udp4");
  let n = 0;
  sock.on("message", (msg, rinfo) => {
    let off = 12;
    while (msg[off] !== 0) off += msg[off] + 1;
    const question = msg.subarray(12, off + 5);
    const ip = answers[Math.min(n++, answers.length - 1)].split(".").map(Number);
    const header = Buffer.from([msg[0], msg[1], 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]);
    const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4, ...ip]);
    sock.send(Buffer.concat([header, question, answer]), rinfo.port, rinfo.address);
  });
  await new Promise((r) => sock.bind(0, "127.0.0.1", r));
  return { sock, port: sock.address().port, count: () => n };
}

function lookupVia(dnsPort) {
  const resolver = new Resolver();
  resolver.setServers([`127.0.0.1:${dnsPort}`]);
  return async (host) => (await resolver.resolve4(host)).map((address) => ({ address, family: 4 }));
}

test("rebinding: connection is pinned to the validated address (flip happens after check)", async () => {
  // Answer 1 is what gets validated; later answers would redirect to metadata.
  const dns = await startFlippingDns(["127.0.0.1", "169.254.169.254"]);
  try {
    await withServer(
      (_req, res) => res.end("pinned"),
      async (port) => {
        const res = await safeFetch(`http://rebind.test:${port}/`, { allowPrivate: true, lookup: lookupVia(dns.port) });
        assert.equal(await res.text(), "pinned");
        assert.equal(dns.count(), 1, "DNS must be resolved exactly once per request");
      },
    );
  } finally {
    dns.sock.close();
  }
});

test("rebinding: private answer on the validation lookup is blocked", async () => {
  const dns = await startFlippingDns(["169.254.169.254", "93.184.216.34"]);
  try {
    await assert.rejects(safeFetch("http://rebind.test/", { lookup: lookupVia(dns.port) }), /private/);
  } finally {
    dns.sock.close();
  }
});
