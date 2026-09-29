import React from "react";
import { CopyableText } from "./CopyableText";

export interface AddressProps {
  address: string;
  truncate?: boolean;
  truncateLength?: number;
  showCopy?: boolean;
  variant?: "default" | "short";
}

/**
 * Accessible address component with design token styling.
 * Displays Stellar addresses with optional truncation and copy functionality.
 */
export const Address: React.FC<AddressProps> = ({
  address,
  truncate = true,
  truncateLength = 8,
  showCopy = true,
  variant = "default",
}) => {
  const isContract = address.startsWith("C");
  const isPublicKey = address.startsWith("G");

  const displayAddress = variant === "short"
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : truncate && address.length > truncateLength * 2
    ? `${address.slice(0, truncateLength)}...${address.slice(-truncateLength)}`
    : address;

  const containerStyles: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
  };

  const addressStyles: React.CSSProperties = {
    fontFamily: "var(--font-family-mono)",
    fontSize: "var(--font-size-sm)",
    color: "var(--color-text-primary)",
    textDecoration: "none",
  };

  const iconStyles: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "var(--spacing-4)",
    height: "var(--spacing-4)",
    borderRadius: "50%",
    fontSize: "var(--font-size-xs)",
    fontWeight: "var(--font-weight-bold)",
  };

  const typeStyles: Record<string, React.CSSProperties> = {
    contract: {
      ...iconStyles,
      background: "var(--color-accent-primary)",
      color: "var(--color-text-inverse)",
    },
    public: {
      ...iconStyles,
      background: "var(--color-success)",
      color: "var(--color-text-inverse)",
    },
  };

  const typeIcon = isContract ? "C" : isPublicKey ? "G" : "?";
  const typeStyle = isContract ? typeStyles.contract : isPublicKey ? typeStyles.public : iconStyles;

  return (
    <div style={containerStyles}>
      <span style={typeStyle} title={isContract ? "Contract" : isPublicKey ? "Public Key" : "Unknown"}>
        {typeIcon}
      </span>
      {showCopy ? (
        <CopyableText text={address} displayText={displayAddress} truncate={false} />
      ) : (
        <span style={addressStyles} title={address}>
          {displayAddress}
        </span>
      )}
    </div>
  );
};
