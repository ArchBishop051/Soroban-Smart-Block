/**
 * Ink UI for `soroban-explorer tui`: a live event list, filter bar and detail
 * pane. Only the visible window of rows is rendered (virtualised), and redraws
 * are driven by the throttled EventStore, not by every incoming event.
 *
 * Keys: ↑/↓ or j/k move · PgUp/PgDn page · enter toggle detail · / filter ·
 *       space pause/resume · x expand long values · e export NDJSON · q quit
 */
import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { compileFilter } from "./filter.js";

const h = React.createElement;

const truncate = (value, width) => {
  const s = String(value ?? "");
  return s.length > width ? `${s.slice(0, Math.max(0, width - 1))}…` : s;
};

function useSize() {
  const { stdout } = useStdout();
  const read = () => ({ columns: stdout?.columns || 80, rows: stdout?.rows || 24 });
  const [size, setSize] = useState(read);
  useEffect(() => {
    if (!stdout?.on) return undefined;
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => stdout.off("resize", onResize);
  }, [stdout]);
  return size;
}

function Detail({ ev, width, expanded }) {
  const limit = expanded ? Infinity : width * 3;
  const field = (label, value) =>
    h(Box, { key: label },
      h(Text, { dimColor: true }, `${label.padEnd(12)} `),
      h(Text, { wrap: "wrap" }, truncate(typeof value === "string" ? value : JSON.stringify(value ?? null), limit)));
  return h(Box, { flexDirection: "column", borderStyle: "single", paddingX: 1 },
    h(Text, { bold: true }, `Event #${ev.seq ?? "?"} — ${ev.function}`),
    field("Contract", ev.contract_id),
    field("Ledger", String(ev.ledger)),
    field("Tx", ev.tx_hash),
    field("Summary", ev.description),
    field("Args", ev.decoded_args ?? ev.args ?? ev.raw_data),
    field("Auth tree", ev.auth_tree ?? null),
    field("Raw XDR", ev.raw_xdr ?? ev.raw_topics),
    expanded ? null : h(Text, { dimColor: true }, "x: expand long values"));
}

export function App({ store, exportView, initialFilter = "", status: initialStatus = "connecting", color = true, statusRef }) {
  const { exit } = useApp();
  const { columns, rows } = useSize();
  const version = useSyncExternalStore((fn) => store.subscribe(fn), () => store.version);
  const [filter, setFilter] = useState(initialFilter);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialFilter);
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (statusRef) statusRef.current = setStatus;
  }, [statusRef]);

  const visible = useMemo(() => {
    try {
      return store.events.filter(compileFilter(filter));
    } catch {
      return store.events;
    }
  }, [version, filter]);

  const compact = columns < 60 || rows < 12;
  const listHeight = Math.max(3, rows - (detail && !compact ? 14 : 5));
  const selected = Math.min(cursor, Math.max(0, visible.length - 1));
  const start = Math.max(0, Math.min(selected - Math.floor(listHeight / 2), visible.length - listHeight));
  const windowRows = visible.slice(start, start + listHeight);

  useInput((input, key) => {
    if (editing) {
      if (key.return) {
        setFilter(draft);
        setEditing(false);
        setCursor(0);
      } else if (key.escape) {
        setDraft(filter);
        setEditing(false);
      } else if (key.backspace || key.delete) {
        setDraft((d) => d.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setDraft((d) => d + input);
      }
      return;
    }
    if (input === "q" || (key.ctrl && input === "c")) exit();
    else if (key.downArrow || input === "j") setCursor(Math.min(selected + 1, visible.length - 1));
    else if (key.upArrow || input === "k") setCursor(Math.max(selected - 1, 0));
    else if (key.pageDown) setCursor(Math.min(selected + listHeight, visible.length - 1));
    else if (key.pageUp) setCursor(Math.max(selected - listHeight, 0));
    else if (key.return) setDetail((d) => !d);
    else if (input === "/") {
      setDraft(filter);
      setEditing(true);
    } else if (input === " ") store.setPaused(!store.paused);
    else if (input === "x") setExpanded((x) => !x);
    else if (input === "e") {
      Promise.resolve(exportView(visible))
        .then((file) => setNotice(`exported ${visible.length} events → ${file}`))
        .catch((err) => setNotice(`export failed: ${err.message}`));
    }
  });

  const fnWidth = compact ? 12 : 20;
  const contractWidth = compact ? 8 : 14;
  const descWidth = Math.max(10, columns - fnWidth - contractWidth - 16);

  return h(Box, { flexDirection: "column" },
    h(Box, null,
      h(Text, { bold: true, color: color ? "cyan" : undefined }, "soroban-explorer tui "),
      h(Text, { dimColor: true }, `${status}${store.paused ? ` · PAUSED (${store.pending.length} queued)` : ""} · ${visible.length}/${store.events.length} shown · ${store.received} received`)),
    h(Box, null,
      h(Text, { color: color ? "yellow" : undefined }, "filter: "),
      h(Text, { inverse: editing }, editing ? `${draft}█` : filter || "(none — press / to filter)")),
    ...windowRows.map((ev, i) => {
      const isSel = start + i === selected;
      return h(Box, { key: `${ev.contract_id}:${ev.ledger}:${ev.tx_hash}` },
        h(Text, { inverse: isSel },
          `${isSel ? "›" : " "} ${String(ev.ledger ?? "").padStart(8)} `,
          h(Text, { color: color ? "yellow" : undefined }, truncate(ev.contract_id, contractWidth).padEnd(contractWidth)),
          " ",
          h(Text, { color: color ? "green" : undefined }, truncate(ev.function, fnWidth).padEnd(fnWidth)),
          " ",
          truncate(ev.description, descWidth)));
    }),
    visible.length === 0 ? h(Text, { dimColor: true }, "waiting for events…") : null,
    detail && visible[selected] ? h(Detail, { ev: visible[selected], width: columns, expanded }) : null,
    h(Text, { dimColor: true }, notice || "↑↓ move · enter detail · / filter · space pause · e export · q quit"));
}
