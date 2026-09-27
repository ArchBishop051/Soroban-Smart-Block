/**
 * safeHttp.js — the single hardened HTTP client for all server-side outbound
 * requests (#928). Direct `fetch`/`http.request`/`axios` use elsewhere in
 * src/ is forbidden by the ESLint config.
 *
 * Protections:
 *   - Scheme allow-list (https only in production unless allowHttp is set).
 *   - Optional per-purpose host allow-list (e.g. api.github.com for ABI sync).
 *   - DNS is resolved once; every resolved address is checked against a
 *     deny-list (private, loopback, link-local, CGNAT, multicast, reserved,
 *     IPv6 ULA / IPv4-mapped / NAT64 / 6to4 / Teredo forms). If any answer is
 *     unsafe the request is refused.
 *   - The socket connects to that exact validated IP (lookup pinning), so a
 *     DNS rebinding flip between check and connect cannot take effect.
 *   - No redirects by default; when enabled, every hop is re-validated.
 *   - Response size and total time limits, optional content-type check.
 */

import dns from "dns/promises";
import http from "http";
import https from "https";
import net from "net";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = "SsrfError";
  }
}

// ── Address deny-list ────────────────────────────────────────────────────────

const deny = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local / cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
]) {
  deny.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::", 96], // IPv4-compatible (deprecated)
  ["100::", 64], // discard-only
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
]) {
  deny.addSubnet(addr, prefix, "ipv6");
}

/** Expand an IPv6 address into 8 16-bit groups. */
function ipv6Groups(ip) {
  let s = ip.toLowerCase();
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const o = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  const fill = tail !== undefined ? new Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((g) => parseInt(g, 16));
}

function groupsToIPv4(hi, lo) {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * True when `ip` (a literal IPv4/IPv6 address) must not be contacted.
 * IPv6 forms that embed an IPv4 address are checked against the IPv4 list.
 */
export function isBlockedAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return deny.check(ip, "ipv4");
  if (family !== 6) return true; // not an IP literal — unsafe by definition
  const g = ipv6Groups(ip);
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-translated ::ffff:0:a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || (g[4] === 0xffff && g[5] === 0))) {
    return deny.check(groupsToIPv4(g[6], g[7]), "ipv4");
  }
  // NAT64 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return deny.check(groupsToIPv4(g[6], g[7]), "ipv4");
  }
  // 6to4 2002:AABB:CCDD::/48 embeds an IPv4 address
  if (g[0] === 0x2002) return deny.check(groupsToIPv4(g[1], g[2]), "ipv4");
  // Teredo 2001:0::/32 embeds the client IPv4 XOR 0xffff
  if (g[0] === 0x2001 && g[1] === 0) return deny.check(groupsToIPv4(g[6] ^ 0xffff, g[7] ^ 0xffff), "ipv4");
  return deny.check(ip, "ipv6");
}

// ── URL + DNS validation ─────────────────────────────────────────────────────

function isProduction() {
  return process.env.NODE_ENV === "production";
}

/**
 * Parse and validate a URL's syntax, scheme and host allow-list. The WHATWG
 * parser canonicalises decimal/octal/hex IPv4 encodings (e.g. 2130706433,
 * 0x7f.1, 0177.0.0.1 → 127.0.0.1), so literal checks see the real address.
 */
export function parseSafeUrl(rawUrl, { allowHttp = !isProduction(), allowedHosts } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("url must be a valid absolute URL");
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new SsrfError(allowHttp ? "url must use http or https" : "url must use https");
  }
  if (url.username || url.password) throw new SsrfError("url must not contain credentials");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new SsrfError("url must have a host");
  if (allowedHosts && !allowedHosts.includes(host)) {
    throw new SsrfError(`host ${host} is not allowed for this request`);
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new SsrfError("url must not point to a local/internal host");
  }
  return { url, host };
}

