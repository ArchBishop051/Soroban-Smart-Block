import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export type WatchlistEntry = {
  id: string;
  kind: "contract" | "wallet";
  label: string;
};

const STORAGE_KEY = "watchlist";

function readWatchlist(): WatchlistEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function toggleWatchlistEntry(entry: WatchlistEntry) {
  const current = readWatchlist();
  const exists = current.some((item) => item.id === entry.id && item.kind === entry.kind);
  const next = exists ? current.filter((item) => !(item.id === entry.id && item.kind === entry.kind)) : [entry, ...current];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function useWatchlist() {
  const [entries, setEntries] = useState<WatchlistEntry[]>(() => readWatchlist());

  useEffect(() => {
    setEntries(readWatchlist());
  }, []);

  const toggle = (entry: WatchlistEntry) => {
    const next = toggleWatchlistEntry(entry);
    setEntries(next);
  };

  const isSaved = (id: string, kind: WatchlistEntry["kind"]) => entries.some((entry) => entry.id === id && entry.kind === kind);

  return { entries, toggle, isSaved };
}

export default function WatchlistPage() {
  const { t } = useTranslation();
  const { entries } = useWatchlist();

  const grouped = useMemo(
    () => ({
      contract: entries.filter((entry) => entry.kind === "contract"),
      wallet: entries.filter((entry) => entry.kind === "wallet"),
    }),
    [entries],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>{t("watchlist.title")}</h1>
      </div>
      {entries.length === 0 ? (
        <div className="card">{t("watchlist.empty")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {(["contract", "wallet"] as const).map((kind) => (
            <div key={kind} className="card">
              <h2 style={{ fontSize: 14, marginBottom: 12, textTransform: "capitalize" }}>{kind}s</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {grouped[kind].length === 0 ? <div style={{ color: "var(--muted)" }}>None</div> : grouped[kind].map((entry) => (
                  <div key={`${entry.kind}:${entry.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <Link to={entry.kind === "contract" ? `/contract/${entry.id}` : `/wallet/${entry.id}`}>
                      {entry.label || entry.id}
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
