/**
 * Ranked table of top 20 API keys by request volume.
 */
interface TopUser {
  api_key_id: string;
  key_name: string;
  total_requests: number;
  balance_confidence?: "high" | "medium" | "low" | "unknown";
  drift_status?: "matched" | "corrected" | "unknown";
}

type Window = "1h" | "24h" | "7d";

interface Props {
  data: TopUser[];
  window: Window;
  onWindowChange: (w: Window) => void;
}

export default function TopUsersTable({ data, window, onWindowChange }: Props) {
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["1h", "24h", "7d"] as Window[]).map((w) => (
          <button
            key={w}
            onClick={() => onWindowChange(w)}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #e5e7eb",
              background: window === w ? "#7c3aed" : "#f9fafb",
              color: window === w ? "#fff" : "#374151",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
            aria-pressed={window === w}
          >
            {w}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <p style={{ color: "#9ca3af", fontSize: 13 }}>No data for this window.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#6b7280" }}>#</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#6b7280" }}>Key Name</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#6b7280" }}>Key ID</th>
              <th style={{ textAlign: "right", padding: "6px 8px", color: "#6b7280" }}>Requests</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "#6b7280" }}>Balance confidence</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={row.api_key_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "6px 8px", color: "#9ca3af" }}>{i + 1}</td>
                <td style={{ padding: "6px 8px", fontWeight: 500 }}>{row.key_name ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>
                  <code style={{ fontSize: 11, color: "#6b7280" }}>{row.api_key_id?.slice(0, 8)}…</code>
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>
                  {Number(row.total_requests).toLocaleString()}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  {row.balance_confidence ? <span title={row.drift_status ? `Reconciliation: ${row.drift_status}` : undefined} style={{ color: row.balance_confidence === "high" ? "#15803d" : row.balance_confidence === "medium" ? "#a16207" : "#b91c1c", fontWeight: 600 }}>{row.balance_confidence}</span> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
