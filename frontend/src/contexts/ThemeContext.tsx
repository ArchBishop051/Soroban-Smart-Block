import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export type ThemePreference = "system" | "dark" | "light" | "high-contrast";
export type ResolvedTheme = "dark" | "light" | "high-contrast";

export interface ThemeContextType {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  systemTheme: "dark" | "light";
  setTheme: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

export const THEME_STORAGE_KEY = "sb-theme-preference";

const THEME_COLOR_META: Record<ResolvedTheme, string> = {
  dark: "#0d1117",
  light: "#f6f8fa",
  "high-contrast": "#000000",
};

export function getStoredThemePreference(): ThemePreference {
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === "dark" || val === "light" || val === "high-contrast" || val === "system") {
      return val;
    }
  } catch {
    // Storage access blocked or restricted
  }
  return "system";
}

export function setStoredThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage access blocked or restricted
  }
}

export function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getSystemPrefersHighContrast(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-contrast: more)").matches;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "dark" || preference === "light" || preference === "high-contrast") {
    return preference;
  }
  // System mode: if user has high contrast OS preference, prioritize high-contrast
  if (getSystemPrefersHighContrast()) {
    return "high-contrast";
  }
  return getSystemTheme();
}

export function applyThemeToDocument(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;

  document.documentElement.setAttribute("data-theme", resolved);

  // Update theme-color meta tag if present
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", THEME_COLOR_META[resolved] || "#0d1117");
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({
  children,
  initialPreference,
}: {
  children: React.ReactNode;
  initialPreference?: ThemePreference;
}) {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    return initialPreference ?? getStoredThemePreference();
  });

  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(getSystemTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme));

  // Core theme changer
  const setTheme = useCallback((nextTheme: ThemePreference) => {
    setThemeState(nextTheme);
    setStoredThemePreference(nextTheme);
    const resolved = resolveTheme(nextTheme);
    setResolvedTheme(resolved);
    applyThemeToDocument(resolved);
  }, []);

  // Quick toggle cycling: system -> dark -> light -> high-contrast -> system
  const toggleTheme = useCallback(() => {
    const cycle: ThemePreference[] = ["system", "dark", "light", "high-contrast"];
    const currentIndex = cycle.indexOf(theme);
    const nextIndex = (currentIndex + 1) % cycle.length;
    setTheme(cycle[nextIndex]);
  }, [theme, setTheme]);

  // Initial sync on mount
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyThemeToDocument(resolved);
  }, [theme]);

  // Listen to system color scheme & contrast changes
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const contrastQuery = window.matchMedia("(prefers-contrast: more)");

    const handleSystemChange = () => {
      const currentSys = darkQuery.matches ? "dark" : "light";
      setSystemTheme(currentSys);
      if (theme === "system") {
        const resolved = resolveTheme("system");
        setResolvedTheme(resolved);
        applyThemeToDocument(resolved);
      }
    };

    if (darkQuery.addEventListener) {
      darkQuery.addEventListener("change", handleSystemChange);
      contrastQuery.addEventListener("change", handleSystemChange);
    } else if (darkQuery.addListener) {
      // Legacy browser fallback
      darkQuery.addListener(handleSystemChange);
      contrastQuery.addListener(handleSystemChange);
    }

    return () => {
      if (darkQuery.removeEventListener) {
        darkQuery.removeEventListener("change", handleSystemChange);
        contrastQuery.removeEventListener("change", handleSystemChange);
      } else if (darkQuery.removeListener) {
        darkQuery.removeListener(handleSystemChange);
        contrastQuery.removeListener(handleSystemChange);
      }
    };
  }, [theme]);

  // Listen for cross-tab storage changes
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && e.newValue) {
        const newPref = e.newValue as ThemePreference;
        if (["system", "dark", "light", "high-contrast"].includes(newPref)) {
          setThemeState(newPref);
          const resolved = resolveTheme(newPref);
          setResolvedTheme(resolved);
          applyThemeToDocument(resolved);
        }
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        systemTheme,
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
