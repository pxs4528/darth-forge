#!/bin/bash
set -e

# Deployment script for darth-forge
# This script pulls latest code and rebuilds/restarts containers

PROJECT_DIR="/home/darth/darth-forge"
LOG_FILE="/home/darth/darth-forge/.cicd/deploy.log"

echo "========================================" | tee -a "$LOG_FILE"
echo "Deployment started at $(date)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

cd "$PROJECT_DIR"

# Pull latest code
echo "[1/5] Pulling latest code from GitHub..." | tee -a "$LOG_FILE"
git fetch origin main 2>&1 | tee -a "$LOG_FILE"
git reset --hard origin/main 2>&1 | tee -a "$LOG_FILE"

# Build new images
echo "[2/5] Building backend image..." | tee -a "$LOG_FILE"
podman build --network=host -f backend/Containerfile -t darth-forge_backend:latest backend/ 2>&1 | tee -a "$LOG_FILE"

echo "[3/5] Building frontend image..." | tee -a "$LOG_FILE"
podman build --network=host -f frontend/Containerfile -t darth-forge_frontend:latest frontend/ 2>&1 | tee -a "$LOG_FILE"

# Stop old containers
echo "[4/5] Stopping old containers..." | tee -a "$LOG_FILE"
sudo podman-compose -f compose.yaml -f compose.prod.yaml down 2>&1 | tee -a "$LOG_FILE" || true

# Start new containers
echo "[5/5] Starting new containers..." | tee -a "$LOG_FILE"
sudo podman-compose -f compose.yaml -f compose.prod.yaml up -d 2>&1 | tee -a "$LOG_FILE"

# Verify deployment
echo "" | tee -a "$LOG_FILE"
echo "Verifying deployment..." | tee -a "$LOG_FILE"
sleep 3

if curl -f http://localhost:8080/api/health &>/dev/null; then
    echo "✓ Backend is healthy" | tee -a "$LOG_FILE"
else
    echo "✗ Backend health check failed!" | tee -a "$LOG_FILE"
fi

if curl -f http://localhost:8080 &>/dev/null; then
    echo "✓ Frontend is accessible" | tee -a "$LOG_FILE"
else
    echo "✗ Frontend check failed!" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "Deployment completed at $(date)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
