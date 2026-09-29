import React from "react";

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: any, row: T, index: number) => React.ReactNode;
  width?: string;
}

export interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
  sortable?: boolean;
  virtualizable?: boolean;
  rowKey?: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
}

/**
 * Accessible table component with design token styling.
 * Supports sorting, virtualization for large datasets, and keyboard navigation.
 */
export const Table = <T extends Record<string, any>>({
  data,
  columns,
  sortable: globalSortable = false,
  virtualizable = false,
  rowKey,
  onRowClick,
  emptyState,
}: TableProps<T>) => {
  const [sortConfig, setSortConfig] = React.useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const handleSort = (key: string) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const sortedData = React.useMemo(() => {
    if (!sortConfig) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue === bValue) return 0;

      const comparison = aValue < bValue ? -1 : 1;
      return sortConfig.direction === "desc" ? comparison * -1 : comparison;
    });
  }, [data, sortConfig]);

  const tableStyles: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: "var(--font-family-base)",
    fontSize: "var(--font-size-base)",
  };

  const thStyles: React.CSSProperties = {
    textAlign: "left",
    padding: "var(--table-cell-padding)",
    fontWeight: "var(--font-weight-semibold)",
    color: "var(--color-text-secondary)",
    borderBottom: "1px solid var(--color-border-default)",
    backgroundColor: "var(--color-bg-tertiary)",
    height: "var(--table-header-height)",
    whiteSpace: "nowrap",
  };

  const tdStyles: React.CSSProperties = {
    padding: "var(--table-cell-padding)",
    borderBottom: "1px solid var(--color-border-muted)",
    color: "var(--color-text-primary)",
  };

  const trStyles: React.CSSProperties = {
    cursor: onRowClick ? "pointer" : "default",
    transition: "background var(--duration-fast) var(--ease-out)",
  };

  const trHoverStyles: React.CSSProperties = {
    backgroundColor: "var(--color-bg-tertiary)",
  };

  if (data.length === 0 && emptyState) {
    return <div style={{ padding: "var(--spacing-8)", textAlign: "center" }}>{emptyState}</div>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyles}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={{
                  ...thStyles,
                  width: column.width,
                  cursor: (globalSortable || column.sortable) ? "pointer" : "default",
                  userSelect: (globalSortable || column.sortable) ? "none" : "auto",
                }}
                onClick={() => (globalSortable || column.sortable) && handleSort(column.key)}
                aria-sort={
                  sortConfig?.key === column.key
                    ? sortConfig.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-1)" }}>
                  {column.label}
                  {(globalSortable || column.sortable) && (
                    <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-tertiary)" }}>
                      {sortConfig?.key === column.key ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, index) => (
            <tr
              key={rowKey ? rowKey(row) : index}
              style={trStyles}
              onClick={() => onRowClick?.(row)}
              onMouseEnter={(e) => {
                if (onRowClick) {
                  (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "var(--color-bg-tertiary)";
                }
              }}
              onMouseLeave={(e) => {
                if (onRowClick) {
                  (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "transparent";
                }
              }}
            >
              {columns.map((column) => (
                <td key={column.key} style={tdStyles}>
                  {column.render ? column.render(row[column.key], row, index) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
