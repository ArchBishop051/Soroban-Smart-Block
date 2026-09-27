/**
 * collab/server.js — WebSocket sync server for shared sandbox sessions (#926).
 *
 * Speaks the y-websocket wire protocol (sync + awareness) so the frontend can
 * use `y-websocket`'s WebsocketProvider directly. The server is a relay with
 * persistence, not the merge authority: all merging is done by the Yjs CRDT,
 * so offline edits merge correctly on reconnect.
 *
 * Access is by link token (?token=) mapped to a role:
 *   owner — edit + may rotate tokens and kick participants (REST, api.js)
 *   edit  — may send document updates
 *   view  — receives updates and presence only; updates it sends are dropped
 *
 * Limits: per-message size (ws maxPayload), per-document size
 * (COLLAB_MAX_DOC_BYTES), and inactivity expiry (COLLAB_SESSION_TTL_HOURS).
 */

import crypto from "crypto";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { logger } from "../logger.js";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const PATH_PREFIX = "/collab/";
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_DOC_BYTES = Number(process.env.COLLAB_MAX_DOC_BYTES) || 2 * 1024 * 1024;
const MAX_PARTICIPANTS = Number(process.env.COLLAB_MAX_PARTICIPANTS) || 20;
const SESSION_TTL_HOURS = Number(process.env.COLLAB_SESSION_TTL_HOURS) || 72;
const PERSIST_DEBOUNCE_MS = 2_000;

export const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const newToken = () => crypto.randomBytes(24).toString("base64url");

