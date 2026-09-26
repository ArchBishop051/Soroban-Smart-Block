import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ThemeToggle from "./ThemeToggle";
import NetworkSwitcher from "./NetworkSwitcher";
import WalletConnectButton from "./WalletConnectButton";
import LanguageToggle from "./LanguageToggle";
import { useRecentSearches } from "../hooks/useRecentSearches";
import { useTranslation, type Locale } from "../i18n";

const NAV_LINKS = [
  { to: "/contracts", key: "nav.registry" },
  { to: "/contracts/register", key: "nav.register" },
  { to: "/search", key: "nav.search" },
  { to: "/xdr", key: "nav.xdr" },
  { to: "/rpc-metrics", key: "nav.rpcMetrics" },
  { to: "/graph", key: "nav.depGraph" },
  { to: "/sandbox", key: "nav.sandbox" },
  { to: "/batch", key: "nav.batch" },
  { to: "/setup", key: "nav.setup" },
];

export default function Nav() {
  const { t, locale, setLocale } = useTranslation();
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<Array<{ kind: string; label: string; route: string }>>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const nav = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const { recent, add: addRecentSearch, remove: removeRecentSearch, clearAll: clearRecentSearches } =
    useRecentSearches();

  function goToSearch(query: string, kind?: string) {
    const params = new URLSearchParams({ q: query });
    if (kind) params.set("kind", kind);
    addRecentSearch(query, kind ?? "all");
    nav(`/search?${params}`);
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    let kind: string | undefined;
    if (v.startsWith("G") && v.length === 56) kind = "wallet";
    else if (v.startsWith("M") && v.length === 56) kind = "wallet";
    else if (v.startsWith("C") && v.length === 56) kind = "contract";
    goToSearch(v, kind);
    setQ("");
    setSearchFocused(false);
  }

  // Handle keyboard shortcuts: / to focus search, Escape to blur
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Check if the user is currently typing in a form field
      const activeElement = document.activeElement as HTMLElement;
      const isInFormField =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.tagName === "SELECT" ||
        activeElement?.contentEditable === "true";

      // Press "/" to focus the search bar (unless already in a form field)
      if (e.key === "/" && !isInFormField) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }

      // Press "Escape" to blur the search bar or close mobile menu
      if (e.key === "Escape") {
        if (activeElement === searchInputRef.current) {
          searchInputRef.current?.blur();
        }
        setMobileMenuOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const value = q.trim();
    if (!value || value.length < 2) {
      setSuggestions([]);
      return;
    }

    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(value)}&limit=5`);
        if (!res.ok) return;
        const payload = await res.json();
        setSuggestions(Array.isArray(payload?.suggestions) ? payload.suggestions.slice(0, 5) : []);
      } catch {
        setSuggestions([]);
      }
    }, 250);

    return () => window.clearTimeout(handle);
  }, [q]);

  function handleNavLinkClick() {
    setMobileMenuOpen(false);
  }

  return (
    <>
      <style>{`
        .nav-desktop-links {
          display: flex;
        }
        @media (max-width: 768px) {
          .nav-desktop-links {
            display: none;
          }
          .nav-search-form {
            max-width: none;
            flex: none;
            order: 3;
            width: 100%;
            margin-top: 12px;
          }
          header {
            flex-wrap: wrap;
            align-items: flex-start;
          }
        }
        @media (min-width: 769px) {
          .nav-hamburger {
            display: none;
          }
          .nav-mobile-menu {
            display: none;
          }
        }
        .nav-mobile-menu {
          position: fixed;
          top: 50px;
          left: 0;
          right: 0;
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          z-index: 1000;
          max-height: calc(100vh - 50px);
          overflow-y: auto;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .nav-mobile-menu a {
          display: block;
          padding: 12px 24px;
          border-bottom: 1px solid var(--border);
          text-decoration: none;
          color: var(--text);
          font-size: 14px;
          transition: background 200ms ease;
        }
        .nav-mobile-menu a:hover {
          background: var(--border);
          text-decoration: none;
        }
      `}</style>
      <header
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <Link to="/" style={{ fontWeight: 700, fontSize: 16, whiteSpace: "nowrap" }}>
          ⬡ {t("nav.brand")}
        </Link>

        {/* Desktop navigation links */}
        <nav className="nav-desktop-links" aria-label={t("nav.main")} style={{ gap: 16, alignItems: "center" }}>
          {NAV_LINKS.map((link) => (
            <Link key={link.to} to={link.to} style={{ fontSize: 13, whiteSpace: "nowrap", color: "var(--muted)" }}>
              {t(link.key)}
            </Link>
          ))}
        </nav>

        {/* Mobile hamburger button */}
        <button
          className="nav-hamburger"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-navigation"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--accent)",
            fontSize: 20,
            cursor: "pointer",
            padding: "4px 8px",
          }}
          aria-label={t("nav.menuLabel")}
          title={t("nav.menuTitle")}
        >
          ☰
        </button>

        <form
          onSubmit={search}
          role="search"
          className="nav-search-form"
          style={{ display: "flex", gap: 8, flex: 1, maxWidth: 600, position: "relative" }}
        >
          <input
            ref={searchInputRef}
            value={q}
            aria-label={t("search.input")}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            placeholder={t("search.placeholder")}
            style={{ flex: 1 }}
          />
          <button type="submit">{t("search.submit")}</button>

          {searchFocused && (
            <div
              role="region"
              aria-label={t("search.recent")}
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                right: 0,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                zIndex: 50,
                padding: 8,
                display: q.trim() ? (suggestions.length ? "block" : "none") : recent.length > 0 ? "block" : "none",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  padding: "4px 8px",
                }}
              >
                {t("search.recent")}
              </div>
              {recent.map((entry) => (
                <div
                  key={`${entry.kind}:${entry.query}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "6px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      goToSearch(entry.query, entry.kind === "all" ? undefined : entry.kind);
                      setQ("");
                      setSearchFocused(false);
                    }}
                    aria-label={t("search.openRecent", { query: entry.query })}
                    style={{
                      minWidth: 0,
                      flex: 1,
                      padding: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      textAlign: "left",
                      background: "transparent",
                      color: "var(--text)",
                    }}
                  >
                    {entry.query}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      removeRecentSearch(entry.query, entry.kind);
                    }}
                    title={t("search.remove")}
                    aria-label={t("search.removeRecent", { query: entry.query })}
                    style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
                <button
                  type="button"
                  onClick={() => {
                    clearRecentSearches();
                  }}
                  aria-label={t("search.clearAll")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    padding: "4px 8px",
                  }}
                >
                  ✕ {t("search.clearAll")}
                </button>
              </div>
            </div>
          )}

        </form>
        <NetworkSwitcher />
        <WalletConnectButton />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--muted)", fontSize: 12 }}>
          <span>{t("language.label")}</span>
          <select
            aria-label={t("language.label")}
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
            style={{ padding: "5px 8px", fontSize: 12 }}
          >
            <option value="en">{t("language.english")}</option>
            <option value="es">{t("language.spanish")}</option>
          </select>
        </label>
        <ThemeToggle />
      </header>

      {/* Mobile navigation drawer */}
      <nav
        id="mobile-navigation"
        className="nav-mobile-menu"
        aria-label={t("nav.main")}
        hidden={!mobileMenuOpen}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setMobileMenuOpen(false);
          }
        }}
      >
        {NAV_LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            onClick={handleNavLinkClick}
            style={{ display: "block", padding: "12px 24px", borderBottom: "1px solid var(--border)" }}
          >
            {t(link.key)}
          </Link>
        ))}
      </nav>
    </>
  );
}
