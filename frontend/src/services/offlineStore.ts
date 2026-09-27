const STORAGE_KEY = "soroban-explorer:offline-v1";
const MAX_CACHE_ENTRIES = 40;

export interface OfflineNote {
  contractId: string;
  text: string;
  updatedAt: string;
}

export interface OfflineAction {
  id: string;
  kind: "watchlist" | "note";
  contractId: string;
  payload: string;
  createdAt: string;
}

interface OfflineState {
  cache: Record<string, unknown>;
  watchlist: string[];
  notes: OfflineNote[];
  actions: OfflineAction[];
}

const emptyState = (): OfflineState => ({ cache: {}, watchlist: [], notes: [], actions: [] });

function readState(): OfflineState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<OfflineState> | null;
    return {
      cache: parsed?.cache ?? {},
      watchlist: parsed?.watchlist ?? [],
      notes: parsed?.notes ?? [],
      actions: parsed?.actions ?? [],
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: OfflineState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Offline continuity is best effort when storage is unavailable or full.
  }
}

function actionId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function readCachedResponse<T>(path: string): T | null {
  const value = readState().cache[path];
  return value === undefined ? null : (value as T);
}

export function writeCachedResponse(path: string, value: unknown) {
  const state = readState();
  state.cache[path] = value;
  const keys = Object.keys(state.cache);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_CACHE_ENTRIES))) delete state.cache[key];
  writeState(state);
}

export function isWatched(contractId: string): boolean {
  return readState().watchlist.includes(contractId);
}

export function toggleWatched(contractId: string): boolean {
  const state = readState();
  const watched = state.watchlist.includes(contractId);
  state.watchlist = watched ? state.watchlist.filter((id) => id !== contractId) : [...state.watchlist, contractId];
  state.actions.push({
    id: actionId(),
    kind: "watchlist",
    contractId,
    payload: String(!watched),
    createdAt: new Date().toISOString(),
  });
  writeState(state);
  return !watched;
}

export function getNote(contractId: string): OfflineNote | null {
  return readState().notes.find((note) => note.contractId === contractId) ?? null;
}

export function saveNote(contractId: string, text: string) {
  const state = readState();
  state.notes = [...state.notes.filter((note) => note.contractId !== contractId), {
    contractId,
    text,
    updatedAt: new Date().toISOString(),
  }];
  state.actions.push({
    id: actionId(),
    kind: "note",
    contractId,
    payload: text,
    createdAt: new Date().toISOString(),
  });
  writeState(state);
}

export function pendingOfflineActions(): number {
  return readState().actions.length;
}
