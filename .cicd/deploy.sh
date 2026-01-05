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
echo "[1/3] Pulling latest code from GitHub..." | tee -a "$LOG_FILE"
git fetch origin main 2>&1 | tee -a "$LOG_FILE"
git reset --hard origin/main 2>&1 | tee -a "$LOG_FILE"

# Stop old containers
echo "[2/3] Stopping old containers..." | tee -a "$LOG_FILE"
docker compose -f compose.yaml -f compose.prod.yaml down 2>&1 | tee -a "$LOG_FILE" || true

# Build and start new containers
echo "[3/3] Building and starting new containers..." | tee -a "$LOG_FILE"
docker compose -f compose.yaml -f compose.prod.yaml up -d --build 2>&1 | tee -a "$LOG_FILE"

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
