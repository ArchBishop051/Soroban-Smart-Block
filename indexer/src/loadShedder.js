import { loadShedRequestsTotal, adaptiveConcurrencyLimit, activeRequests } from "./metrics.js";

const DEFAULT_LIMITS = { api: 100, rpc: 40, analytics: 10, admin: 20 };
const MIN_LIMIT = 5;
const MAX_LIMIT = 1000;
const TARGET_LATENCY_MS = 500;
const SAMPLE_WINDOW = 20;
const PRIORITY_RESERVE = { anonymous: 0, free: 0, pro: 10, enterprise: 20, admin: 50 };
const HEALTH_PATHS = new Set(["/health", "/api/health", "/health/live", "/health/ready"]);

export function classifyRoute(path) {
  if (path === "/api/rpc") return "rpc";
  if (path === "/api/sql") return "analytics";
  if (path === "/api/admin" || path.startsWith("/api/admin/")) return "admin";
  return "api";
}

function tierPriority(req) {
  if (
    (req.path === "/api/admin" || req.path.startsWith("/api/admin/")) &&
    req.rateContext?.keyName === "static-admin-key"
  ) {
    return "admin";
  }
  if (req.rateContext?.tier === "enterprise") return "enterprise";
  if (req.rateContext?.tier === "pro") return "pro";
  if (req.rateContext?.tier === "free") return "free";
  return "anonymous";
}

export function createLoadShedder({ limits = DEFAULT_LIMITS, targetLatencyMs = TARGET_LATENCY_MS } = {}) {
  const states = new Map(
    Object.entries(limits).map(([route, limit]) => [
      route,
      { limit, active: 0, completed: 0, latencyTotal: 0, windowHighWater: 0, shed: {} },
    ]),
  );
  for (const [route, state] of states) {
    adaptiveConcurrencyLimit.set({ route }, state.limit);
    activeRequests.set({ route }, 0);
  }

  const getState = (route) => {
    if (!states.has(route)) {
      states.set(route, { limit: DEFAULT_LIMITS.api, active: 0, completed: 0, latencyTotal: 0, windowHighWater: 0, shed: {} });
    }
    return states.get(route);
  };

  const middleware = (req, res, next) => {
    if (req.method === "GET" && HEALTH_PATHS.has(req.path)) return next();

    const route = classifyRoute(req.path);
    const state = getState(route);
    const priority = tierPriority(req);
    const allowedConcurrent = Math.min(MAX_LIMIT, state.limit + PRIORITY_RESERVE[priority]);
    if (state.active >= allowedConcurrent) {
      state.shed[priority] = (state.shed[priority] ?? 0) + 1;
      loadShedRequestsTotal.inc({ route, tier: priority });
      res.set("Retry-After", "1");
      return res.status(503).json({ error: "Service is overloaded; retry shortly" });
    }

    state.active += 1;
    state.windowHighWater = Math.max(state.windowHighWater, state.active);
    activeRequests.set({ route }, state.active);
    const startedAt = Date.now();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
      activeRequests.set({ route }, state.active);
      state.completed += 1;
      state.latencyTotal += Date.now() - startedAt;
      if (state.completed >= SAMPLE_WINDOW) {
        const averageLatency = state.latencyTotal / state.completed;
        if (averageLatency > targetLatencyMs) {
          state.limit = Math.max(MIN_LIMIT, Math.floor(state.limit * 0.8));
        } else if (state.windowHighWater >= state.limit) {
          state.limit = Math.min(MAX_LIMIT, state.limit + Math.max(1, Math.ceil(state.limit * 0.05)));
        }
        state.completed = 0;
        state.latencyTotal = 0;
        state.windowHighWater = state.active;
        adaptiveConcurrencyLimit.set({ route }, state.limit);
      }
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };

  const getMetrics = () =>
    Object.fromEntries(
      [...states.entries()].map(([route, state]) => [
        route,
        { limit: state.limit, active: state.active, shed: { ...state.shed } },
      ]),
    );

  return { middleware, getMetrics };
}

const loadShedder = createLoadShedder();
export const adaptiveLoadShedder = loadShedder.middleware;
export const getLoadShedderMetrics = loadShedder.getMetrics;
