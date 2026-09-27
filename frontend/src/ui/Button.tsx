import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  children: React.ReactNode;
}

/**
 * Accessible button component with design token styling.
 * Supports variants, sizes, loading state, and full keyboard navigation.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      children,
      className = "",
      style = {},
      ...props
    },
    ref
  ) => {
    const baseStyles: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "var(--spacing-2)",
      fontFamily: "var(--font-family-base)",
      fontWeight: "var(--font-weight-semibold)",
      borderRadius: "var(--radius-lg)",
      border: "none",
      cursor: disabled || isLoading ? "not-allowed" : "pointer",
      transition: "background var(--duration-normal) var(--ease-out), color var(--duration-normal) var(--ease-out), opacity var(--duration-normal) var(--ease-out), transform var(--duration-fast) var(--ease-out)",
      opacity: disabled ? 0.5 : 1,
    };

    const variantStyles: Record<string, React.CSSProperties> = {
      primary: {
        background: "var(--color-accent-primary)",
        color: "var(--color-text-inverse)",
      },
      secondary: {
        background: "var(--color-bg-tertiary)",
        color: "var(--color-text-primary)",
        border: "1px solid var(--color-border-default)",
      },
      ghost: {
        background: "transparent",
        color: "var(--color-text-primary)",
      },
      danger: {
        background: "var(--color-error)",
        color: "var(--color-text-inverse)",
      },
    };

    const sizeStyles: Record<string, React.CSSProperties> = {
      sm: {
        height: "var(--button-height-sm)",
        padding: "0 var(--spacing-3)",
        fontSize: "var(--font-size-sm)",
      },
      md: {
        height: "var(--button-height-md)",
        padding: "0 var(--spacing-4)",
        fontSize: "var(--font-size-base)",
      },
      lg: {
        height: "var(--button-height-lg)",
        padding: "0 var(--spacing-6)",
        fontSize: "var(--font-size-md)",
      },
    };

    const combinedStyle = {
      ...baseStyles,
      ...variantStyles[variant],
      ...sizeStyles[size],
      ...style,
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={className}
        style={combinedStyle}
        aria-busy={isLoading}
        {...props}
      >
        {isLoading && (
          <span
            style={{
              display: "inline-block",
              width: "var(--spacing-3)",
              height: "var(--spacing-3)",
              border: "2px solid currentColor",
              borderRadius: "50%",
              borderRightColor: "transparent",
              animation: "spin 0.6s linear infinite",
            }}
          >
            <style>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </span>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
