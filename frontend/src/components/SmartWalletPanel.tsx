import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/**
 * Signers, policies and recent signer changes for a smart wallet (contract
 * account). Shows what the chain recorded; signatures are not re-verified.
 */
export default function SmartWalletPanel({ address }: { address: string }) {
  const { data, isError } = useQuery({
    queryKey: ["smart-wallet", address],
    queryFn: () => api.smartWallet(address),
    enabled: address.startsWith("C"),
    retry: false,
  });
  if (!data || isError) return null;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Smart wallet</h3>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>Signers and policies recorded on-chain.</p>
      <h4>Signers ({data.signers.length})</h4>
      {data.signers.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No active signers recorded.</p>
      ) : (
        <ul>
          {data.signers.map((s) => (
            <li key={s.key} style={{ fontFamily: "monospace", fontSize: 13 }}>
              {s.key.length > 20 ? `${s.key.slice(0, 10)}…${s.key.slice(-6)}` : s.key}{" "}
              <span className="badge">{s.type === "secp256r1" ? "passkey (secp256r1)" : s.type}</span>
              {s.expiration && <span style={{ color: "var(--muted)" }}> · session key, expires at ledger {s.expiration}</span>}
            </li>
          ))}
        </ul>
      )}
      {data.policies.length > 0 && (
        <>
          <h4>Policies ({data.policies.length})</h4>
          <ul>
            {data.policies.map((p) => (
              <li key={p.key} style={{ fontFamily: "monospace", fontSize: 13 }}>
                {p.key}
              </li>
            ))}
          </ul>
        </>
      )}
      {data.history.length > 0 && (
        <details>
          <summary>Signer history ({data.history.length})</summary>
          <ul>
            {data.history.map((h, i) => (
              <li key={i} style={{ fontSize: 13 }}>
                Ledger {h.ledger}: {h.description}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
