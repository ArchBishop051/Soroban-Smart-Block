/**
 * Web Vitals RUM (Real User Monitoring) Collection
 * 
 * Sends Core Web Vitals metrics to Sentry for production monitoring.
 * This allows comparison between CI Lighthouse scores and real user experience.
 * 
 * Metrics collected:
 * - LCP (Largest Contentful Paint): Loading performance
 * - FID (First Input Delay): Interactivity
 * - CLS (Cumulative Layout Shift): Visual stability
 * - FCP (First Contentful Paint): Initial paint
 * - TTFB (Time to First Byte): Server response time
 * - INP (Interaction to Next Paint): Responsiveness
 */

import { onCLS, onFCP, onFID, onLCP, onTTFB, onINP } from "web-vitals";
import * as Sentry from "@sentry/react";

/**
 * Send a web vital metric to Sentry as a custom metric
 */
function sendToSentry(metric: any) {
  const metricName = metric.name;
  const metricValue = metric.value;
  const metricRating = metric.rating;

  // Send as a custom metric to Sentry
  Sentry.metrics().set(metricName, metricValue, {
    unit: "ms",
    tags: {
      rating: metricRating,
      navigationType: metric.navigationType,
    },
  });

  // Also send as a breadcrumb for context
  Sentry.addBreadcrumb({
    category: "web-vitals",
    message: `${metricName}: ${metricValue.toFixed(2)}ms (${metricRating})`,
    level: metricRating === "good" ? "info" : "warning",
    data: {
      value: metricValue,
      rating: metricRating,
      id: metric.id,
      navigationType: metric.navigationType,
    },
  });

  // Log to console in development
  if (import.meta.env.DEV) {
    console.log(`[Web Vitals] ${metricName}: ${metricValue.toFixed(2)}ms (${metricRating})`);
  }
}

/**
 * Initialize web vitals collection
 * Call this once at app startup
 */
export function initWebVitals() {
  // Only collect in production to avoid noise in development
  if (import.meta.env.DEV) {
    console.log("[Web Vitals] Collection enabled (development mode - logging to console only)");
  }

  // Core Web Vitals
  onLCP(sendToSentry); // Loading performance
  onFID(sendToSentry); // Interactivity (legacy, use INP for modern browsers)
  onCLS(sendToSentry); // Visual stability
  onINP(sendToSentry); // Responsiveness (replaces FID in modern browsers)

  // Additional metrics
  onFCP(sendToSentry); // First Contentful Paint
  onTTFB(sendToSentry); // Time to First Byte
}

/**
 * Get performance budget thresholds
 */
export const PERFORMANCE_BUDGETS = {
  LCP: { good: 2500, needsImprovement: 4000 },
  FID: { good: 100, needsImprovement: 300 },
  CLS: { good: 0.1, needsImprovement: 0.25 },
  FCP: { good: 1800, needsImprovement: 3000 },
  TTFB: { good: 800, needsImprovement: 1800 },
  INP: { good: 200, needsImprovement: 500 },
} as const;

/**
 * Check if a metric value meets the performance budget
 */
export function checkBudget(metricName: keyof typeof PERFORMANCE_BUDGETS, value: number): "good" | "needs-improvement" | "poor" {
  const budget = PERFORMANCE_BUDGETS[metricName];
  if (value <= budget.good) return "good";
  if (value <= budget.needsImprovement) return "needs-improvement";
  return "poor";
}
