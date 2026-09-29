import React from "react";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/**
 * Accessible empty state component with design token styling.
 * Used when there's no data to display.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => {
  const containerStyles: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--spacing-12) var(--spacing-6)",
    textAlign: "center",
    gap: "var(--spacing-4)",
  };

  const iconStyles: React.CSSProperties = {
    fontSize: "var(--font-size-3xl)",
    color: "var(--color-text-tertiary)",
    marginBottom: "var(--spacing-2)",
  };

  const titleStyles: React.CSSProperties = {
    fontSize: "var(--font-size-lg)",
    fontWeight: "var(--font-weight-semibold)",
    color: "var(--color-text-primary)",
    margin: 0,
  };

  const descriptionStyles: React.CSSProperties = {
    fontSize: "var(--font-size-base)",
    color: "var(--color-text-secondary)",
    maxWidth: "400px",
    margin: 0,
  };

  return (
    <div style={containerStyles} role="status" aria-live="polite">
      {icon && <div style={iconStyles}>{icon}</div>}
      <h3 style={titleStyles}>{title}</h3>
      {description && <p style={descriptionStyles}>{description}</p>}
      {action && <div>{action}</div>}
    </div>
  );
};
