/**
 * ProvenancePanel (#945)
 * Shows where an event came from: the ingest batch that wrote it and every
 * later re-decode / reconciliation, oldest first.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export default function ProvenancePanel({ seq }: { seq: number }) {
  const { data } = useQuery({
    queryKey: ["event-lineage", seq],
    queryFn: () => api.lineage(seq),
  });
  if (!data) return null;

  return (
    <div className="card">
      <h4 style={{ marginBottom: 10, fontSize: 13 }}>Provenance</h4>
      <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6, fontSize: 13 }}>
        {data.chain.map((step, i) => (
          <li key={i}>
            <strong>{step.action}</strong>
            {step.lineage === "legacy" ? (
              <span style={{ color: "var(--muted)" }}> — legacy (written before lineage tracking)</span>
            ) : (
              <span style={{ color: "var(--muted)" }}>
                {" "}
                — {step.run_type} batch #{step.lineage_id} · code {step.code_version?.slice(0, 12)}
                {step.created_at && ` · ${new Date(step.created_at).toLocaleString()}`}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
