import React from "react";

export interface CardProps {
  children: React.ReactNode;
  variant?: "default" | "elevated" | "bordered";
  padding?: "none" | "sm" | "md" | "lg";
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Accessible card component with design token styling.
 * Used for grouping related content with optional elevation and borders.
 */
export const Card: React.FC<CardProps> = ({
  children,
  variant = "default",
  padding = "md",
  className = "",
  style = {},
}) => {
  const baseStyles: React.CSSProperties = {
    background: "var(--color-bg-secondary)",
    borderRadius: "var(--radius-lg)",
    transition: "background var(--duration-normal) var(--ease-out), border-color var(--duration-normal) var(--ease-out)",
  };

  const variantStyles: Record<string, React.CSSProperties> = {
    default: {
      border: "1px solid var(--color-border-default)",
    },
    elevated: {
      boxShadow: "var(--shadow-md)",
      border: "1px solid var(--color-border-muted)",
    },
    bordered: {
      border: "2px solid var(--color-border-default)",
    },
  };

  const paddingStyles: Record<string, React.CSSProperties> = {
    none: { padding: 0 },
    sm: { padding: "var(--spacing-3)" },
    md: { padding: "var(--spacing-5)" },
    lg: { padding: "var(--spacing-6)" },
  };

  const combinedStyle = {
    ...baseStyles,
    ...variantStyles[variant],
    ...paddingStyles[padding],
    ...style,
  };

  return (
    <div className={className} style={combinedStyle} role="region" aria-label="Card">
      {children}
    </div>
  );
};
