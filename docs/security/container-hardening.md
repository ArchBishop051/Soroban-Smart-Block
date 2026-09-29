# Container Hardening

Both production images (#930) run without root and without a writable root filesystem.

| Image | Base | User | Health check |
|-------|------|------|--------------|
| indexer | `gcr.io/distroless/nodejs20-debian12:nonroot` (glibc, no shell) | 65532 | `node -e fetch(/health)` |
| frontend | `nginxinc/nginx-unprivileged:1.25-alpine` | 101 (any uid works) | `wget /` |

## Runtime profile

```bash
docker run --read-only --user 65532 --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp [--tmpfs /var/cache/nginx  # frontend only] <image>
```

Docker's default seccomp profile (`RuntimeDefault` in Kubernetes) applies; do
not run with `seccomp=unconfined`.

## Supply chain

- `deploy.yml` pushes images with BuildKit SBOM + SLSA provenance, attests them
  with `actions/attest-build-provenance`, and signs them keyless with cosign
  (GitHub OIDC).
- The `verify-images` job runs `cosign verify` against the pushed digests with
  the `deploy.yml` workflow identity; deploy jobs depend on it, so an unsigned
  or tampered image stops the deploy.
- Kubernetes clusters should enforce the same identity with an admission
  policy (e.g. Sigstore policy-controller `ClusterImagePolicy`).
- `docker-indexer.yml` / `docker-frontend.yml` gate on Trivy HIGH/CRITICAL
  findings; exceptions go in `.trivyignore` with an expiry comment.

## Debugging in production

There is no shell in the indexer image. Attach an ephemeral debug container
that shares the target's process namespace, and remove it afterwards:

```bash
# Docker
docker run --rm -it --pid=container:<id> --network=container:<id> busybox sh
# Kubernetes
kubectl debug -it <pod> --image=busybox --target=indexer
```
