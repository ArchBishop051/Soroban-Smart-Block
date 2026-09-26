import * as Sentry from "@sentry/react";

/**
 * Initializes Sentry error tracking when VITE_SENTRY_DSN is set (#757).
 * No-op in dev/test environments where the DSN is left blank.
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    tracePropagationTargets: ["localhost", /^\//, /^https?:\/\/.*\/api\//],
    integrations: [Sentry.browserTracingIntegration()],
  });
}

export { Sentry };
