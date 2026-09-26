import { logger } from "./logger.js";
/**
 * Live Event Streaming via WebSockets
 *
 * Uses Node's built-in EventEmitter as the pub/sub bus (no Redis required).
 * The HTTP server is upgraded to handle WebSocket connections via the `ws`
 * package.  When the indexer stores a new event it calls `publish(event)` and
 * every connected client receives the payload within the same event-loop tick.
 *
 * Multi-network support: events are emitted to network-scoped channels.
 * Clients specify network via ?network=testnet query param (default: testnet).
 */

import { EventEmitter } from "events";
import { WebSocketServer } from "ws";
import url from "url";
import { NETWORK_NAMES, getIndexerNetwork } from "./networkConfig.js";
import { db } from "./db.js";

const API_KEY = process.env.API_KEY;
const bus = new EventEmitter();
bus.setMaxListeners(0);

const txStatusCache = new Map();
const MAX_REPLAY_EVENTS = 1000;
const MAX_PENDING_EVENTS = 500;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_CONNECTIONS = 1000;
let activeSseConnections = 0;

/**
 * Emit an event to network-specific channels.
 * Also emits to legacy "event" channel for backward compatibility.
 */
export function publish(event) {
  bus.emit("event", event);
  const network = event.network || getIndexerNetwork();
  bus.emit(`event:${network}`, event);
}

export function publishTransactionStatus(status) {
  const existing = txStatusCache.get(status.tx_hash);
  if (existing && existing.status === status.status && existing.ledger === status.ledger && existing.error === status.error) {
    return;
  }
  txStatusCache.set(status.tx_hash, status);
  bus.emit("transaction_status", status);
}

export function getTransactionStatus(txHash) {
  return txStatusCache.get(txHash) || null;
}

export function onTransactionStatus(listener) {
  bus.on("transaction_status", listener);
}

export function offTransactionStatus(listener) {
  bus.off("transaction_status", listener);
}

export function publishVaultRatio(snapshot) {
  bus.emit("vault_ratio", {
    contract_id: snapshot.contract_id,
    ratio: snapshot.ratio,
    total_assets: snapshot.total_assets,
    total_supply: snapshot.total_supply,
    ledger: snapshot.ledger,
  });
}

export function publishContractLink(link) {
  bus.emit("contract_link", link);
}

export function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: 64 * 1024,
    verifyClient: (info, cb) => {
      const params = new url.URL(info.req.url || "", "http://localhost").searchParams;
      const key = params.get("api_key");
      const network = params.get("network") || getIndexerNetwork();
      const afterSeq = params.get("after_seq");

      if (API_KEY && key !== API_KEY) {
        cb(false, 401, "Unauthorized");
        return;
      }

      if (!NETWORK_NAMES.includes(network)) {
        cb(false, 400, `Invalid network: ${network}`);
        return;
      }

      if (afterSeq !== null && (!/^\d+$/.test(afterSeq) || !Number.isSafeInteger(Number(afterSeq)))) {
        cb(false, 400, "Invalid after_seq cursor");
        return;
      }

      cb(true);
    },
  });

  wss.on("connection", (ws, req) => {
    if (wss.clients.size > MAX_CONNECTIONS) {
      ws.close(1013, "Connection capacity reached");
      return;
    }
    // Re-derive the client's network from the connection URL (verifyClient
    // validated it above but its local `network` is out of scope here).
    const network =
      new url.URL(req.url || "", "http://localhost").searchParams.get(
        "network",
      ) || getIndexerNetwork();
    const params = new url.URL(req.url || "", "http://localhost").searchParams;
    const hasResumeCursor = params.has("after_seq");
    let cursor = Number(params.get("after_seq") || 0);
    let replaying = true;
    const replayQueue = [];
    logger.info("[ws] Client connected");

    const BATCH_TIMEOUT_MS = 50;
    const pendingEvents = [];
    let flushTimeoutId = null;

    const closeSlowClient = () => {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close(1013, "Client cannot keep up; reconnect with the last cursor");
      }
    };

    const send = (payload) => {
      if (ws.readyState !== ws.OPEN) return false;
      const message = JSON.stringify(payload);
      if (ws.bufferedAmount + Buffer.byteLength(message) > MAX_BUFFERED_BYTES) {
        closeSlowClient();
        return false;
      }
      ws.send(message, (error) => {
        if (error) closeSlowClient();
      });
      return true;
    };

    const flushBatch = () => {
      if (pendingEvents.length === 0) {
        flushTimeoutId = null;
        return;
      }
      const batch = pendingEvents.splice(0, pendingEvents.length).sort((a, b) => Number(a.seq) - Number(b.seq));
      send({ type: "events_batch", data: batch, cursor: batch.at(-1)?.seq ?? cursor });
      flushTimeoutId = null;
    };

    const handler = (event) => {
      if (!Number.isSafeInteger(Number(event.seq))) return;
      if (replaying) {
        if (replayQueue.length >= MAX_PENDING_EVENTS) return closeSlowClient();
        replayQueue.push(event);
        return;
      }
      if (Number(event.seq) <= cursor) return;
      if (pendingEvents.length >= MAX_PENDING_EVENTS) return closeSlowClient();
      pendingEvents.push(event);
      if (flushTimeoutId === null) {
        flushTimeoutId = setTimeout(flushBatch, BATCH_TIMEOUT_MS);
      }
    };

    const vaultHandler = (snapshot) => {
      send({ type: "vault_ratio", data: snapshot });
    };

    const linkHandler = (link) => {
      send({ type: "contract_link", data: link });
    };

    // Subscribe before replay so events arriving during the DB read are queued.
    bus.on(`event:${network}`, handler);
    bus.on("vault_ratio", vaultHandler);
    bus.on("contract_link", linkHandler);

    const replay = async () => {
      try {
        if (!hasResumeCursor) {
          replayQueue.sort((a, b) => Number(a.seq) - Number(b.seq));
          for (const event of replayQueue) {
            if (!send({ type: "event", data: event, cursor: event.seq })) return;
            cursor = Math.max(cursor, Number(event.seq));
          }
          replayQueue.length = 0;
          replaying = false;
          send({ type: "replay_complete", cursor });
          return;
        }
        let replayed = 0;
        let hasMore = false;
        do {
          const page = await db.getEventsSince({
            after_seq: cursor,
            limit: Math.min(500, MAX_REPLAY_EVENTS - replayed),
            network,
          });
          for (const event of page.data) {
            if (!send({ type: "event", data: event, cursor: event.seq })) return;
            cursor = Number(event.seq);
            replayed++;
          }
          hasMore = page.has_more;
          if (replayed >= MAX_REPLAY_EVENTS && hasMore) {
            send({ type: "replay_limit", cursor, message: "Reconnect with after_seq to continue replay" });
            ws.close(1013, "Reconnect with the replay cursor to continue");
            return;
          }
        } while (hasMore);

        replayQueue.sort((a, b) => Number(a.seq) - Number(b.seq));
        for (const event of replayQueue) {
          if (Number(event.seq) <= cursor) continue;
          if (!send({ type: "event", data: event, cursor: event.seq })) return;
          cursor = Number(event.seq);
        }
        replayQueue.length = 0;
        replaying = false;
        send({ type: "replay_complete", cursor });
      } catch (error) {
        logger.error("[ws] Replay failed:", error.message);
        ws.close(1011, "Replay failed");
      }
    };

    ws.on("close", () => {
      if (flushTimeoutId !== null) {
        clearTimeout(flushTimeoutId);
      }
      bus.off("event", handler);
      bus.off(`event:${network}`, handler);
      bus.off("transaction_status", handler);
      bus.off("vault_ratio", vaultHandler);
      bus.off("contract_link", linkHandler);
      logger.info("[ws] Client disconnected");
    });

    ws.on("error", (err) => {
      logger.error("[ws] Socket error:", err.message);
      if (flushTimeoutId !== null) clearTimeout(flushTimeoutId);
      bus.off(`event:${network}`, handler);
      bus.off("vault_ratio", vaultHandler);
      bus.off("contract_link", linkHandler);
    });

    send({ type: "connected", message: "Soroban event stream ready", network, cursor });
    replay();
  });

  logger.info("[ws] WebSocket server attached");
  return wss;
}

