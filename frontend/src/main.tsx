import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { NetworkProvider } from "./contexts/NetworkContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { initCsrf } from "./hooks/useCsrf";
import { initSentry } from "./sentry";
import "./i18n";
import "./index.css";

initSentry();

// Initialize web vitals RUM collection
initWebVitals();

const qc = new QueryClient();

// Fetch the CSRF token once at startup so all mutation requests can attach it.
// Runs in the background — the UI renders immediately and the token is cached
// before any user action triggers a POST / PATCH / DELETE.
initCsrf().catch(() => {});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <NetworkProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </NetworkProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
