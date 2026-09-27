import React from "react";

export interface ToastProps {
  message: string;
  variant?: "success" | "error" | "warning" | "info";
  duration?: number;
  onClose?: () => void;
}

/**
 * Accessible toast component with design token styling.
 * Auto-dismisses after duration, supports manual close.
 */
export const Toast: React.FC<ToastProps> = ({ message, variant = "info", duration = 5000, onClose }) => {
  React.useEffect(() => {
    if (duration > 0) {
      const timer = window.setTimeout(() => {
        onClose?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const variantStyles: Record<string, React.CSSProperties> = {
    success: {
      background: "var(--color-success-bg)",
      color: "var(--color-success)",
      border: "1px solid var(--color-success)",
    },
    error: {
      background: "var(--color-error-bg)",
      color: "var(--color-error)",
      border: "1px solid var(--color-error)",
    },
    warning: {
      background: "var(--color-warning-bg)",
      color: "var(--color-warning)",
      border: "1px solid var(--color-warning)",
    },
    info: {
      background: "var(--color-info-bg)",
      color: "var(--color-info)",
      border: "1px solid var(--color-info)",
    },
  };

  const toastStyles: React.CSSProperties = {
    position: "fixed",
    bottom: "var(--spacing-6)",
    right: "var(--spacing-6)",
    padding: "var(--spacing-3) var(--spacing-4)",
    borderRadius: "var(--radius-lg)",
    fontSize: "var(--font-size-base)",
    fontWeight: "var(--font-weight-medium)",
    boxShadow: "var(--shadow-lg)",
    zIndex: "var(--z-index-popover)",
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-3)",
    minWidth: "300px",
    maxWidth: "500px",
    animation: "slideIn var(--duration-normal) var(--ease-out)",
    ...variantStyles[variant],
  };

  const closeButtonStyles: React.CSSProperties = {
    background: "transparent",
    border: "none",
    color: "inherit",
    cursor: "pointer",
    padding: "var(--spacing-1)",
    borderRadius: "var(--radius-sm)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.7,
    transition: "opacity var(--duration-fast) var(--ease-out)",
  };

  return (
    <>
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
      <div
        style={toastStyles}
        role="alert"
        aria-live="polite"
      >
        <span style={{ flex: 1 }}>{message}</span>
        {onClose && (
          <button
            onClick={onClose}
            style={closeButtonStyles}
            aria-label="Close toast"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = "0.7";
            }}
          >
            ✕
          </button>
        )}
      </div>
    </>
  );
};