export function attachEventStreamRoutes(app) {
  app.get("/api/events/stream", async (req, res) => {
    if (activeSseConnections >= MAX_CONNECTIONS) {
      return res.status(503).json({ error: "Event stream capacity reached" });
    }
    const requestedCursor = req.get("Last-Event-ID") ?? req.query.after_seq;
    if (requestedCursor !== undefined && (!/^\d+$/.test(String(requestedCursor)) || !Number.isSafeInteger(Number(requestedCursor)))) {
      return res.status(422).json({ error: "Invalid after_seq cursor" });
    }
    const network = req.query.network || getIndexerNetwork();
    if (!NETWORK_NAMES.includes(network)) return res.status(400).json({ error: `Invalid network: ${network}` });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write("retry: 3000\n\n");

    const hasResumeCursor = requestedCursor !== undefined;
    let cursor = Number(requestedCursor || 0);
    activeSseConnections++;
    let replaying = true;
    const liveQueue = [];
    const send = (event) => {
      if (res.destroyed || res.writableLength > MAX_BUFFERED_BYTES) return false;
      const seq = Number(event.seq);
      if (!Number.isSafeInteger(seq) || seq <= cursor) return true;
      const ok = res.write(`id: ${seq}\nevent: event\ndata: ${JSON.stringify(event)}\n\n`);
      cursor = seq;
      return ok && res.writableLength <= MAX_BUFFERED_BYTES;
    };
    const listener = (event) => {
      if (replaying) {
        if (liveQueue.length >= MAX_PENDING_EVENTS) return res.end();
        liveQueue.push(event);
      } else if (!send(event)) {
        res.end();
      }
    };
    const heartbeat = setInterval(() => {
      if (res.destroyed) return;
      if (res.writableLength > MAX_BUFFERED_BYTES) return res.end();
      res.write(": keepalive\n\n");
    }, 15_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      bus.off(`event:${network}`, listener);
      activeSseConnections = Math.max(0, activeSseConnections - 1);
    };
    res.on("close", cleanup);
    bus.on(`event:${network}`, listener);

    try {
      let replayed = 0;
      let hasMore = false;
      do {
        if (!hasResumeCursor) break;
        const page = await db.getEventsSince({
          after_seq: cursor,
          limit: Math.min(500, MAX_REPLAY_EVENTS - replayed),
          network,
        });
        for (const event of page.data) {
          if (!send(event)) return res.end();
          replayed++;
        }
        hasMore = page.has_more;
        if (replayed >= MAX_REPLAY_EVENTS && hasMore) {
          res.write(`event: replay_limit\ndata: ${JSON.stringify({ cursor })}\n\n`);
          return res.end();
        }
      } while (hasMore);

      liveQueue.sort((a, b) => Number(a.seq) - Number(b.seq));
      for (const event of liveQueue) {
        if (!send(event)) return res.end();
      }
      liveQueue.length = 0;
      replaying = false;
      res.write(`event: replay_complete\ndata: ${JSON.stringify({ cursor })}\n\n`);
    } catch (error) {
      logger.error("[sse] Replay failed:", error.message);
      res.end();
    }
  });
}
