import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { StatsRange } from "./InvocationFrequencyChart";
import { useTranslation } from "../i18n";

/** Daily event-count sparkline for the selected range — plain SVG, no chart library. */
function Sparkline({ data, label }: { data: { date: string; count: number }[]; label: string }) {
  const w = 300;
  const h = 40;
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const pts = data
    .map((d, i) => {
      const x = (i / (data.length - 1 || 1)) * w;
      const y = h - (d.count / maxCount) * h;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: "block", overflow: "visible" }}
      role="img"
      aria-label={label}
    >
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => {
        const x = (i / (data.length - 1 || 1)) * w;
        const y = h - (d.count / maxCount) * h;
        return (
          <circle key={d.date} cx={x} cy={y} r={2} fill="var(--accent)">
            <title>
              {d.date}: {d.count} event{d.count === 1 ? "" : "s"}
            </title>
          </circle>
        );
      })}
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

export default function ContractStatsWidget({
  contractId,
  range = 30,
}: {
  contractId: string;
  range?: StatsRange;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["contract-stats", contractId, range],
    queryFn: () => api.contractStats(contractId, range),
    enabled: !!contractId,
  });

  if (isLoading) return <p style={{ color: "var(--muted)" }}>{t("chart.loadingStats")}</p>;
  if (!data) return null;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <Stat label={t("chart.totalEvents")} value={data.total_events.toLocaleString()} />
        <Stat label={t("chart.uniqueCallers")} value={data.unique_callers.toLocaleString()} />
        <Stat label={t("chart.lastActivity")} value={data.last_seen_ledger != null ? t("chart.ledger", { ledger: data.last_seen_ledger.toLocaleString() }) : "—"} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{t("chart.eventsPerDay", { range })}</div>
        <Sparkline data={data.events_per_day} label={t("chart.dailyEventsLabel", { range })} />
        <ul className="sr-only" aria-label={t("chart.dataAlternative")}>
          {data.events_per_day.map((point) => (
            <li key={point.date}>{t(point.count === 1 ? "chart.dataPointOne" : "chart.dataPointMany", { label: point.date, count: point.count })}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
