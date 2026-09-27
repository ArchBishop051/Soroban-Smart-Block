import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";

const sections = ["summary", "invocations", "authorization", "footprint", "events", "diagnostics", "xdr"];

export default function TransactionPage() {
  const { hash = "" } = useParams();
  const { data, error, isLoading } = useQuery({
    queryKey: ["transaction", hash],
    queryFn: () => api.transaction(hash),
    enabled: /^[a-fA-F0-9]{64}$/.test(hash),
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 3000 : false),
  });

  if (!/^[a-fA-F0-9]{64}$/.test(hash)) return <p>Invalid transaction hash.</p>;
  if (isLoading) return <p role="status">Loading transaction…</p>;
  if (error) {
    return (
      <div className="card" role="alert">
        <h1>Transaction not found</h1>
        <p>{(error as Error).message}</p>
      </div>
    );
  }
  if (!data) return <p>Transaction not found.</p>;
  if (data.status === "pending") {
    return (
      <div className="card" role="status">
        <h1>Transaction pending</h1>
        <p>This transaction has not appeared in a ledger yet. Checking again automatically.</p>
        <code>{hash}</code>
      </div>
    );
  }

  const xdr = [
    ["Envelope XDR", data.envelope_xdr],
    ["Result XDR", data.result_xdr],
    ["Result metadata XDR", data.result_meta_xdr],
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1>Transaction</h1>
      <nav aria-label="Transaction sections" className="card" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {sections.map((section) => (
          <a key={section} href={`#${section}`}>{section}</a>
        ))}
      </nav>

      <section id="summary" className="card">
        <h2>Summary</h2>
        <p><strong>Status:</strong> {data.status}</p>
        <p><strong>Hash:</strong> <code>{data.tx_hash}</code></p>
        {data.ledger != null && <p><strong>Ledger:</strong> {data.ledger.toLocaleString()}</p>}
        {data.created_at != null && <p><strong>Time:</strong> {new Date(data.created_at * 1000).toLocaleString()}</p>}
        {data.application_order != null && <p><strong>Application order:</strong> {data.application_order}</p>}
        {data.fee_bump && <p><strong>Fee bump:</strong> {data.fee_source ?? "sponsored transaction"}</p>}
        <button type="button" onClick={() => navigator.clipboard.writeText(data.tx_hash)}>Copy transaction hash</button>
      </section>

      <section id="invocations" className="card">
        <h2>Invocation tree ({data.invocations.length})</h2>
        {data.invocations.length ? (
          <ol>
            {data.invocations.map((invocation) => (
              <li key={invocation.id} style={{ marginLeft: Math.min(invocation.depth, 20) * 12 }}>
                <Link to={`/contract/${invocation.contract_id}`}>{invocation.contract_id}</Link>
                {" · "}{invocation.function}
                <details><summary>Arguments</summary><pre>{JSON.stringify(invocation.args, null, 2)}</pre></details>
              </li>
            ))}
          </ol>
        ) : <p>No indexed invocations are available.</p>}
      </section>

      <section id="authorization" className="card">
        <h2>Authorization</h2>
        <p>Authorization entries are available in the transaction envelope XDR.</p>
      </section>

      <section id="footprint" className="card">
        <h2>Footprint</h2>
        <p>Ledger footprint details are available in the transaction result metadata XDR.</p>
      </section>

      <section id="events" className="card">
        <h2>Events ({data.events.length})</h2>
        {data.events.length ? (
          <ol>{data.events.map((event) => (
            <li key={event.seq}><Link to={`/event/${event.seq}`}>{event.description || event.function}</Link> · ledger {event.ledger}</li>
          ))}</ol>
        ) : <p>No indexed events are available.</p>}
      </section>

      <section id="diagnostics" className="card">
        <h2>Diagnostics</h2>
        {data.diagnostic_events_xdr?.length
          ? <pre>{data.diagnostic_events_xdr.join("\n")}</pre>
          : <p>No diagnostic events returned.</p>}
      </section>

      <section id="xdr" className="card">
        <h2>Raw XDR</h2>
        <Link to="/xdr">View in XDR inspector</Link>
        {xdr.map(([label, value]) => (
          <details key={label}>
            <summary>{label}</summary>
            {value ? <pre style={{ overflowWrap: "anywhere" }}>{value}</pre> : <p>Unavailable.</p>}
          </details>
        ))}
      </section>
    </div>
  );
}
