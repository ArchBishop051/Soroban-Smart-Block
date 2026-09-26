import { useCallback, useEffect, useState } from "react";

/**
 * Admin panel for hot-reloadable runtime configuration (#894): view the live
 * version, edit and apply (with optimistic concurrency), diff against history
 * and revert. Changes are live on all instances within seconds; a guardrail
 * auto-reverts changes that spike the 5xx rate or indexer lag.
 */

type Version = { version: number; config: unknown; author: string | null; comment: string | null; created_at?: string };

export default function AdminRuntimeConfigPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem("admin_token") ?? "");
  const [current, setCurrent] = useState<Version | null>(null);
  const [history, setHistory] = useState<Version[]>([]);
  const [draft, setDraft] = useState("");
  const [comment, setComment] = useState("");
  const [diffWith, setDiffWith] = useState<Version | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const headers = useCallback(
    (): Record<string, string> => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
    [token],
  );

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch("/api/admin/runtime-config", { headers: headers() });
    const body = await res.json();
    if (!res.ok) return setMessage(body.error ?? `HTTP ${res.status}`);
    setCurrent(body.current);
    setHistory(body.history);
    setDraft(JSON.stringify(body.current.config, null, 2));
  }, [token, headers]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (url: string, method: string, payload: unknown) => {
    setMessage(null);
    const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setMessage(body.error ?? `HTTP ${res.status}`);
    setMessage(`Applied version ${body.applied.version}${body.guardrail ? ` — ${body.guardrail}` : ""}`);
    setComment("");
    await load();
  };

  const apply = () => {
    let config: unknown;
    try {
      config = JSON.parse(draft);
    } catch {
      return setMessage("Config is not valid JSON");
    }
    send("/api/admin/runtime-config", "PUT", { config, expectedVersion: current?.version ?? 0, comment });
  };

  if (!token) {
    return (
      <div className="card" style={{ padding: 16, maxWidth: 420 }}>
        <h2>Runtime configuration</h2>
        <input
          type="password"
          placeholder="Admin token"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = (e.target as HTMLInputElement).value.trim();
              sessionStorage.setItem("admin_token", v);
              setToken(v);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h2>Runtime configuration</h2>
      {message && (
        <p role="status" className="card" style={{ padding: 8 }}>
          {message}
        </p>
      )}
      <div className="card" style={{ padding: 16 }}>
        <p style={{ marginTop: 0 }}>
          Live version <strong>{current?.version ?? 0}</strong>
          {current?.author ? ` by ${current.author}` : ""}
          {current?.comment ? ` — ${current.comment}` : ""}
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={16}
          style={{ width: "100%", fontFamily: "monospace" }}
          aria-label="Runtime config JSON"
        />
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Change comment" style={{ width: "100%", marginTop: 8 }} />
        <button type="button" onClick={apply} style={{ marginTop: 8 }}>
          Apply
        </button>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>History</h3>
        <table style={{ width: "100%", fontSize: 13 }}>
          <tbody>
            {history.map((v) => (
              <tr key={v.version}>
                <td>v{v.version}</td>
                <td>{v.author ?? "—"}</td>
                <td>{v.comment ?? ""}</td>
                <td>{v.created_at ? new Date(v.created_at).toLocaleString() : ""}</td>
                <td>
                  <button type="button" onClick={() => setDiffWith(v)}>
                    Diff
                  </button>{" "}
                  {v.version !== current?.version && (
                    <button type="button" onClick={() => send(`/api/admin/runtime-config/revert/${v.version}`, "POST", {})}>
                      Revert to this
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {diffWith && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <pre aria-label={`Version ${diffWith.version}`}>{JSON.stringify(diffWith.config, null, 2)}</pre>
            <pre aria-label="Live version">{JSON.stringify(current?.config, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
