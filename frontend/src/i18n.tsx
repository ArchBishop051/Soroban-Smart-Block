import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const english = {
  "app.loading": "Loading…",
  "contract.sections": "Contract sections",
  "contract.unregistered": "Unregistered contract",
  "contract.noAbiDescription": "This contract has no registered ABI. Upload a local spec file to inspect its transaction logs; the file stays in your browser session only.",
  "contract.recentEvents": "Recent Events",
  "nav.main": "Main navigation",
  "nav.brand": "Soroban Explorer",
  "nav.registry": "Registry",
  "nav.register": "Register",
  "nav.search": "Search",
  "nav.xdr": "XDR Workbench",
  "nav.rpcMetrics": "RPC Metrics",
  "nav.depGraph": "Dep Graph",
  "nav.sandbox": "Sandbox",
  "nav.batch": "Batch",
  "nav.setup": "Setup",
  "nav.menuLabel": "Toggle menu",
  "nav.menuTitle": "Toggle navigation menu",
  "search.input": "Search contracts, events, or wallets",
  "search.placeholder": "Search contracts, events, wallets… (press / to focus)",
  "search.submit": "Search",
  "search.recent": "Recent searches",
  "search.remove": "Remove",
  "search.removeRecent": "Remove {query} from recent searches",
  "search.openRecent": "Search for {query}",
  "search.clearAll": "Clear all",
  "theme.label": "Theme",
  "theme.ariaLabel": "Color theme",
  "theme.system": "System",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "language.label": "Language",
  "language.english": "English",
  "language.spanish": "Spanish",
  "event.notFound": "Event not found.",
  "event.back": "Back to events",
  "event.title": "Event #{seq}",
  "event.description": "Description",
  "event.function": "Function",
  "event.compliance": "⚠ COMPLIANCE: CLAWBACK — mandatory authority intervention",
  "event.complianceTitle": "Mandatory authority intervention",
  "event.sacSideEffect": "SAC Side-Effect",
  "event.sacCreatedTitle": "SAC implicitly created a new Stellar account entry for this recipient",
  "event.sacTrustlineTitle": "SAC implicitly opened a trustline for this asset on the recipient account",
  "event.sacCreated": "⬡ SAC Auto-Created Account Entry",
  "event.sacTrustline": "⬡ SAC Native Trustline Open",
  "event.ledger": "Ledger",
  "event.contract": "Contract",
  "event.type": "Type",
  "event.classic": "Classic (no Soroban contract)",
  "event.txHash": "Tx Hash",
  "event.topics": "Topics",
  "event.wrapNative": "Wrap Native Asset",
  "event.wrapDescription": "Classic XLM → Soroban",
  "event.unwrapNative": "Unwrap Native Asset",
  "event.unwrapDescription": "Soroban → Classic XLM",
  "chart.loadingStats": "Loading stats…",
  "chart.totalEvents": "Total Events",
  "chart.uniqueCallers": "Unique Callers",
  "chart.lastActivity": "Last Activity",
  "chart.ledger": "Ledger {ledger}",
  "chart.eventsPerDay": "Events / day (last {range} days)",
  "chart.dailyEventsLabel": "Events per day over the last {range} days",
  "chart.trendTitle": "Event Volume Trend (Last {range} Days)",
  "chart.frequencyLabel": "Invocation frequency for the last {range} days",
  "chart.rangeLabel": "Event volume time range",
  "chart.noActivity": "No activity in the last {range} days",
  "chart.dataAlternative": "Chart data",
  "chart.dataPointOne": "{label}: {count} event",
  "chart.dataPointMany": "{label}: {count} events",
} as const;

type TranslationKey = keyof typeof english;

