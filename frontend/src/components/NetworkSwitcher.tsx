import { useEffect, useRef, useState } from "react";
import { NETWORK_COLORS, useNetwork, type NetworkConfig } from "../contexts/NetworkContext";
import { sorobanRpcRequest } from "../services/sandbox-api";

type HealthState = "checking" | "connected" | "degraded" | "down";

interface Health {
  state: HealthState;
  latencyMs: number | null;
}

async function probeNetwork(rpcUrl: string): Promise<Health> {
  const start = performance.now();
  try {
    await sorobanRpcRequest(rpcUrl, "getNetwork");
    const latencyMs = Math.round(performance.now() - start);
    return { state: latencyMs > 1500 ? "degraded" : "connected", latencyMs };
  } catch {
    return { state: "down", latencyMs: null };
  }
}

const HEALTH_DOT: Record<HealthState, string> = {
  checking: "#6b7280",
  connected: "#22c55e",
  degraded: "#f59e0b",
  down: "#ef4444",
};

function NetworkBadge({ network }: { network: NetworkConfig }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: NETWORK_COLORS[network.kind],
        marginRight: 6,
      }}
    />
  );
}

export default function NetworkSwitcher() {
  const { networks, active, setActiveId, addCustomNetwork, removeCustomNetwork } = useNetwork();
  const [open, setOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [health, setHealth] = useState<Health>({ state: "checking", latencyMs: null });
  const [form, setForm] = useState({ name: "", rpcUrl: "", horizonUrl: "", passphrase: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setHealth({ state: "checking", latencyMs: null });
    probeNetwork(active.rpcUrl).then(h => {
      if (!cancelled) setHealth(h);
    });
    return () => { cancelled = true; };
  }, [active.id, active.rpcUrl]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowAddForm(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClickOutside);
    };
  }, []);

  async function handleAddNetwork(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim() || !form.rpcUrl.trim() || !form.passphrase.trim()) {
      setFormError("Name, RPC URL, and passphrase are required.");
      return;
    }
    setValidating(true);
    const probed = await probeNetwork(form.rpcUrl.trim());
    setValidating(false);
    if (probed.state === "down") {
      setFormError("Could not reach this RPC URL. Check the address and try again.");
      return;
    }
    const network = addCustomNetwork({
      name: form.name.trim(),
      rpcUrl: form.rpcUrl.trim(),
      horizonUrl: form.horizonUrl.trim(),
      passphrase: form.passphrase.trim(),
    });
    setActiveId(network.id);
    setForm({ name: "", rpcUrl: "", horizonUrl: "", passphrase: "" });
    setShowAddForm(false);
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Switch network (Ctrl+Shift+N)"
        style={{
          background: "transparent",
          border: "1px solid var(--border)",
          color: "var(--text)",
          borderRadius: 6,
          padding: "6px 12px",
          cursor: "pointer",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
        }}
      >
        <NetworkBadge network={active} />
        {active.name}
        <span style={{ marginLeft: 6, color: HEALTH_DOT[health.state] }}>●</span>
        {health.latencyMs != null && (
          <span style={{ marginLeft: 4, color: "var(--muted)", fontSize: 11 }}>{health.latencyMs}ms</span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 260,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            zIndex: 50,
            padding: 8,
          }}
        >
          {networks.map(n => (
            <div
              key={n.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 8px",
                borderRadius: 6,
                cursor: "pointer",
                background: n.id === active.id ? "var(--bg2, rgba(124,58,237,0.1))" : "transparent",
              }}
              onClick={() => { setActiveId(n.id); setOpen(false); }}
            >
              <span style={{ fontSize: 13, display: "flex", alignItems: "center" }}>
                <NetworkBadge network={n} />
                {n.name}
              </span>
              {n.custom && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); removeCustomNetwork(n.id); }}
                  title="Remove custom network"
                  style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12 }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          <div style={{ borderTop: "1px solid var(--border)", margin: "8px 0" }} />

          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              style={{
                width: "100%",
                background: "transparent",
                border: "1px dashed var(--border)",
                color: "var(--text)",
                borderRadius: 6,
                padding: "6px 8px",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              + Add custom network
            </button>
          ) : (
            <form onSubmit={handleAddNetwork} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                placeholder="Name (e.g. Local RPC)"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                style={{ fontSize: 12 }}
              />
              <input
                placeholder="RPC URL"
                value={form.rpcUrl}
                onChange={e => setForm(f => ({ ...f, rpcUrl: e.target.value }))}
                style={{ fontSize: 12 }}
              />
              <input
                placeholder="Horizon URL (optional)"
                value={form.horizonUrl}
                onChange={e => setForm(f => ({ ...f, horizonUrl: e.target.value }))}
                style={{ fontSize: 12 }}
              />
              <input
                placeholder="Network passphrase"
                value={form.passphrase}
                onChange={e => setForm(f => ({ ...f, passphrase: e.target.value }))}
                style={{ fontSize: 12 }}
              />
              {formError && <p style={{ color: "#f85149", fontSize: 11, margin: 0 }}>{formError}</p>}
              <div style={{ display: "flex", gap: 6 }}>
                <button type="submit" disabled={validating} style={{ flex: 1, fontSize: 12 }}>
                  {validating ? "Validating…" : "Save & switch"}
                </button>
                <button type="button" onClick={() => setShowAddForm(false)} style={{ fontSize: 12 }}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
