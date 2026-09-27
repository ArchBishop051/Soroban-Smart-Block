import React from "react";

export interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

/**
 * Accessible tooltip component with design token styling.
 * Uses CSS positioning for simplicity, keyboard accessible via focus.
 */
export const Tooltip: React.FC<TooltipProps> = ({ children, content, placement = "top", delay = 200 }) => {
  const [isVisible, setIsVisible] = React.useState(false);
  const timeoutRef = React.useRef<number>();

  const showTooltip = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setIsVisible(true), delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
  };

  const placementStyles: Record<string, React.CSSProperties> = {
    top: {
      bottom: "calc(100% + var(--spacing-2))",
      left: "50%",
      transform: "translateX(-50%)",
    },
    bottom: {
      top: "calc(100% + var(--spacing-2))",
      left: "50%",
      transform: "translateX(-50%)",
    },
    left: {
      right: "calc(100% + var(--spacing-2))",
      top: "50%",
      transform: "translateY(-50%)",
    },
    right: {
      left: "calc(100% + var(--spacing-2))",
      top: "50%",
      transform: "translateY(-50%)",
    },
  };

  const tooltipStyles: React.CSSProperties = {
    position: "absolute",
    zIndex: "var(--z-index-tooltip)",
    padding: "var(--spacing-2) var(--spacing-3)",
    background: "var(--color-bg-elevated)",
    color: "var(--color-text-primary)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "var(--radius-md)",
    fontSize: "var(--font-size-sm)",
    fontWeight: "var(--font-weight-normal)",
    whiteSpace: "nowrap",
    boxShadow: "var(--shadow-lg)",
    opacity: isVisible ? 1 : 0,
    pointerEvents: "none",
    transition: `opacity var(--duration-fast) var(--ease-out)`,
    ...placementStyles[placement],
  };

  const wrapperStyles: React.CSSProperties = {
    position: "relative",
    display: "inline-block",
  };

  return (
    <div
      style={wrapperStyles}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      <span role="tooltip" style={tooltipStyles} aria-hidden={!isVisible}>
        {content}
      </span>
    </div>
  );
};