function safeEqualHex(a, b) {
  return typeof a === "string" && typeof b === "string" && a.length === b.length &&
    crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** @type {Map<string, Room>} */
const rooms = new Map();
let store = null;

// ── Persistence ──────────────────────────────────────────────────────────────

function pgStore(pool) {
  return {
    async create({ id, sandboxId, tokens }) {
      await pool.query(
        `INSERT INTO collab_sessions (id, sandbox_id, owner_token_hash, edit_token_hash, view_token_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, sandboxId ?? null, hashToken(tokens.owner), hashToken(tokens.edit), hashToken(tokens.view)],
      );
    },
    async get(id) {
      const { rows } = await pool.query("SELECT * FROM collab_sessions WHERE id = $1", [id]);
      return rows[0] ?? null;
    },
    async saveState(id, state) {
      await pool.query("UPDATE collab_sessions SET state = $2, updated_at = NOW() WHERE id = $1", [id, Buffer.from(state)]);
    },
    async touch(id) {
      await pool.query("UPDATE collab_sessions SET updated_at = NOW() WHERE id = $1", [id]);
    },
    async setTokenHash(id, role, hash) {
      const col = { edit: "edit_token_hash", view: "view_token_hash" }[role];
      await pool.query(`UPDATE collab_sessions SET ${col} = $2 WHERE id = $1`, [id, hash]);
    },
    async expire(hours) {
      const { rowCount } = await pool.query(
        "DELETE FROM collab_sessions WHERE updated_at < NOW() - ($1 || ' hours')::interval",
        [String(hours)],
      );
      return rowCount;
    },
  };
}

// ── Rooms ────────────────────────────────────────────────────────────────────

class Room {
  constructor(id, row) {
    this.id = id;
    this.row = row;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    /** @type {Map<import("ws").WebSocket, { role: string, clientIds: Set<number> }>} */
    this.conns = new Map();
    this.persistTimer = null;
    this.tooLarge = false;
    if (row.state) Y.applyUpdate(this.doc, new Uint8Array(row.state));

    this.doc.on("update", (update, origin) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.broadcast(encoding.toUint8Array(enc), origin);
      this.schedulePersist();
    });

    this.awareness.on("update", ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      const meta = this.conns.get(origin);
      if (meta) {
        added.forEach((c) => meta.clientIds.add(c));
        removed.forEach((c) => meta.clientIds.delete(c));
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.broadcast(encoding.toUint8Array(enc));
    });
  }

  broadcast(msg, except) {
    for (const ws of this.conns.keys()) {
      if (ws !== except && ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  schedulePersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persist(), PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref?.();
  }

  async persist() {
    clearTimeout(this.persistTimer);
    const state = Y.encodeStateAsUpdate(this.doc);
    this.tooLarge = state.byteLength > MAX_DOC_BYTES;
    try {
      await store.saveState(this.id, state);
    } catch (err) {
      logger.error(`[collab] persist ${this.id} failed: ${err.message}`);
    }
  }

  add(ws, role) {
    this.conns.set(ws, { role, clientIds: new Set() });

    ws.on("message", (data) => {
      try {
        this.onMessage(ws, new Uint8Array(data));
      } catch (err) {
        logger.warn(`[collab] bad message in ${this.id}: ${err.message}`);
        ws.close(1003, "bad message");
      }
    });
    ws.on("close", () => this.remove(ws));

    // Initial sync step 1 + current presence.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    ws.send(encoding.toUint8Array(enc));
    const states = [...this.awareness.getStates().keys()];
    if (states.length) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MSG_AWARENESS);
      encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness, states));
      ws.send(encoding.toUint8Array(aw));
    }
  }

  onMessage(ws, msg) {
    const meta = this.conns.get(ws);
    if (!meta) return;
    const dec = decoding.createDecoder(msg);
    const type = decoding.readVarUint(dec);
    if (type === MSG_SYNC) {
      const canEdit = meta.role !== "view" && !this.tooLarge;
      // Peek the sync sub-type: 0 = step1 (state vector request), 1 = step2, 2 = update.
      const subType = decoding.peekVarUint(dec);
      if (subType !== syncProtocol.messageYjsSyncStep1 && !canEdit) {
        if (this.tooLarge && meta.role !== "view") ws.close(1009, "session document size limit reached");
        return;
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.readSyncMessage(dec, enc, this.doc, ws);
      if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
      if (subType !== syncProtocol.messageYjsSyncStep1 && Y.encodeStateAsUpdate(this.doc).byteLength > MAX_DOC_BYTES) {
        this.tooLarge = true;
      }
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), ws);
    }
  }

  remove(ws) {
    const meta = this.conns.get(ws);
    if (!meta) return;
    this.conns.delete(ws);
    awarenessProtocol.removeAwarenessStates(this.awareness, [...meta.clientIds], null);
    if (this.conns.size === 0) {
      rooms.delete(this.id);
      this.persist().finally(() => this.doc.destroy());
    }
  }

  /** Close every connection holding `role` (or all non-owner roles when omitted). */
  kick(role) {
    for (const [ws, meta] of this.conns) {
      if (meta.role !== "owner" && (!role || meta.role === role)) ws.close(4001, "removed by session owner");
    }
  }
}

async function loadRoom(id) {
  let room = rooms.get(id);
  if (room) return room;
  const row = await store.get(id);
  if (!row) return null;
  room = rooms.get(id) ?? new Room(id, row); // re-check after await
  rooms.set(id, room);
  return room;
}

function roleFor(row, token) {
  if (!token) return null;
  const h = hashToken(token);
  if (safeEqualHex(h, row.owner_token_hash)) return "owner";
  if (safeEqualHex(h, row.edit_token_hash)) return "edit";
  if (safeEqualHex(h, row.view_token_hash)) return "view";
  return null;
}

// ── Public API (used by api.js) ──────────────────────────────────────────────

export function isCollabUpgrade(req) {
  return (req.url || "").startsWith(PATH_PREFIX);
}

/** Create a session; returns the plaintext tokens once (only hashes are stored). */
export async function createSession({ sandboxId } = {}) {
  const id = crypto.randomUUID();
  const tokens = { owner: newToken(), edit: newToken(), view: newToken() };
  await store.create({ id, sandboxId, tokens });
  return { sessionId: id, ownerToken: tokens.owner, editToken: tokens.edit, viewToken: tokens.view };
}

/** Resolve the caller's role for a session, or null. */
export async function authorize(sessionId, token) {
  const row = rooms.get(sessionId)?.row ?? (await store.get(sessionId));
  return row ? roleFor(row, token) : null;
}

/** Rotate the edit or view token and disconnect everyone holding the old one. */
export async function rotateToken(sessionId, role) {
  const token = newToken();
  const hash = hashToken(token);
  await store.setTokenHash(sessionId, role, hash);
  const room = rooms.get(sessionId);
  if (room) {
    room.row[`${role}_token_hash`] = hash;
    room.kick(role);
  }
  return token;
}

/** Disconnect all non-owner participants. */
export function kickParticipants(sessionId) {
  rooms.get(sessionId)?.kick();
}

/**
 * Attach the collab WebSocket endpoint (`/collab/<sessionId>?token=`) to the
 * HTTP server and start the inactivity-expiry sweep.
 */
export function attachCollabServer(httpServer, pool) {
  store = pgStore(pool);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  httpServer.on("upgrade", async (req, socket, head) => {
    if (!isCollabUpgrade(req)) return;
    const reject = (code, text) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    try {
      const u = new URL(req.url, "http://localhost");
      const sessionId = decodeURIComponent(u.pathname.slice(PATH_PREFIX.length));
      const room = await loadRoom(sessionId);
      if (!room) return reject(404, "Not Found");
      const role = roleFor(room.row, u.searchParams.get("token"));
      if (!role) return reject(401, "Unauthorized");
      if (room.conns.size >= MAX_PARTICIPANTS) return reject(503, "Session Full");
      wss.handleUpgrade(req, socket, head, (ws) => {
        room.add(ws, role);
        store.touch(sessionId).catch(() => {});
      });
    } catch (err) {
      logger.error(`[collab] upgrade failed: ${err.message}`);
      reject(500, "Internal Server Error");
    }
  });

  const sweep = setInterval(() => {
    store.expire(SESSION_TTL_HOURS)
      .then((n) => n && logger.info(`[collab] expired ${n} inactive session(s)`))
      .catch((err) => logger.warn(`[collab] expiry sweep failed: ${err.message}`));
  }, 60 * 60 * 1000);
  sweep.unref?.();

  logger.info("[collab] collaborative sandbox server attached");
  return wss;
}

