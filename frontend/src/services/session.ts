import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { SandboxFile } from "./webcontainer";

export interface SessionData {
  sandboxId: string;
  templateId: string;
  selectedFile: string | null;
  files: Record<string, SandboxFile>;
  timestamp: number;
}

const STORAGE_KEY = "soroban_sandbox_session";
const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

export function saveSession(sessionData: SessionData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
  } catch (error) {
    console.error("Failed to save session:", error);
  }
}

export function loadSession(): SessionData | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Failed to load session:", error);
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function createAutoSaver(
  sandboxId: string,
  templateId: string,
  files: Map<string, SandboxFile>,
  selectedFile: string | null,
): () => void {
  const interval = setInterval(() => {
    const filesObj: Record<string, SandboxFile> = {};
    for (const [key, file] of files) {
      filesObj[key] = file;
    }

    saveSession({
      sandboxId,
      templateId,
      selectedFile,
      files: filesObj,
      timestamp: Date.now(),
    });
  }, AUTO_SAVE_INTERVAL);

  return () => clearInterval(interval);
}

// ── Real-time collaboration (#926) ───────────────────────────────────────────
// One Yjs document per shared session holds the files (Y.Text per path), the
// open tab, and run history. Sync goes through the indexer's /collab/ server;
// merging is done by the CRDT, so offline edits merge on reconnect.

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
const COLLAB_WS_BASE = API_BASE.replace(/^http/, "ws") + "/collab";
const OWNER_TOKENS_KEY = "soroban_collab_owner_tokens";

export type CollabRole = "owner" | "edit" | "view";

export interface CollabSessionTokens {
  sessionId: string;
  ownerToken: string;
  editToken: string;
  viewToken: string;
}

export interface CollabRun {
  by: string;
  color: string;
  command: string;
  output: string[];
  exitCode: number | null;
  at: number;
}

export interface CollabConnection {
  doc: Y.Doc;
  provider: WebsocketProvider;
  files: Y.Map<Y.Text>;
  meta: Y.Map<string>;
  runs: Y.Array<CollabRun>;
  destroy: () => void;
}

const PRESENCE_COLORS = ["#e06c75", "#61afef", "#98c379", "#e5c07b", "#c678dd", "#56b6c2", "#d19a66"];

export function presenceColor(clientId: number): string {
  return PRESENCE_COLORS[clientId % PRESENCE_COLORS.length];
}

async function collabPost<T>(path: string, body: unknown, ownerToken?: string): Promise<T> {
  const res = await fetch(`${API_BASE}/api/collab/sessions${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(ownerToken ? { "x-collab-token": ownerToken } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`Collaboration request failed (${res.status})`);
  return res.json();
}

export async function createCollabSession(sandboxId: string): Promise<CollabSessionTokens> {
  const tokens = await collabPost<CollabSessionTokens>("", { sandboxId });
  saveOwnerToken(tokens.sessionId, tokens.ownerToken);
  return tokens;
}

export function rotateCollabToken(sessionId: string, ownerToken: string, role: "edit" | "view"): Promise<{ token: string }> {
  return collabPost(`/${encodeURIComponent(sessionId)}/rotate`, { role }, ownerToken);
}

export function kickCollabParticipants(sessionId: string, ownerToken: string): Promise<{ ok: boolean }> {
  return collabPost(`/${encodeURIComponent(sessionId)}/kick`, {}, ownerToken);
}

function readOwnerTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(OWNER_TOKENS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveOwnerToken(sessionId: string, token: string): void {
  try {
    localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify({ ...readOwnerTokens(), [sessionId]: token }));
  } catch {
    // storage unavailable — owner controls will only work from the link
  }
}

export function getOwnerToken(sessionId: string): string | null {
  return readOwnerTokens()[sessionId] ?? null;
}

/**
 * Connect to a shared session. When `initialFiles` is given (editors only) the
 * document is seeded from it if it is still empty after the first sync.
 */
export function connectCollab(
  sessionId: string,
  token: string,
  user: { name: string },
  initialFiles: Record<string, SandboxFile> | null,
): CollabConnection {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(COLLAB_WS_BASE, sessionId, doc, {
    params: { token },
    // Tabs must go through the server so view-only roles are enforced.
    disableBc: true,
  });
  const files = doc.getMap<Y.Text>("files");
  const meta = doc.getMap<string>("meta");
  const runs = doc.getArray<CollabRun>("runs");

  provider.awareness.setLocalStateField("user", { name: user.name, color: presenceColor(doc.clientID) });

  const seed = (synced: boolean) => {
    if (!synced || !initialFiles || files.size > 0) return;
    doc.transact(() => {
      for (const [path, file] of Object.entries(initialFiles)) {
        if (!files.has(path)) files.set(path, new Y.Text(file.content));
      }
      if (!meta.get("tab")) meta.set("tab", Object.keys(initialFiles)[0] ?? "");
    });
  };
  provider.on("sync", seed);

  return {
    doc,
    provider,
    files,
    meta,
    runs,
    destroy: () => {
      provider.off("sync", seed);
      provider.destroy();
      doc.destroy();
    },
  };
}
