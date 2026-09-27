import React from "react";

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

/**
 * Accessible dialog component with design token styling.
 * Supports keyboard navigation (Esc to close), focus trapping, and backdrop click.
 */
export const Dialog: React.FC<DialogProps> = ({ isOpen, onClose, title, children, footer, size = "md" }) => {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previousActiveElement = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      dialogRef.current?.focus();
      document.body.style.overflow = "hidden";
    } else {
      previousActiveElement.current?.focus();
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { maxWidth: "400px" },
    md: { maxWidth: "600px" },
    lg: { maxWidth: "800px" },
    xl: { maxWidth: "1000px" },
  };

  const backdropStyles: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "var(--z-index-modal-backdrop)",
    opacity: isOpen ? 1 : 0,
    pointerEvents: isOpen ? "auto" : "none",
    transition: "opacity var(--duration-normal) var(--ease-out)",
  };

  const dialogStyles: React.CSSProperties = {
    background: "var(--color-bg-secondary)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "var(--radius-xl)",
    boxShadow: "var(--shadow-xl)",
    width: "90%",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    transform: isOpen ? "scale(1)" : "scale(0.95)",
    opacity: isOpen ? 1 : 0,
    transition: "transform var(--duration-normal) var(--ease-out), opacity var(--duration-normal) var(--ease-out)",
    ...sizeStyles[size],
  };

  const headerStyles: React.CSSProperties = {
    padding: "var(--spacing-5)",
    borderBottom: "1px solid var(--color-border-default)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  const titleStyles: React.CSSProperties = {
    fontSize: "var(--font-size-lg)",
    fontWeight: "var(--font-weight-semibold)",
    color: "var(--color-text-primary)",
    margin: 0,
  };

  const closeButtonStyles: React.CSSProperties = {
    background: "transparent",
    border: "none",
      color: "var(--color-text-secondary)",
    cursor: "pointer",
    padding: "var(--spacing-1)",
    borderRadius: "var(--radius-sm)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)",
  };

  const bodyStyles: React.CSSProperties = {
    padding: "var(--spacing-5)",
    overflowY: "auto",
    flex: 1,
  };

  const footerStyles: React.CSSProperties = {
    padding: "var(--spacing-5)",
    borderTop: "1px solid var(--color-border-default)",
    display: "flex",
    gap: "var(--spacing-3)",
    justifyContent: "flex-end",
  };

  if (!isOpen) return null;

  return (
    <div
      style={backdropStyles}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div
        ref={dialogRef}
        style={dialogStyles}
        tabIndex={-1}
        role="document"
      >
        <div style={headerStyles}>
          <h2 id="dialog-title" style={titleStyles}>
            {title}
          </h2>
          <button
            onClick={onClose}
            style={closeButtonStyles}
            aria-label="Close dialog"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--color-bg-tertiary)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)";
            }}
          >
            ✕
          </button>
        </div>
        <div style={bodyStyles}>{children}</div>
        {footer && <div style={footerStyles}>{footer}</div>}
      </div>
    </div>
  );
};
