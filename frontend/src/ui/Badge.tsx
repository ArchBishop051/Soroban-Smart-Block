import React from "react";

export interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "info";
  size?: "sm" | "md";
}

/**
 * Accessible badge component with design token styling.
 * Used for status indicators, tags, and labels.
 */
export const Badge: React.FC<BadgeProps> = ({ children, variant = "default", size = "md" }) => {
  const baseStyles: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    fontFamily: "var(--font-family-base)",
    fontWeight: "var(--font-weight-semibold)",
    letterSpacing: "var(--letter-spacing-wide)",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    borderRadius: "var(--radius-full)",
    transition: "background var(--duration-normal) var(--ease-out), color var(--duration-normal) var(--ease-out)",
  };

  const variantStyles: Record<string, React.CSSProperties> = {
    default: {
      background: "var(--color-border-default)",
      color: "var(--color-text-primary)",
    },
    success: {
      background: "var(--color-success-bg)",
      color: "var(--color-success)",
    },
    warning: {
      background: "var(--color-warning-bg)",
      color: "var(--color-warning)",
    },
    error: {
      background: "var(--color-error-bg)",
      color: "var(--color-error)",
    },
    info: {
      background: "var(--color-info-bg)",
      color: "var(--color-info)",
    },
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: {
      padding: "var(--spacing-1) var(--spacing-2)",
      fontSize: "var(--font-size-xs)",
      height: "var(--spacing-5)",
    },
    md: {
      padding: "var(--spacing-1) var(--spacing-3)",
      fontSize: "var(--font-size-sm)",
      height: "var(--badge-height)",
    },
  };

  const combinedStyle = {
    ...baseStyles,
    ...variantStyles[variant],
    ...sizeStyles[size],
  };

  return <span style={combinedStyle}>{children}</span>;
};
