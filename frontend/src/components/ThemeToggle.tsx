import React, { useState, useRef, useEffect } from "react";
import { useTheme, type ThemePreference } from "../contexts/ThemeContext";

interface ThemeOption {
  value: ThemePreference;
  label: string;
  icon: string;
  hint: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: "system", label: "System", icon: "🖥️", hint: "Sync with OS theme" },
  { value: "dark", label: "Dark", icon: "🌙", hint: "Deep dark palette" },
  { value: "light", label: "Light", icon: "☀️", hint: "High-readability light" },
  { value: "high-contrast", label: "High Contrast", icon: "👁️", hint: "WCAG AAA accessible" },
];

export default function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Keyboard navigation within menu
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
        const currentIndex = THEME_OPTIONS.findIndex((opt) => opt.value === theme);
        setFocusedIndex(currentIndex >= 0 ? currentIndex : 0);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev + 1) % THEME_OPTIONS.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < THEME_OPTIONS.length) {
        setTheme(THEME_OPTIONS[focusedIndex].value);
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }
  }

  const currentOption = THEME_OPTIONS.find((opt) => opt.value === theme) || THEME_OPTIONS[0];

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", display: "inline-block" }}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Theme: ${currentOption.label} (${theme === "system" ? `currently ${resolvedTheme}` : "explicit"}). Click to change theme.`}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          borderRadius: 6,
          padding: "6px 10px",
          cursor: "pointer",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontWeight: 500,
        }}
      >
        <span aria-hidden="true">{currentOption.icon}</span>
        <span>{currentOption.label}</span>
        {theme === "system" && (
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 2 }}>
            ({resolvedTheme === "dark" ? "Dark" : "Light"})
          </span>
        )}
        <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }} aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Theme options"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "4px",
            boxShadow: "var(--shadow-md)",
            zIndex: 1000,
            minWidth: 170,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {THEME_OPTIONS.map((option, idx) => {
            const isSelected = theme === option.value;
            const isFocused = focusedIndex === idx;
            return (
              <button
                key={option.value}
                role="menuitemradio"
                aria-checked={isSelected}
                tabIndex={-1}
                type="button"
                onClick={() => {
                  setTheme(option.value);
                  setIsOpen(false);
                  buttonRef.current?.focus();
                }}
                onMouseEnter={() => setFocusedIndex(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: isFocused ? "1px solid var(--border-focus)" : "1px solid transparent",
                  background: isSelected
                    ? "var(--accent-subtle)"
                    : isFocused
                      ? "var(--surface-raised)"
                      : "transparent",
                  color: isSelected ? "var(--accent)" : "var(--text)",
                  cursor: "pointer",
                  fontSize: 13,
                  textAlign: "left",
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span aria-hidden="true">{option.icon}</span>
                  <div>
                    <div>{option.label}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>
                      {option.hint}
                    </div>
                  </div>
                </div>
                {isSelected && (
                  <span aria-hidden="true" style={{ fontSize: 13, color: "var(--accent)" }}>
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