const spanish: Record<TranslationKey, string> = {
  "app.loading": "Cargando…",
  "contract.sections": "Secciones del contrato",
  "contract.unregistered": "Contrato no registrado",
  "contract.noAbiDescription": "Este contrato no tiene una ABI registrada. Sube un archivo de especificación local para inspeccionar sus registros de transacciones; el archivo solo permanece en esta sesión del navegador.",
  "contract.recentEvents": "Eventos recientes",
  "nav.main": "Navegación principal",
  "nav.brand": "Explorador Soroban",
  "nav.registry": "Registro",
  "nav.register": "Registrar",
  "nav.search": "Buscar",
  "nav.xdr": "Entorno de trabajo XDR",
  "nav.rpcMetrics": "Métricas RPC",
  "nav.depGraph": "Grafo de dependencias",
  "nav.sandbox": "Sandbox",
  "nav.batch": "Lote",
  "nav.setup": "Configuración",
  "nav.menuLabel": "Mostrar u ocultar menú",
  "nav.menuTitle": "Mostrar u ocultar navegación",
  "search.input": "Buscar contratos, eventos o carteras",
  "search.placeholder": "Buscar contratos, eventos o carteras… (pulsa / para enfocar)",
  "search.submit": "Buscar",
  "search.recent": "Búsquedas recientes",
  "search.remove": "Quitar",
  "search.removeRecent": "Quitar {query} de las búsquedas recientes",
  "search.openRecent": "Buscar {query}",
  "search.clearAll": "Borrar todo",
  "theme.label": "Tema",
  "theme.ariaLabel": "Tema de color",
  "theme.system": "Sistema",
  "theme.light": "Claro",
  "theme.dark": "Oscuro",
  "language.label": "Idioma",
  "language.english": "Inglés",
  "language.spanish": "Español",
  "event.notFound": "No se encontró el evento.",
  "event.back": "Volver a los eventos",
  "event.title": "Evento n.º {seq}",
  "event.description": "Descripción",
  "event.function": "Función",
  "event.compliance": "⚠ CUMPLIMIENTO: CLAWBACK — intervención obligatoria de la autoridad",
  "event.complianceTitle": "Intervención obligatoria de la autoridad",
  "event.sacSideEffect": "Efecto secundario de SAC",
  "event.sacCreatedTitle": "SAC creó implícitamente una nueva cuenta de Stellar para este destinatario",
  "event.sacTrustlineTitle": "SAC abrió implícitamente una línea de confianza para este activo en la cuenta destinataria",
  "event.sacCreated": "⬡ Entrada de cuenta creada automáticamente por SAC",
  "event.sacTrustline": "⬡ Línea de confianza nativa de SAC abierta",
  "event.ledger": "Libro mayor",
  "event.contract": "Contrato",
  "event.type": "Tipo",
  "event.classic": "Clásico (sin contrato Soroban)",
  "event.txHash": "Hash de transacción",
  "event.topics": "Temas",
  "event.wrapNative": "Envolver activo nativo",
  "event.wrapDescription": "XLM clásico → Soroban",
  "event.unwrapNative": "Desenvolver activo nativo",
  "event.unwrapDescription": "Soroban → XLM clásico",
  "chart.loadingStats": "Cargando estadísticas…",
  "chart.totalEvents": "Eventos totales",
  "chart.uniqueCallers": "Llamantes únicos",
  "chart.lastActivity": "Última actividad",
  "chart.ledger": "Libro mayor {ledger}",
  "chart.eventsPerDay": "Eventos / día (últimos {range} días)",
  "chart.dailyEventsLabel": "Eventos por día durante los últimos {range} días",
  "chart.trendTitle": "Tendencia de volumen de eventos (últimos {range} días)",
  "chart.frequencyLabel": "Frecuencia de invocaciones durante los últimos {range} días",
  "chart.rangeLabel": "Intervalo de tiempo del volumen de eventos",
  "chart.noActivity": "Sin actividad en los últimos {range} días",
  "chart.dataAlternative": "Datos del gráfico",
  "chart.dataPointOne": "{label}: {count} evento",
  "chart.dataPointMany": "{label}: {count} eventos",
};

export type Locale = "en" | "es";
type TranslationValues = Record<string, string | number>;
type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
};

const resources: Record<Locale, Record<TranslationKey, string>> = { en: english, es: spanish };
const I18nContext = createContext<I18nContextValue | null>(null);
const STORAGE_KEY = "sb-locale";

function readLocale(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === "es" ? "es" : "en";
  } catch {
    return "en";
  }
}

function translate(locale: Locale, key: TranslationKey, values: TranslationValues = {}) {
  return resources[locale][key].replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(readLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Language selection remains active for this page when storage is unavailable.
    }
  }, [locale]);

  const t = (key: TranslationKey, values: TranslationValues = {}) => translate(locale, key, values);

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  return useContext(I18nContext) ?? {
    locale: "en" as const,
    setLocale: () => {},
    t: (key: TranslationKey, values?: TranslationValues) => translate("en", key, values),
  };
}