import { useState, useCallback, useEffect } from "react";
import { api } from "../api";
import type { EventFilter, EventCondition, EventFilterGroup, DecodedEvent } from "../api";
import EventTable from "../components/EventTable";

const FIELD_OPTIONS = [
  { value: "contract", label: "Contract ID", type: "string" },
  { value: "function", label: "Function Name", type: "string" },
  { value: "ledger", label: "Ledger", type: "number" },
  { value: "type", label: "Type (soroban/classic)", type: "string" },
  { value: "topic[0]", label: "Topic[0] (Event Name)", type: "string" },
  { value: "topic[1]", label: "Topic[1]", type: "string" },
  { value: "topic[2]", label: "Topic[2]", type: "string" },
  { value: "topic[3]", label: "Topic[3]", type: "string" },
  { value: "arg.amount", label: "Arg: amount", type: "string" },
  { value: "arg.from", label: "Arg: from", type: "string" },
  { value: "arg.to", label: "Arg: to", type: "string" },
];

const OPERATOR_OPTIONS = [
  { value: "eq", label: "Equals" },
  { value: "ne", label: "Not Equals" },
  { value: "gt", label: "Greater Than" },
  { value: "lt", label: "Less Than" },
  { value: "gte", label: "Greater or Equal" },
  { value: "lte", label: "Less or Equal" },
  { value: "contains", label: "Contains" },
  { value: "starts_with", label: "Starts With" },
  { value: "ends_with", label: "Ends With" },
  { value: "in", label: "In (list)" },
];

const LOGICAL_OPERATORS = ["and", "or", "not"];

interface FilterNode {
  id: string;
  type: "condition" | "group";
  data?: EventCondition;
  children?: FilterNode[];
  operator?: "and" | "or" | "not";
}

