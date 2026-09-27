import { useTranslation } from "react-i18next";
import i18n from "../i18n";

export default function LanguageToggle() {
  const { t, i18n: current } = useTranslation();

  const nextLanguage = current.language?.startsWith("es") ? "en" : "es";

  return (
    <button
      type="button"
      onClick={() => i18n.changeLanguage(nextLanguage)}
      title={t("nav.watchlist")}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        color: "var(--text)",
        borderRadius: 999,
        padding: "6px 10px",
        cursor: "pointer",
        fontSize: 12,
      }}
      aria-label="Toggle language"
    >
      {current.language?.startsWith("es") ? "EN" : "ES"}
    </button>
  );
}
