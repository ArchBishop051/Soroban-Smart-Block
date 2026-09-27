import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { NetworkProvider } from "./contexts/NetworkContext";
import { initCsrf } from "./hooks/useCsrf";
import { initSentry } from "./sentry";
import { initWebVitals } from "./utils/webVitals";
import "./index.css";

initSentry();
initWebVitals();

const qc = new QueryClient();

initCsrf().catch(() => {});

ReactDOM.hydrateRoot(
  document.getElementById("root")!,
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <NetworkProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </NetworkProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
