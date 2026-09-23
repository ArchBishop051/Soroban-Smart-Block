# Devcontainer image: Rust + Node 20 + wasm32 target
#
# Kept deliberately small and self-contained: the build context is
# .devcontainer/, so nothing from the repository is COPY'd in. The workspace is
# bind-mounted over /workspaces/Soroban-Smart-Block at runtime, which would hide
# any node_modules baked into the image anyway, so dependency installs happen in
# postCreateCommand instead.

FROM mcr.microsoft.com/devcontainers/rust:1

# Node.js 20 via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs postgresql-client \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Soroban contract builds need the wasm32 target. Install it for the vscode
# user, which owns the rustup toolchain in this base image.
USER vscode
RUN rustup target add wasm32-unknown-unknown

# Stellar CLI from the prebuilt release binary (optional tooling: a failed
# download must never break container creation).
USER root
RUN set -eux; \
    arch="$(uname -m)"; \
    url="$(curl -fsSL https://api.github.com/repos/stellar/stellar-cli/releases/latest \
      | grep -o "https://[^\"]*stellar-cli-[^\"]*-${arch}-unknown-linux-gnu.tar.gz" | head -n1)" \
    && [ -n "$url" ] \
    && curl -fsSL "$url" | tar -xz -C /usr/local/bin stellar \
    && stellar --version \
    || echo "WARN: stellar-cli not installed; run 'cargo install --locked stellar-cli' later if needed"

USER vscode
