import React from "react";

export interface AmountProps {
  value: number | string;
  decimals?: number;
  symbol?: string;
  showSymbol?: boolean;
  format?: "standard" | "compact" | "full";
  colorize?: boolean;
}

/**
 * Accessible amount component with design token styling.
 * Displays token amounts with optional formatting and colorization.
 */
export const Amount: React.FC<AmountProps> = ({
  value,
  decimals = 7,
  symbol,
  showSymbol = true,
  format = "standard",
  colorize = false,
}) => {
  const numericValue = typeof value === "string" ? parseFloat(value) : value;

  const formatValue = (val: number, fmt: string): string => {
    if (fmt === "compact") {
      return val.toLocaleString("en-US", {
        notation: "compact",
        maximumFractionDigits: 2,
      });
    }
    if (fmt === "full") {
      return val.toLocaleString("en-US", {
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals,
      });
    }
    // standard
    return val.toLocaleString("en-US", {
      maximumFractionDigits: decimals,
    });
  };

  const formattedValue = formatValue(numericValue, format);

  const containerStyles: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "var(--spacing-1)",
  };

  const valueStyles: React.CSSProperties = {
    fontFamily: "var(--font-family-mono)",
    fontSize: "var(--font-size-base)",
    fontWeight: "var(--font-weight-medium)",
    color: colorize
      ? numericValue > 0
        ? "var(--color-success)"
        : numericValue < 0
        ? "var(--color-error)"
        : "var(--color-text-primary)"
      : "var(--color-text-primary)",
  };

  const symbolStyles: React.CSSProperties = {
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-secondary)",
    fontWeight: "var(--font-weight-normal)",
  };

  const sign = numericValue < 0 ? "-" : "";

  return (
    <div style={containerStyles}>
      <span style={valueStyles}>
        {sign}{formattedValue}
      </span>
      {showSymbol && symbol && (
        <span style={symbolStyles}>{symbol}</span>
      )}
    </div>
  );
};
