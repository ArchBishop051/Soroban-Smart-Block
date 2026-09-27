/**
 * Live event stream for the TUI: WebSocket with exponential-backoff reconnect
 * and replay. The last seen `seq` is sent as `last_event_id` on reconnect (for
 * servers with resumable streams, #856) and any gap is also back-filled from
 * the REST API, so no events are missed during network blips.
 */
import WebSocket from "ws";

const MAX_REPLAY_PAGES = 20;

/** Fetch events with seq > lastSeq, oldest first, walking the descending keyset. */
export async function fetchSince({ baseUrl, apiKey, contract, lastSeq, fetchImpl = fetch }) {
  const out = [];
  let cursor = 0;
  for (let page = 0; page < MAX_REPLAY_PAGES; page++) {
    const q = new URLSearchParams({ limit: "200" });
    if (contract) q.set("contract", contract);
    if (cursor) q.set("after_seq", String(cursor));
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/events?${q}`, {
      headers: apiKey ? { "x-api-key": apiKey } : {},
    });
    if (!res.ok) throw new Error(`replay failed: HTTP ${res.status}`);
    const { data = [], next_cursor } = await res.json();
    const fresh = data.filter((ev) => ev.seq > lastSeq);
    out.push(...fresh);
    if (fresh.length < data.length || !next_cursor) break;
    cursor = next_cursor;
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/**
 * @param {object} opts
 * @param {(events: object[]) => void} opts.onEvents
 * @param {(status: string) => void} [opts.onStatus]
 * @returns {{ close(): void }}
 */
export function connectStream({ baseUrl, apiKey, contract, onEvents, onStatus = () => {}, WebSocketImpl = WebSocket, fetchImpl = fetch }) {
  let ws = null;
  let closed = false;
  let attempt = 0;
  let lastSeq = 0;
  let timer = null;

  const deliver = (events) => {
    const fresh = events.filter((ev) => (!contract || ev.contract_id === contract) && !(ev.seq <= lastSeq));
    if (!fresh.length) return;
    for (const ev of fresh) if (ev.seq > lastSeq) lastSeq = ev.seq;
    onEvents(fresh);
  };

  const open = () => {
    const url = new URL(baseUrl.replace(/^http/, "ws"));
    if (apiKey) url.searchParams.set("api_key", apiKey);
    if (lastSeq) url.searchParams.set("last_event_id", String(lastSeq));
    ws = new WebSocketImpl(url.toString());

    ws.on("open", async () => {
      onStatus(attempt ? "reconnected" : "live");
      const wasReconnect = attempt > 0;
      attempt = 0;
      if (wasReconnect && lastSeq) {
        try {
          deliver(await fetchSince({ baseUrl, apiKey, contract, lastSeq, fetchImpl }));
        } catch (err) {
          onStatus(`replay error: ${err.message}`);
        }
      }
    });
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "events_batch") deliver(msg.data ?? []);
      else if (msg.type === "event") deliver([msg.data]);
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      if (closed) return;
      const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.5 + Math.random() / 2);
      onStatus(`reconnecting in ${Math.round(delay / 1000)}s`);
      timer = setTimeout(open, delay);
    });
  };

  open();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
