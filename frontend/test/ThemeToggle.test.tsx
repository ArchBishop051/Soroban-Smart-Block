import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ThemeToggle from "../src/components/ThemeToggle";
import { I18nProvider, useTranslation } from "../src/i18n";

function LocaleProbe() {
  const { setLocale, t } = useTranslation();
  return (
    <>
      <span>{t("nav.registry")}</span>
      <button onClick={() => setLocale("es")}>Spanish</button>
    </>
  );
}

describe("theme and locale preferences", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.lang = "en";
  });

  it("defaults to the system theme and persists explicit selections", async () => {
    render(
      <I18nProvider>
        <ThemeToggle />
      </I18nProvider>,
    );

    const selector = screen.getByRole("combobox", { name: "Color theme" });
    expect(selector).toHaveValue("system");

    fireEvent.change(selector, { target: { value: "dark" } });
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
      expect(localStorage.getItem("sb-theme-preference")).toBe("dark");
    });

    fireEvent.change(selector, { target: { value: "system" } });
    await waitFor(() => {
      expect(document.documentElement).not.toHaveAttribute("data-theme");
      expect(localStorage.getItem("sb-theme-preference")).toBeNull();
    });
  });

  it("switches translated resources and updates the document language", async () => {
    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Spanish" }));
    expect(await screen.findByText("Registro")).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("es");
      expect(localStorage.getItem("sb-locale")).toBe("es");
    });
  });
});