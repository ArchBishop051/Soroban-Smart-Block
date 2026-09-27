# =============================================================================
#  Soroban Smart Block — Indexer production image (Issue #343)
#
#  Stage 1 (build): install ONLY production runtime dependencies.
#  Stage 2 (final): distroless Node runtime (glibc, no shell / package manager),
#  non-root uid 65532, HEALTHCHECK via node's fetch (no shell needed) (#930).
#  Target image size: < 150MB.
#
#  Runtime hardening (compose / k8s): --read-only --tmpfs /tmp --cap-drop ALL
#  --security-opt no-new-privileges (seccomp: RuntimeDefault)
#  Production debugging: see docs/security/container-hardening.md.
# =============================================================================

# ---------- Stage 1: install production-only dependencies --------------------
# Debian (glibc) build stage so native modules match the distroless runtime.
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .


# ---------- Stage 2: distroless runtime -------------------------------------
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS final
WORKDIR /app

COPY --chown=65532:65532 --from=build /app /app

USER 65532:65532
ENV NODE_ENV=production

EXPOSE 3001

# No shell or wget in distroless — probe /health with node's built-in fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Exec form — the Node process is PID 1 and handles SIGTERM/SIGINT itself.
ENTRYPOINT ["/nodejs/bin/node", "src/index.js"]