export default function FilterBuilder() {
  const [filterTree, setFilterTree] = useState<FilterNode>({
    id: "root",
    type: "group",
    operator: "and",
    children: [],
  });
  const [dslText, setDslText] = useState("");
  const [mode, setMode] = useState<"visual" | "dsl">("visual");
  const [previewEvents, setPreviewEvents] = useState<DecodedEvent[]>([]);
  const [previewCost, setPreviewCost] = useState<number>(0);
  const [previewError, setPreviewError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);

  // Convert filter tree to DSL object
  const treeToDsl = useCallback((node: FilterNode): EventFilter => {
    if (node.type === "condition" && node.data) {
      return node.data;
    }
    if (node.type === "group" && node.children) {
      return {
        operator: node.operator || "and",
        conditions: node.children.map(treeToDsl),
      } as EventFilterGroup;
    }
    throw new Error("Invalid filter node");
  }, []);

  // Convert DSL object to filter tree
  const dslToTree = useCallback((filter: EventFilter, parentId = "node"): FilterNode => {
    const isGroup = "operator" in filter && "conditions" in filter;
    if (isGroup) {
      const group = filter as EventFilterGroup;
      return {
        id: `${parentId}-${Math.random().toString(36).substr(2, 9)}`,
        type: "group",
        operator: group.operator,
        children: group.conditions.map((c, i) => dslToTree(c, `${parentId}-${i}`)),
      };
    } else {
      const condition = filter as EventCondition;
      return {
        id: `${parentId}-${Math.random().toString(36).substr(2, 9)}`,
        type: "condition",
        data: condition,
      };
    }
  }, []);

  // Sync visual tree to DSL text
  useEffect(() => {
    if (mode === "visual") {
      try {
        const dsl = treeToDsl(filterTree);
        setDslText(JSON.stringify(dsl, null, 2));
      } catch (e) {
        setDslText("// Invalid filter");
      }
    }
  }, [filterTree, mode, treeToDsl]);

  // Sync DSL text to visual tree
  const handleDslChange = useCallback((text: string) => {
    setDslText(text);
    try {
      const parsed = JSON.parse(text);
      const tree = dslToTree(parsed);
      setFilterTree(tree);
      setPreviewError("");
    } catch (e) {
      setPreviewError("Invalid JSON DSL");
    }
  }, [dslToTree]);

  // Debounced preview
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!dslText || dslText.startsWith("//")) return;
      
      try {
        setIsLoading(true);
        setPreviewError("");
        const filter = JSON.parse(dslText);
        const result = await api.filterEvents({ filter, limit: 10 });
        setPreviewEvents(result.data);
        setPreviewCost(result.cost);
        setNextCursor(result.next_cursor);
      } catch (e: any) {
        setPreviewError(e.message || "Failed to fetch events");
        setPreviewEvents([]);
      } finally {
        setIsLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [dslText]);

  // Add condition to group
  const addCondition = useCallback((parentId: string) => {
    const addToNode = (node: FilterNode): FilterNode => {
      if (node.id === parentId && node.type === "group") {
        return {
          ...node,
          children: [
            ...(node.children || []),
            {
              id: `${parentId}-${Date.now()}`,
              type: "condition",
              data: { field: "contract", operator: "eq", value: "" },
            },
          ],
        };
      }
      if (node.children) {
        return {
          ...node,
          children: node.children.map(addToNode),
        };
      }
      return node;
    };
    setFilterTree(addToNode(filterTree));
  }, [filterTree]);

  // Add nested group
  const addGroup = useCallback((parentId: string) => {
    const addToNode = (node: FilterNode): FilterNode => {
      if (node.id === parentId && node.type === "group") {
        return {
          ...node,
          children: [
            ...(node.children || []),
            {
              id: `${parentId}-${Date.now()}`,
              type: "group",
              operator: "and",
              children: [],
            },
          ],
        };
      }
      if (node.children) {
        return {
          ...node,
          children: node.children.map(addToNode),
        };
      }
      return node;
    };
    setFilterTree(addToNode(filterTree));
  }, [filterTree]);

  // Update condition
  const updateCondition = useCallback((nodeId: string, updates: Partial<EventCondition>) => {
    const updateNode = (node: FilterNode): FilterNode => {
      if (node.id === nodeId && node.type === "condition") {
        return {
          ...node,
          data: { ...node.data, ...updates } as EventCondition,
        };
      }
      if (node.children) {
        return {
          ...node,
          children: node.children.map(updateNode),
        };
      }
      return node;
    };
    setFilterTree(updateNode(filterTree));
  }, [filterTree]);

  // Update group operator
  const updateGroupOperator = useCallback((nodeId: string, operator: "and" | "or" | "not") => {
    const updateNode = (node: FilterNode): FilterNode => {
      if (node.id === nodeId && node.type === "group") {
        return { ...node, operator };
      }
      if (node.children) {
        return {
          ...node,
          children: node.children.map(updateNode),
        };
      }
      return node;
    };
    setFilterTree(updateNode(filterTree));
  }, [filterTree]);

  // Remove node
  const removeNode = useCallback((nodeId: string) => {
    const removeFromNode = (node: FilterNode): FilterNode | null => {
      if (node.id === nodeId) return null;
      if (node.children) {
        const filtered = node.children.map(removeFromNode).filter(Boolean) as FilterNode[];
        return { ...node, children: filtered };
      }
      return node;
    };
    const updated = removeFromNode(filterTree);
    if (updated) setFilterTree(updated);
  }, [filterTree]);

  // Render filter tree
  const renderNode = (node: FilterNode, depth = 0): JSX.Element => {
    const indent = depth * 24;

    if (node.type === "condition" && node.data) {
      return (
        <div key={node.id} style={{ marginLeft: indent, marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={node.data.field}
            onChange={(e) => updateCondition(node.id, { field: e.target.value })}
            style={{ padding: 6, borderRadius: 4, border: "1px solid var(--border)" }}
          >
            {FIELD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            value={node.data.operator}
            onChange={(e) => updateCondition(node.id, { operator: e.target.value as any })}
            style={{ padding: 6, borderRadius: 4, border: "1px solid var(--border)" }}
          >
            {OPERATOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={node.data.value}
            onChange={(e) => updateCondition(node.id, { value: e.target.value })}
            placeholder="Value"
            style={{ padding: 6, borderRadius: 4, border: "1px solid var(--border)", flex: 1 }}
          />

          <button
            onClick={() => removeNode(node.id)}
            style={{ padding: "4px 8px", background: "#ef4444", color: "white", border: "none", borderRadius: 4 }}
          >
            ×
          </button>
        </div>
      );
    }

    if (node.type === "group") {
      return (
        <div key={node.id} style={{ marginLeft: indent, marginBottom: 16, borderLeft: `2px solid var(--accent)`, paddingLeft: 16 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <select
              value={node.operator}
              onChange={(e) => updateGroupOperator(node.id, e.target.value as any)}
              style={{ padding: 6, borderRadius: 4, border: "1px solid var(--border)", fontWeight: "bold" }}
            >
              {LOGICAL_OPERATORS.map((op) => (
                <option key={op} value={op} style={{ textTransform: "uppercase" }}>
                  {op}
                </option>
              ))}
            </select>

            <button
              onClick={() => addCondition(node.id)}
              style={{ padding: "4px 8px", background: "var(--accent)", color: "white", border: "none", borderRadius: 4 }}
            >
              + Condition
            </button>

            <button
              onClick={() => addGroup(node.id)}
              style={{ padding: "4px 8px", background: "#6366f1", color: "white", border: "none", borderRadius: 4 }}
            >
              + Group
            </button>

            {depth > 0 && (
              <button
                onClick={() => removeNode(node.id)}
                style={{ padding: "4px 8px", background: "#ef4444", color: "white", border: "none", borderRadius: 4 }}
              >
                ×
              </button>
            )}
          </div>

          {node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    return <></>;
  };

  const getCostColor = (cost: number) => {
    if (cost < 30) return "#10b981";
    if (cost < 60) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 24 }}>Event Filter Builder</h1>

      <div style={{ display: "flex", gap: 24, marginBottom: 24 }}>
        <button
          onClick={() => setMode("visual")}
          style={{
            padding: "8px 16px",
            background: mode === "visual" ? "var(--accent)" : "transparent",
            color: mode === "visual" ? "white" : "var(--text)",
            border: `1px solid ${mode === "visual" ? "var(--accent)" : "var(--border)"}`,
            borderRadius: 4,
          }}
        >
          Visual Builder
        </button>
        <button
          onClick={() => setMode("dsl")}
          style={{
            padding: "8px 16px",
            background: mode === "dsl" ? "var(--accent)" : "transparent",
            color: mode === "dsl" ? "white" : "var(--text)",
            border: `1px solid ${mode === "dsl" ? "var(--accent)" : "var(--border)"}`,
            borderRadius: 4,
          }}
        >
          DSL Editor
        </button>
      </div>

      {mode === "visual" ? (
        <div style={{ background: "var(--bg-secondary)", padding: 24, borderRadius: 8, marginBottom: 24 }}>
          <h2 style={{ marginBottom: 16 }}>Filter Conditions</h2>
          {renderNode(filterTree)}
          {filterTree.children?.length === 0 && (
            <button
              onClick={() => addCondition(filterTree.id)}
              style={{ padding: "8px 16px", background: "var(--accent)", color: "white", border: "none", borderRadius: 4 }}
            >
              + Add First Condition
            </button>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <textarea
            value={dslText}
            onChange={(e) => handleDslChange(e.target.value)}
            placeholder='{"operator": "and", "conditions": [{"field": "contract", "operator": "eq", "value": "C..."}]}'
            style={{
              width: "100%",
              height: 200,
              padding: 16,
              fontFamily: "monospace",
              fontSize: 14,
              background: "var(--bg-secondary)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--muted)" }}>Query Cost:</span>
          <span
            style={{
              padding: "4px 12px",
              borderRadius: 12,
              background: `${getCostColor(previewCost)}20`,
              color: getCostColor(previewCost),
              fontWeight: "bold",
            }}
          >
            {previewCost}/100
          </span>
        </div>

        {previewError && (
          <span style={{ color: "#ef4444" }}>{previewError}</span>
        )}

        {isLoading && (
          <span style={{ color: "var(--muted)" }}>Loading preview...</span>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 16 }}>Live Preview</h2>
        <EventTable events={previewEvents} />
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <button
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.set("filter", encodeURIComponent(dslText));
            navigator.clipboard.writeText(url.toString());
          }}
          style={{ padding: "8px 16px", background: "var(--accent)", color: "white", border: "none", borderRadius: 4 }}
        >
          Copy Share Link
        </button>
        <button
          onClick={() => {
            navigator.clipboard.writeText(dslText);
          }}
          style={{ padding: "8px 16px", background: "#6366f1", color: "white", border: "none", borderRadius: 4 }}
        >
          Copy DSL
        </button>
      </div>
    </div>
  );
}
