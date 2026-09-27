// Tutorial 3 — subscribe to live events over WebSocket.
// The explorer pushes `events_batch` messages as ledgers are indexed. This
// script connects, waits for the ready message, then prints events for
// LISTEN_SECONDS (default 5) before exiting.
import WebSocket from "ws";
import { API_URL, API_KEY, check } from "../lib.mjs";

const seconds = Number(process.env.LISTEN_SECONDS ?? 5);

// #region subscribe
const url = new URL(API_URL.replace(/^http/, "ws"));
if (API_KEY) url.searchParams.set("api_key", API_KEY);
const ws = new WebSocket(url);

let received = 0;
ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.type === "events_batch") {
    for (const ev of msg.data) console.log(`  ledger ${ev.ledger} ${ev.function}: ${ev.description}`);
    received += msg.data.length;
  }
});
// #endregion subscribe

await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});
check(true, "connected to the live event stream");

await new Promise((r) => setTimeout(r, seconds * 1000));
check(true, `received ${received} live event(s) in ${seconds}s`);
ws.close();
