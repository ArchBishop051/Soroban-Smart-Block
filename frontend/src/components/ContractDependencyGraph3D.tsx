/**
 * 3D Live Contract Dependency Graph
 *
 * Renders a network-wide 3D force-directed graph of cross-contract calls.
 * Loads the initial snapshot from GET /api/contract-graph, then streams
 * live `contract_link` WebSocket events to add new edges in real time.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type GraphNode3D, type GraphLink3D } from "../api";
import { getGraphColors } from "../utils/themeTokens";

interface GraphData {
  nodes: GraphNode3D[];
  links: GraphLink3D[];
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export default function ContractDependencyGraph3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const dataRef = useRef<GraphData>({ nodes: [], links: [] });
  const [liveCount, setLiveCount] = useState(0);

  const {
    data: initial,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["contract-graph"],
    queryFn: () => api.contractGraph(500),
  });

  // Initialise the 3D graph once data arrives
  useEffect(() => {
    if (!initial || !containerRef.current) return;

    dataRef.current = {
      nodes: initial.nodes.map((n) => ({ ...n })),
      links: initial.links.map((l) => ({ ...l })),
    };

    import("3d-force-graph").then(({ default: ForceGraph3D }) => {
      if (!containerRef.current) return;

      const colors = getGraphColors();
      const graph = ForceGraph3D()(containerRef.current)
        .backgroundColor(colors.bg)
        .nodeId("id")
        .nodeLabel((n: any) => shortId(n.id))
        .nodeColor((n: any) => (n.callCount > 10 ? colors.nodeContract : colors.nodeWallet))
        .nodeVal((n: any) => Math.max(1, Math.log2(n.callCount + 1)) * 2)
        .linkColor(() => colors.edge)
        .linkWidth((l: any) => Math.min(Math.log2((l.value ?? 1) + 1), 4))
        .linkDirectionalArrowLength(4)
        .linkDirectionalArrowRelPos(1)
        .linkDirectionalParticles((l: any) => Math.min(l.value ?? 1, 4))
        .linkDirectionalParticleSpeed(0.005)
        .onNodeClick((n: any) => {
          window.location.href = `/contract/${n.id}`;
        })
        .graphData(dataRef.current);

      graphRef.current = graph;
    });

    return () => {
      graphRef.current?._destructor?.();
      graphRef.current = null;
    };
  }, [initial]);

  // Live WebSocket updates
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}`);

    ws.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data);
        if (payload.type !== "contract_link") return;

        const { caller, callee } = payload.data as {
          caller: string;
          callee: string;
          fn: string;
          ledger: number;
        };
        const g = graphRef.current;
        if (!g) return;

        const { nodes, links } = dataRef.current;

        let changed = false;
        if (!nodes.find((n) => n.id === caller)) {
          nodes.push({ id: caller, callCount: 0 });
          changed = true;
        }
        if (!nodes.find((n) => n.id === callee)) {
          nodes.push({ id: callee, callCount: 0 });
          changed = true;
        }

        const existing = links.find((l) => l.source === caller && l.target === callee);
        if (existing) {
          existing.value = (existing.value ?? 1) + 1;
        } else {
          links.push({ source: caller, target: callee, value: 1 });
          changed = true;
        }

        const node = nodes.find((n) => n.id === callee);
        if (node) node.callCount += 1;

        if (changed) g.graphData({ nodes: [...nodes], links: [...links] });
        setLiveCount((c) => c + 1);
      } catch {
        /* ignore */
      }
    };

    ws.onerror = (e) => console.error("[ws] graph error", e);
    return () => ws.close();
  }, []);

  if (isLoading) return <p style={{ color: "var(--muted)", padding: 24 }}>Loading graph…</p>;
  if (error) return <p style={{ color: "#ef4444", padding: 24 }}>Failed to load contract graph.</p>;

  const nodeCount = initial?.nodes.length ?? 0;
  const linkCount = initial?.links.length ?? 0;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 15 }}>Contract Dependency Graph</h2>
        <div
          style={{
            display: "flex",
            gap: 20,
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          <span>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#6366f1",
                marginRight: 4,
              }}
            />
            Contract
          </span>
          <span>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#f59e0b",
                marginRight: 4,
              }}
            />
            High-traffic (&gt;10 calls)
          </span>
          <span>
            {nodeCount} nodes · {linkCount} edges
          </span>
          {liveCount > 0 && <span style={{ color: "#22c55e" }}>+{liveCount} live</span>}
        </div>
      </div>
      <div ref={containerRef} style={{ width: "100%", height: 600 }} />
      <p
        style={{
          fontSize: 11,
          color: "var(--muted)",
          padding: "8px 16px",
          margin: 0,
        }}
      >
        Scroll to zoom · Drag to rotate · Click a node to open its contract page
      </p>
    </div>
  );
}
