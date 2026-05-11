#!/bin/bash
set -euo pipefail

# Deployment script for darth-forge.
#
# Workarounds for current Pi instability (2026-05-11):
#   - buildx crashes with "invalid runtime symbol table" → DOCKER_BUILDKIT=0
#   - npm install segfaults inside node:20-slim → build frontend on host
#   - duplicate webhook triggers → flock -n drops the second one
#   - containers are only recreated AFTER builds succeed, so a build failure
#     no longer takes the site down

PROJECT_DIR="/home/darth/darth-forge"
LOG_FILE="$PROJECT_DIR/.cicd/deploy.log"
LOCK_FILE="$PROJECT_DIR/.cicd/deploy.lock"

mkdir -p "$(dirname "$LOG_FILE")"
exec {LOCK_FD}>"$LOCK_FILE"
if ! flock -n "$LOCK_FD"; then
    echo "[$(date)] deploy.sh: another run already in progress — skipping" | tee -a "$LOG_FILE"
    exit 0
fi

log() { echo "$@" | tee -a "$LOG_FILE"; }

log "========================================"
log "Deployment started at $(date)"
log "========================================"

cd "$PROJECT_DIR"

# ── 1/5  Pull latest code ───────────────────────────────────────────────────
log "[1/5] Pulling latest code from GitHub..."
git fetch origin main 2>&1 | tee -a "$LOG_FILE"
git reset --hard origin/main 2>&1 | tee -a "$LOG_FILE"

# ── 2/5  Build frontend dist on host (npm install segfaults inside docker) ──
log "[2/5] Building frontend on host..."
npm install --no-audit --no-fund 2>&1 | tee -a "$LOG_FILE"
npm run build 2>&1 | tee -a "$LOG_FILE"
if [ ! -f frontend/dist/index.html ]; then
    log "✗ frontend/dist/index.html missing after build — aborting (containers untouched)"
    exit 1
fi

# ── 3/5  Build images with legacy builder ───────────────────────────────────
log "[3/5] Building backend + infosec images (legacy builder)..."
DOCKER_BUILDKIT=0 docker compose -f compose.yaml -f compose.prod.yaml build backend infosec 2>&1 | tee -a "$LOG_FILE"

log "[3/5] Baking frontend dist into caddy image..."
FRONTEND_CTX=$(mktemp -d)
trap 'rm -rf "$FRONTEND_CTX"' EXIT
cp -r frontend/dist "$FRONTEND_CTX/dist"
cp frontend/Caddyfile "$FRONTEND_CTX/Caddyfile"
cat > "$FRONTEND_CTX/Dockerfile" <<'DOCKERFILE'
FROM docker.io/library/caddy:2
COPY dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
DOCKERFILE
DOCKER_BUILDKIT=0 docker build -t darth-forge-frontend:latest "$FRONTEND_CTX" 2>&1 | tee -a "$LOG_FILE"

# ── 4/5  Recreate containers — only now that all builds succeeded ───────────
log "[4/5] Recreating containers..."
docker compose -f compose.yaml -f compose.prod.yaml up -d --no-build 2>&1 | tee -a "$LOG_FILE"

# ── 5/5  Health-check with retry ────────────────────────────────────────────
log "[5/5] Verifying deployment..."
backend_ok=0
frontend_ok=0
for i in $(seq 1 30); do
    if [ "$backend_ok" = 0 ] && curl -fsS http://localhost:8080/api/health >/dev/null; then
        log "✓ Backend healthy (after $((i*2))s)"
        backend_ok=1
    fi
    if [ "$frontend_ok" = 0 ] && curl -fsS http://localhost:8080 >/dev/null; then
        log "✓ Frontend healthy (after $((i*2))s)"
        frontend_ok=1
    fi
    if [ "$backend_ok" = 1 ] && [ "$frontend_ok" = 1 ]; then break; fi
    sleep 2
done

[ "$backend_ok"  = 1 ] || log "✗ Backend health check failed after 60s"
[ "$frontend_ok" = 1 ] || log "✗ Frontend health check failed after 60s"

log "Deployment completed at $(date)"
log "========================================"
