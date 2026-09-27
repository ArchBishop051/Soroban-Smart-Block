import React from "react";

export interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  onChange?: (tabId: string) => void;
  variant?: "default" | "pills";
}

/**
 * Accessible tabs component with design token styling.
 * Supports keyboard navigation and ARIA attributes.
 */
export const Tabs: React.FC<TabsProps> = ({ tabs, defaultTab, onChange, variant = "default" }) => {
  const [activeTab, setActiveTab] = React.useState(defaultTab || tabs[0]?.id);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    onChange?.(tabId);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prevIndex = index > 0 ? index - 1 : tabs.length - 1;
      handleTabChange(tabs[prevIndex].id);
      tabs[prevIndex].disabled || (document.getElementById(`tab-${tabs[prevIndex].id}`) as HTMLElement)?.focus();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextIndex = index < tabs.length - 1 ? index + 1 : 0;
      handleTabChange(tabs[nextIndex].id);
      tabs[nextIndex].disabled || (document.getElementById(`tab-${tabs[nextIndex].id}`) as HTMLElement)?.focus();
    }
  };

  const tabListStyles: React.CSSProperties = {
    display: "flex",
    gap: variant === "pills" ? "var(--spacing-2)" : "0",
    borderBottom: variant === "default" ? "1px solid var(--color-border-default)" : "none",
    marginBottom: "var(--spacing-4)",
  };

  const tabStyles: React.CSSProperties = {
    padding: "var(--spacing-3) var(--spacing-4)",
    fontFamily: "var(--font-family-base)",
    fontSize: "var(--font-size-base)",
    fontWeight: "var(--font-weight-medium)",
    color: "var(--color-text-secondary)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    transition: "color var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out)",
    outline: "none",
  };

  const activeTabStyles: React.CSSProperties = variant === "default"
    ? {
        color: "var(--color-text-primary)",
        borderBottom: "2px solid var(--color-accent-primary)",
        marginBottom: "-1px",
      }
    : {
        color: "var(--color-text-primary)",
        background: "var(--color-accent-primary)",
        borderRadius: "var(--radius-full)",
      };

  const disabledTabStyles: React.CSSProperties = {
    opacity: 0.5,
    cursor: "not-allowed",
  };

  const panelStyles: React.CSSProperties = {
    padding: "var(--spacing-4)",
  };

  return (
    <div role="tablist" aria-label="Tabs" style={tabListStyles}>
      {tabs.map((tab, index) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && handleTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            style={{
              ...tabStyles,
              ...isActive ? activeTabStyles : {},
              ...tab.disabled ? disabledTabStyles : {},
            }}
          >
            {tab.label}
          </button>
        );
      })}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          hidden={activeTab !== tab.id}
          style={panelStyles}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
};
