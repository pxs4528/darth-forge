# Stage 1: Build the static bundle.
# Pinned to $BUILDPLATFORM: vite output is arch-independent, so the node stage
# always runs natively on the CI runner instead of emulated under QEMU.
FROM --platform=$BUILDPLATFORM docker.io/library/node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY frontend/package.json ./frontend/package.json
RUN HUSKY=0 npm ci --no-audit --no-fund
COPY frontend ./frontend
RUN npm run build

# Run the compiler natively; Go cross-compiles the output for each target.
# Keep this stage independent of frontend sources so UI edits reuse its layer.
FROM --platform=$BUILDPLATFORM docker.io/library/caddy:2-builder AS caddy-builder
ARG TARGETOS
ARG TARGETARCH
ARG TARGETVARIANT
RUN set -eu; \
    export CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}"; \
    if [ "${TARGETARCH}" = "arm" ]; then \
        export GOARM="${TARGETVARIANT#v}"; \
    fi; \
    xcaddy build --with github.com/caddy-dns/cloudflare --output /usr/bin/caddy

# Stage 2: Caddy serves the bundle and proxies /api to the backend.
FROM docker.io/library/caddy:2
COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy
COPY --from=builder /app/frontend/dist /srv
# Caddyfile      — behind a Cloudflare Tunnel (the Pi): plain :80, no TLS.
# Caddyfile.vps  — directly exposed: two hostnames, automatic HTTPS.
# The default is the tunnel config; compose.vps.yaml overrides the command.
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY frontend/Caddyfile.vps /etc/caddy/Caddyfile.vps
EXPOSE 80 443