/**
 * Resolve `host` once and return a single validated address to pin the
 * connection to. Throws if *any* resolved address is unsafe.
 */
export async function resolveSafe(host, { lookup = dns.lookup, allowPrivate = false } = {}) {
  if (net.isIP(host)) {
    if (!allowPrivate && isBlockedAddress(host)) {
      throw new SsrfError("url must not point to a private/internal network address");
    }
    return { address: host, family: net.isIP(host) };
  }
  let answers;
  try {
    answers = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfError("url host could not be resolved");
  }
  if (!Array.isArray(answers) || answers.length === 0) throw new SsrfError("url host could not be resolved");
  if (!allowPrivate) {
    for (const { address } of answers) {
      if (isBlockedAddress(address)) {
        throw new SsrfError("url must not point to a private/internal network address");
      }
    }
  }
  return answers[0];
}

/** Validate a URL end-to-end (syntax, scheme, hosts, DNS answers) without requesting it. */
export async function assertSafeUrl(rawUrl, opts = {}) {
  const { url, host } = parseSafeUrl(rawUrl, opts);
  await resolveSafe(host, opts);
  return url;
}

// ── Request ──────────────────────────────────────────────────────────────────

function makeResponse(status, headers, buf) {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: h,
    text: async () => buf.toString("utf8"),
    json: async () => JSON.parse(buf.toString("utf8")),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

function requestOnce(url, pinned, { method, headers, body, maxBytes, signal }) {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method,
        headers,
        signal,
        agent: false,
        // Pin the connection to the address that was validated.
        lookup: (_host, options, cb) => {
          if (options && options.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
          else cb(null, pinned.address, pinned.family);
        },
      },
      (res) => {
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          reject(new SsrfError(`response exceeds ${maxBytes} bytes`));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new SsrfError(`response exceeds ${maxBytes} bytes`));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve(makeResponse(res.statusCode, res.headers, Buffer.concat(chunks))));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

/**
 * Hardened replacement for fetch(). Returns a minimal Response-like object
 * ({ ok, status, headers, text(), json() }).
 *
 * @param {string} rawUrl
 * @param {object} [opts]
 * @param {string} [opts.method="GET"]
 * @param {object} [opts.headers]
 * @param {string|Buffer} [opts.body]
 * @param {number} [opts.timeoutMs=10000]  total time budget, including redirects
 * @param {number} [opts.maxBytes=5MiB]    response body size cap
 * @param {number} [opts.maxRedirects=0]   redirects followed (each hop re-validated)
 * @param {string[]} [opts.allowedHosts]   per-purpose host allow-list
 * @param {string} [opts.expectContentType] reject responses whose content-type does not include this
 * @param {boolean} [opts.allowHttp]       defaults to true outside production
 * @param {boolean} [opts.allowPrivate=false] only for operator-configured upstreams (never user input)
 * @param {Function} [opts.lookup]         DNS lookup override (tests)
 */
export async function safeFetch(rawUrl, opts = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = 0,
    expectContentType,
    signal: outerSignal,
  } = opts;
  const signal = outerSignal ? AbortSignal.any([outerSignal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);

  let current = rawUrl;
  let reqMethod = method;
  let reqBody = body;
  for (let hop = 0; ; hop++) {
    const { url, host } = parseSafeUrl(current, opts);
    const pinned = await resolveSafe(host, opts);
    const res = await requestOnce(url, pinned, { method: reqMethod, headers, body: reqBody, maxBytes, signal });

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location && hop < maxRedirects) {
      current = new URL(location, url).toString();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && reqMethod === "POST")) {
        reqMethod = "GET";
        reqBody = undefined;
      }
      continue;
    }
    if (expectContentType && res.ok && !(res.headers.get("content-type") || "").includes(expectContentType)) {
      throw new SsrfError(`unexpected content-type: ${res.headers.get("content-type") || "none"}`);
    }
    return res;
  }
}
