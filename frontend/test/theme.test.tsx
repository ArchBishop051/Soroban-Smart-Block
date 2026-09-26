import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import {
  ThemeProvider,
  useTheme,
  THEME_STORAGE_KEY,
  resolveTheme,
  getStoredThemePreference,
  setStoredThemePreference,
} from "../src/contexts/ThemeContext";
import ThemeToggle from "../src/components/ThemeToggle";

// Helper component for context testing
function TestThemeConsumer() {
  const { theme, resolvedTheme, systemTheme, setTheme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-pref">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <span data-testid="system-theme">{systemTheme}</span>
      <button onClick={() => setTheme("dark")}>Set Dark</button>
      <button onClick={() => setTheme("light")}>Set Light</button>
      <button onClick={() => setTheme("high-contrast")}>Set High Contrast</button>
      <button onClick={() => setTheme("system")}>Set System</button>
      <button onClick={toggleTheme}>Toggle Theme</button>
    </div>
  );
}

describe("ThemeContext & Resolution Logic", () => {
  let listeners: Record<string, ((e: any) => void)[]> = {};

  beforeEach(() => {
    localStorage.clear();
    listeners = {};
    document.documentElement.removeAttribute("data-theme");

    // Mock matchMedia
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => {
        listeners[query] = listeners[query] || [];
        const isDark = query.includes("prefers-color-scheme: dark");
        const isContrast = query.includes("prefers-contrast: more");
        return {
          matches: isDark ? true : false,
          media: query,
          onchange: null,
          addEventListener: vi.fn((event: string, cb: any) => {
            if (event === "change") listeners[query].push(cb);
          }),
          removeEventListener: vi.fn((event: string, cb: any) => {
            listeners[query] = listeners[query].filter((fn) => fn !== cb);
          }),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        };
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to system theme when localStorage is empty", () => {
    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("theme-pref").textContent).toBe("system");
    expect(screen.getByTestId("resolved-theme").textContent).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("restores saved preference from localStorage", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");

    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("theme-pref").textContent).toBe("light");
    expect(screen.getByTestId("resolved-theme").textContent).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("switches theme and persists to localStorage and documentElement", async () => {
    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText("Set Light"));
    expect(screen.getByTestId("theme-pref").textContent).toBe("light");
    expect(screen.getByTestId("resolved-theme").textContent).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    fireEvent.click(screen.getByText("Set High Contrast"));
    expect(screen.getByTestId("theme-pref").textContent).toBe("high-contrast");
    expect(screen.getByTestId("resolved-theme").textContent).toBe("high-contrast");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("high-contrast");
    expect(document.documentElement.getAttribute("data-theme")).toBe("high-contrast");
  });

  it("cycles themes via toggleTheme", () => {
    render(
      <ThemeProvider initialPreference="system">
        <TestThemeConsumer />
      </ThemeProvider>
    );

    const toggleBtn = screen.getByText("Toggle Theme");

    // system -> dark
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("theme-pref").textContent).toBe("dark");

    // dark -> light
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("theme-pref").textContent).toBe("light");

    // light -> high-contrast
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("theme-pref").textContent).toBe("high-contrast");

    // high-contrast -> system
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("theme-pref").textContent).toBe("system");
  });

  it("reacts live to OS color scheme changes when mode is system", () => {
    render(
      <ThemeProvider initialPreference="system">
        <TestThemeConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("resolved-theme").textContent).toBe("dark");

    // Simulate OS switching to light mode
    act(() => {
      const darkQuery = "(prefers-color-scheme: dark)";
      const cbs = listeners[darkQuery] || [];
      // Mock matches changing to false
      (window.matchMedia as any).mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      cbs.forEach((cb) => cb({ matches: false }));
    });

    expect(screen.getByTestId("resolved-theme").textContent).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("synchronizes across tabs via storage event", () => {
    render(
      <ThemeProvider initialPreference="dark">
        <TestThemeConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("theme-pref").textContent).toBe("dark");

    // Simulate storage event from another tab
    act(() => {
      const storageEvent = new StorageEvent("storage", {
        key: THEME_STORAGE_KEY,
        newValue: "light",
      });
      window.dispatchEvent(storageEvent);
    });

    expect(screen.getByTestId("theme-pref").textContent).toBe("light");
    expect(screen.getByTestId("resolved-theme").textContent).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("gracefully handles localStorage failures without crashing", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: Access is denied");
    });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: Access is denied");
    });

    expect(getStoredThemePreference()).toBe("system");
    expect(() => setStoredThemePreference("dark")).not.toThrow();

    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("theme-pref").textContent).toBe("system");
    expect(() => fireEvent.click(screen.getByText("Set Dark"))).not.toThrow();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("throws error when useTheme is called outside ThemeProvider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestThemeConsumer />)).toThrow(
      "useTheme must be used within a ThemeProvider"
    );
    consoleError.mockRestore();
  });
});

describe("ThemeToggle Component", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders accessible toggle button with current theme information", () => {
    render(
      <ThemeProvider initialPreference="system">
        <ThemeToggle />
      </ThemeProvider>
    );

    const button = screen.getByRole("button", { name: /Theme:/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.textContent).toContain("System");
  });

  it("opens menu and allows selecting a theme via mouse click", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider initialPreference="system">
        <ThemeToggle />
      </ThemeProvider>
    );

    const trigger = screen.getByRole("button", { name: /Theme:/i });
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: /Theme options/i })).toBeInTheDocument();

    const lightOption = screen.getByRole("menuitemradio", { name: /Light/i });
    await user.click(lightOption);

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("supports keyboard navigation: Enter to open, ArrowDown/Up, Enter to select, Escape to dismiss", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider initialPreference="dark">
        <ThemeToggle />
      </ThemeProvider>
    );

    const trigger = screen.getByRole("button", { name: /Theme:/i });
    trigger.focus();

    // Open via Enter
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menu")).toBeInTheDocument();

    // Close via Escape
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // Reopen and navigate with arrows
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
