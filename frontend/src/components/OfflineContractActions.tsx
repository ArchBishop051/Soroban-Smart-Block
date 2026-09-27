import { useEffect, useState } from "react";
import { getNote, isWatched, pendingOfflineActions, saveNote, toggleWatched } from "../services/offlineStore";

export default function OfflineContractActions({ contractId }: { contractId: string }) {
  const [watched, setWatched] = useState(() => isWatched(contractId));
  const [note, setNote] = useState(() => getNote(contractId)?.text ?? "");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pending, setPending] = useState(() => pendingOfflineActions());

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const saveLocalNote = () => {
    saveNote(contractId, note);
    setPending(pendingOfflineActions());
  };

  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <strong>Analyst workspace</strong>
        <span style={{ color: online ? "var(--green, #22c55e)" : "var(--yellow, #f59e0b)", fontSize: 12 }}>
          {online ? "Online" : "Offline"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          aria-pressed={watched}
          title={watched ? "Remove contract from watchlist" : "Add contract to watchlist"}
          onClick={() => {
            setWatched(toggleWatched(contractId));
            setPending(pendingOfflineActions());
          }}
        >
          {watched ? "★ Watched" : "☆ Watch contract"}
        </button>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          {pending ? `${pending} local action${pending === 1 ? "" : "s"} saved` : "No pending local actions"}
        </span>
      </div>
      <label style={{ display: "grid", gap: 6, color: "var(--muted)", fontSize: 12 }}>
        Private note
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Record an observation about this contract"
        />
      </label>
      <button type="button" onClick={saveLocalNote} style={{ justifySelf: "start" }}>
        Save note locally
      </button>
    </div>
  );
}
