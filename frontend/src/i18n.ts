import i18next from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: {
      "common.loading": "Loading…",
      "common.search": "Search",
      "nav.watchlist": "Watchlist",
      "watchlist.title": "Watchlist",
      "watchlist.empty": "No starred contracts or wallets yet.",
      "watchlist.add": "Add to Watchlist",
      "watchlist.remove": "Remove from Watchlist",
      "search.placeholder": "Search contracts, events, wallets… (press / to focus)",
      "search.page.title": "Search",
      "search.page.subtitle": "Search contracts, events, and wallets in one place.",
      "search.suggestions": "Suggestions",
      "search.recent": "Recent searches",
    },
  },
  es: {
    translation: {
      "common.loading": "Cargando…",
      "common.search": "Buscar",
      "nav.watchlist": "Lista de seguimiento",
      "watchlist.title": "Lista de seguimiento",
      "watchlist.empty": "Todavía no hay contratos ni wallets favoritos.",
      "watchlist.add": "Añadir a la lista",
      "watchlist.remove": "Quitar de la lista",
      "search.placeholder": "Buscar contratos, eventos, wallets… (pulsa / para enfocar)",
      "search.page.title": "Búsqueda",
      "search.page.subtitle": "Busca contratos, eventos y wallets en un solo lugar.",
      "search.suggestions": "Sugerencias",
      "search.recent": "Búsquedas recientes",
    },
  },
};

i18next.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  defaultNS: "translation",
});

export default i18next;
