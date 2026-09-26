import { useState } from "react";
import { api, type AnalyticsSqlResult } from "../api";

const EXAMPLE_QUERY =
  "SELECT ledger, COUNT(*) AS events FROM analytics.events GROUP BY ledger ORDER BY ledger DESC LIMIT 20";

export default function AnalyticsSqlPage() {
  const [query, setQuery] = useState(EXAMPLE_QUERY);
  const [result, setResult] = useState<AnalyticsSqlResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function runQuery() {
    setBusy(true);
    setError("");
    try {
      setResult(await api.runAnalyticsQuery(query));
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setError("");
    try {
      const blob = await api.exportAnalyticsCsv(query);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "analytics.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const columns = result?.rows.length ? Object.keys(result.rows[0]) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1>Analytics SQL</h1>
        <p>Run a read-only query against curated analytics views. Results are capped at 1,000 rows.</p>
      </div>
      <label htmlFor="analytics-query">SQL query</label>
      <textarea
        id="analytics-query"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        rows={9}
        spellCheck={false}
        style={{ width: "100%", fontFamily: "monospace" }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={busy || !query.trim()} onClick={runQuery}>
          {busy ? "Running…" : "Run query"}
        </button>
        <button type="button" disabled={busy || !query.trim()} onClick={exportCsv}>Export CSV</button>
      </div>
      {error && <p role="alert" style={{ color: "#f85149" }}>{error}</p>}
      {result && (
        <section className="card" aria-live="polite">
          <p>
            {result.row_count} rows · {result.duration_ms} ms · plan cost {result.plan_cost}
            {result.truncated && " · results truncated"}
          </p>
          {columns.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr key={index}>
                      {columns.map((column) => (
                        <td key={column}><code>{JSON.stringify(row[column])}</code></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
