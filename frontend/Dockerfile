# Stage 1: Build the static bundle.
# Pinned to $BUILDPLATFORM: vite output is arch-independent, so the node stage
# always runs natively on the CI runner instead of emulated under QEMU.
FROM --platform=$BUILDPLATFORM docker.io/library/node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend ./frontend
RUN npm run build

# Stage 2: Caddy serves the bundle and proxies /api to the backend.
FROM docker.io/library/caddy:2
COPY --from=builder /app/frontend/dist /srv
# Caddyfile      — behind a Cloudflare Tunnel (the Pi): plain :80, no TLS.
# Caddyfile.vps  — directly exposed: two hostnames, automatic HTTPS.
# The default is the tunnel config; compose.vps.yaml overrides the command.
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY frontend/Caddyfile.vps /etc/caddy/Caddyfile.vps
EXPOSE 80 443
