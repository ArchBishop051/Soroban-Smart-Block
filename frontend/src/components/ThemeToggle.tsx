import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";

type ThemePreference = "system" | "light" | "dark";
const STORAGE_KEY = "sb-theme-preference";

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can be disabled; system preference still works through CSS.
  }
  return "system";
}

function applyTheme(preference: ThemePreference) {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", preference);
  }

  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // The current page remains themed even when persistence is unavailable.
  }
}

export default function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  const { t } = useTranslation();

  useEffect(() => {
    applyTheme(preference);
  }, [preference]);

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 12 }}>
      <span>{t("theme.label")}</span>
      <select
        aria-label={t("theme.ariaLabel")}
        value={preference}
        onChange={(event) => setPreference(event.target.value as ThemePreference)}
        style={{ padding: "5px 8px", fontSize: 12 }}
      >
        <option value="system">{t("theme.system")}</option>
        <option value="light">{t("theme.light")}</option>
        <option value="dark">{t("theme.dark")}</option>
      </select>
    </label>
  );
}
