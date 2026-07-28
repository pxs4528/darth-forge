#!/bin/bash
set -euo pipefail

# Deployment script for darth-forge — pull-only.
#
# All images are built by GitHub Actions and pushed to GHCR
# (.github/workflows/deploy.yml). This script only:
#   1. syncs the repo (compose files, this script)
#   2. pulls the new images
#   3. recreates containers
#   4. health-checks and prunes old image layers
# The Pi never compiles or builds anything.
#
# flock -n drops duplicate webhook triggers.

# Override PROJECT_DIR (or DEPLOY_BRANCH) via env when hosting moves —
# nothing else in this script is host-specific.
PROJECT_DIR="${PROJECT_DIR:-/home/darth/darth-forge}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
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

# ── 1/4  Sync repo (compose files, Caddyfile, this script) ──────────────────
log "[1/4] Syncing repo..."
git fetch origin "$DEPLOY_BRANCH" 2>&1 | tee -a "$LOG_FILE"
git reset --hard "origin/$DEPLOY_BRANCH" 2>&1 | tee -a "$LOG_FILE"

# ── 2/4  Pull new images from GHCR ──────────────────────────────────────────
log "[2/4] Pulling images..."
if ! docker compose -f compose.yaml -f compose.prod.yaml pull 2>&1 | tee -a "$LOG_FILE"; then
    log "✗ Image pull failed — containers untouched."
    log "  (If GHCR packages are private: docker login ghcr.io first.)"
    exit 1
fi

# ── 3/4  Recreate containers with the new images ────────────────────────────
log "[3/4] Recreating containers..."
docker compose -f compose.yaml -f compose.prod.yaml up -d --no-build 2>&1 | tee -a "$LOG_FILE"

# ── 4/4  Health-check, then prune superseded layers ─────────────────────────
log "[4/4] Verifying deployment..."
healthy=0
for i in $(seq 1 30); do
    if curl -fsS http://localhost:8080/api/health >/dev/null 2>&1; then
        log "✓ Site healthy (after $((i*2))s)"
        healthy=1
        break
    fi
    sleep 2
done
[ "$healthy" = 1 ] || log "✗ Health check failed after 60s — check: docker compose logs"

docker image prune -f 2>&1 | tee -a "$LOG_FILE"

log "Deployment completed at $(date)"
log "========================================"
