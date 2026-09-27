import React from "react";

export interface CopyableTextProps {
  text: string;
  displayText?: string;
  truncate?: boolean;
  truncateLength?: number;
  onCopy?: () => void;
}

/**
 * Accessible copyable text component with design token styling.
 * Copies text to clipboard on click with visual feedback.
 */
export const CopyableText: React.FC<CopyableTextProps> = ({
  text,
  displayText,
  truncate = false,
  truncateLength = 20,
  onCopy,
}) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const displayValue = displayText || text;
  const truncatedValue = truncate && displayValue.length > truncateLength
    ? `${displayValue.slice(0, truncateLength)}...`
    : displayValue;

  const containerStyles: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    position: "relative",
  };

  const textStyles: React.CSSProperties = {
    fontFamily: "var(--font-family-mono)",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-primary)",
  };

  const buttonStyles: React.CSSProperties = {
    background: "transparent",
    border: "none",
    color: "var(--color-text-tertiary)",
    cursor: "pointer",
    padding: "var(--spacing-1)",
    borderRadius: "var(--radius-sm)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "color var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out)",
    opacity: 0.6,
  };

  const tooltipStyles: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + var(--spacing-2))",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "var(--spacing-1) var(--spacing-2)",
    background: "var(--color-success)",
    color: "var(--color-text-inverse)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-size-xs)",
    fontWeight: "var(--font-weight-medium)",
    whiteSpace: "nowrap",
    zIndex: "var(--z-index-tooltip)",
    opacity: copied ? 1 : 0,
    pointerEvents: "none",
    transition: "opacity var(--duration-fast) var(--ease-out)",
  };

  return (
    <div style={containerStyles}>
      <span style={textStyles} title={text}>
        {truncatedValue}
      </span>
      <button
        onClick={handleCopy}
        style={buttonStyles}
        aria-label="Copy to clipboard"
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "1";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--color-accent-primary)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "0.6";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-tertiary)";
        }}
      >
        📋
      </button>
      <span style={tooltipStyles} role="status" aria-live="polite">
        Copied!
      </span>
    </div>
  );
};
