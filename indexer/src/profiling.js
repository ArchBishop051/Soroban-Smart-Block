/**
 * Continuous profiling (issue #944).
 *
 * Streams CPU/wall and heap profiles to Pyroscope (Grafana Profiles) when
 * PYROSCOPE_SERVER_ADDRESS is set. Profiles carry function names only, never
 * request data. Profiles share the service name with traces so Grafana's
 * traces-to-profiles link can open the flame graph for a span's time window.
 *
 * Sampling: CPU at the pprof default (100 Hz), heap every 512 KiB allocated.
 */

import { logger } from "./logger.js";

export async function startProfiling({ role = "indexer" } = {}) {
  const serverAddress = process.env.PYROSCOPE_SERVER_ADDRESS;
  if (!serverAddress) return false;

  let Pyroscope;
  try {
    ({ default: Pyroscope } = await import("@pyroscope/nodejs"));
  } catch (err) {
    logger.warn({ err: err.message }, "profiling disabled: @pyroscope/nodejs not installed");
    return false;
  }

  Pyroscope.init({
    serverAddress,
    appName: process.env.PYROSCOPE_APP_NAME || "soroban-indexer",
    tags: {
      role,
      version: process.env.APP_VERSION || process.env.npm_package_version || "dev",
    },
    heap: { samplingIntervalBytes: 512 * 1024 },
  });
  Pyroscope.start();
  logger.info({ serverAddress, role }, "continuous profiling started");
  return true;
}
