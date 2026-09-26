# Devcontainer image: Rust + wasm32 target + psql client
#
# Kept deliberately small and self-contained: the build context is
# .devcontainer/, so nothing from the repository is COPY'd in. The workspace is
# bind-mounted over /workspaces/Soroban-Smart-Block at runtime, which would hide
# any node_modules baked into the image anyway, so dependency installs happen in
# postCreateCommand instead.
#
# Node.js comes from the devcontainer "node" feature (see devcontainer.json),
# not from apt: the feature installs Node via nvm owned by the vscode user, so
# contributors can `npm install -g ...` without sudo/EACCES errors.

FROM mcr.microsoft.com/devcontainers/rust:1-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Soroban contract builds need the wasm32 target. Install it for the vscode
# user, which owns the rustup toolchain in this base image.
USER vscode
RUN rustup target add wasm32-unknown-unknown

# Stellar CLI from the prebuilt release binary (optional tooling: a failed
# download must never break container creation).
USER root
RUN arch="$(uname -m)"; \
    url="$(curl -fsSL https://api.github.com/repos/stellar/stellar-cli/releases/latest 2>/dev/null \
      | grep -o "https://[^\"]*stellar-cli-[^\"]*-${arch}-unknown-linux-gnu.tar.gz" | head -n1)"; \
    if [ -n "$url" ] && curl -fsSL "$url" | tar -xz -C /usr/local/bin stellar && stellar --version; then \
      echo "stellar-cli installed"; \
    else \
      echo "WARN: stellar-cli not installed; run 'cargo install --locked stellar-cli' later if needed"; \
    fi; \
    exit 0

USER vscode
