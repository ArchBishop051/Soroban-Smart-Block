// Tutorial 4 — a webhook consumer that verifies signatures.
// The explorer signs each delivery with HMAC-SHA256 of the raw body using the
// secret returned when you create the subscription, sent as
// `X-Webhook-Signature: sha256=<hex>`. Always verify against the RAW body.
import crypto from "node:crypto";
import http from "node:http";
import { check } from "../lib.mjs";

const SECRET = process.env.WEBHOOK_SECRET ?? crypto.randomBytes(32).toString("hex");

// #region verify
export function verifySignature(secret, rawBody, header) {
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// #endregion verify

// #region server
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    if (!verifySignature(SECRET, raw, req.headers["x-webhook-signature"])) {
      res.writeHead(401).end("bad signature");
      return;
    }
    const event = JSON.parse(raw.toString("utf8"));
    console.log(`  accepted ${event.function} at ledger ${event.ledger}`);
    res.writeHead(204).end();
  });
});
// #endregion server

await new Promise((r) => server.listen(Number(process.env.PORT ?? 0), r));
const { port } = server.address();
check(true, `webhook consumer listening on :${port}`);

// Self-test: simulate one genuine and one tampered delivery.
const body = JSON.stringify({ function: "transfer", ledger: 123, description: "tutorial" });
const send = (payload, signature) =>
  fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: payload, headers: { "X-Webhook-Signature": signature } });
const sig = `sha256=${crypto.createHmac("sha256", SECRET).update(body).digest("hex")}`;
check((await send(body, sig)).status === 204, "genuine delivery accepted");
check((await send(body.replace("123", "999"), sig)).status === 401, "tampered delivery rejected");

if (!process.env.KEEP_RUNNING) server.close();
