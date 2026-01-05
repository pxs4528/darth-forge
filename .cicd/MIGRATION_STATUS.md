# Migration Status & Next Steps

**Date:** 2026-01-05
**Status:** In Progress - Need to complete Vite build on ARM

---

## What We've Done

### ✅ Completed Tasks

1. **Migrated from Podman to Docker**
   - Podman v5.4.2 has critical segfaults on ARM64 (Raspberry Pi)
   - Installed Docker 29.1.3 successfully
   - Created Dockerfiles from Containerfiles
   - Updated compose.yaml to reference Dockerfiles
   - Updated deploy.sh to use `docker compose` instead of `podman-compose`

2. **Fixed Frontend JavaScript Errors**
   - Removed `import "solid-devtools";` from `frontend/src/index.tsx`
   - This was causing: `can't access property "live", n.links is undefined`
   - Removed devtools plugin from `vite.config.ts`

3. **Optimized Vite Build for ARM**
   - Set `NODE_OPTIONS="--max-old-space-size=1536"` in frontend Dockerfile
   - Configured esbuild minifier (faster, less memory)
   - Disabled manual chunks to reduce memory fragmentation
   - All committed to GitHub (commit: b807285)

4. **Documentation**
   - Created `.cicd/DOCKER_MIGRATION.md` (full migration guide)
   - Created `.cicd/cleanup-podman.sh` (cleanup script)

---

## Current Issues

### 🔴 CRITICAL: Vite Build Segfault

**Symptom:**
```
vite v7.3.0 building client environment for production...
transforming...
Segmentation fault (core dumped)
```

**Root Cause:** Vite build is very memory-intensive on ARM64, crashes during build

**System Resources:**
- RAM: 3.7GB total, only 1.5GB available
- Swap: 1GB total, 654MB available
- Vite needs ~2GB+ to build safely on ARM

**Attempted Fixes:**
- ✅ Set NODE_OPTIONS max-old-space-size=1536
- ✅ Optimized vite.config.ts
- ⏳ Need to test after Pi restart (user is restarting now)

### ⚠️ Webhook Permission Issues

**Symptom:**
```
permission denied while trying to connect to the Docker daemon socket
```

**Root Cause:** Webhook listener runs as user `darth`, but docker group membership hasn't taken effect (process started before group was added)

**Fix Required:** Restart webhook listener after Pi reboot

---

## Next Steps (After Pi Restart)

### Step 1: Test Optimized Vite Build

```bash
cd ~/darth-forge

# Pull latest changes with memory optimizations
git pull

# Try building with new memory settings
docker compose -f compose.yaml -f compose.prod.yaml down
docker compose -f compose.yaml -f compose.prod.yaml up -d --build

# Monitor build logs
docker compose -f compose.yaml -f compose.prod.yaml logs -f frontend
```

**If build succeeds:** ✅ Done! Check site at http://darth.local:8080

**If build still segfaults:** Go to Step 2

### Step 2: Build on GitHub Actions (Recommended)

If local ARM build fails, build images on GitHub Actions (x86 runners have more RAM) and push to GitHub Container Registry (ghcr.io).

**Changes needed:**
1. Create `.github/workflows/build-images.yml` - Build & push images to ghcr.io
2. Update `compose.yaml` - Pull pre-built images instead of building locally
3. Update `deploy.sh` - Just pull and restart (no build step)

This is what production systems do - build on powerful CI servers, deploy lightweight containers.

### Step 3: Fix Webhook for Future Deployments

After Pi restart, the webhook listener will have docker group permissions:

```bash
# Verify webhook can access docker
sudo systemctl status webhook
ps aux | grep webhook-listener

# Test manual trigger
curl http://localhost:9000/health

# Check logs
tail -f /home/darth/darth-forge/.cicd/webhook.log
```

---

## Quick Recovery Commands

### Check Current Status
```bash
# Check if Docker is running
docker ps

# Check containers
docker ps -a

# Check system resources
free -h

# Check webhook status
sudo systemctl status webhook
```

### Manual Deployment
```bash
cd ~/darth-forge
git pull
docker compose -f compose.yaml -f compose.prod.yaml down
docker compose -f compose.yaml -f compose.prod.yaml up -d --build
```

### View Logs
```bash
# Frontend logs
docker logs darth-forge-frontend --tail 50 -f

# Backend logs
docker logs darth-forge-backend --tail 50 -f

# Deployment logs
tail -f .cicd/deploy.log

# Webhook logs
tail -f .cicd/webhook.log
```

### Test Endpoints
```bash
# Backend health check
curl http://localhost:8080/api/health
# Should return: {"status":"healthy"}

# Frontend
curl -I http://localhost:8080
# Should return: HTTP/1.1 200 OK

# Open in browser
# http://darth.local:8080
```

---

## Architecture Overview

```
GitHub Push
     ↓
GitHub Actions (deploy.yml)
     ↓
Webhook → webhook.pipboi.dev
     ↓
Cloudflare Tunnel (cloudflared)
     ↓
Raspberry Pi → webhook-listener.py (port 9000)
     ↓
deploy.sh
     ↓
Docker Compose
     ↓
┌─────────────────┐     ┌──────────────────┐
│ Frontend        │     │ Backend          │
│ (Caddy + React) │────▶│ (Go API)         │
│ Port: 8080      │     │ Port: 8080       │
└─────────────────┘     └──────────────────┘
```

**Key Files:**
- `.cicd/deploy.sh` - Main deployment script
- `compose.yaml` - Base Docker Compose config
- `compose.prod.yaml` - Production overrides
- `.cicd/webhook-listener.py` - GitHub webhook receiver
- `frontend/Dockerfile` - Frontend build instructions
- `backend/Dockerfile` - Backend build instructions
- `frontend/Caddyfile` - Caddy reverse proxy config

---

## Known Working Commits

- `b807285` - Latest (Vite memory optimizations)
- `1ece911` - Removed solid-devtools from production
- `80a1cbf` - Docker migration complete
- `56e60a2` - Last podman commit (broken)

---

## Important Notes

1. **Don't use podman anymore** - It crashes on ARM64
2. **Frontend needs to build** - Currently segfaulting during Vite build
3. **Backend is working** - Builds fine, returns `{"status":"healthy"}`
4. **Caddy routing is correct** - `/api/*` → backend:8080, everything else → frontend
5. **Cloudflare Tunnel is running** - PID 1690, routes traffic correctly

---

## If All Else Fails: Alternative Solutions

### Option 1: Pre-build Frontend Locally (Outside Docker)
Build on Pi directly, then copy dist to container:
```bash
cd frontend
npm install
npm run build
# Copy dist to Docker image
```

### Option 2: Use Multi-Arch Images from CI
Let GitHub Actions build for arm64/aarch64, push to registry, pull on Pi

### Option 3: Reduce Frontend Complexity
Simplify the build or use a simpler framework that doesn't need Vite

### Option 4: Add More Swap
Increase swap file size to 2GB+ to give Vite more virtual memory:
```bash
sudo swapoff -a
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## Contact Info

GitHub Repo: https://github.com/pxs4528/darth-forge
Issues: https://github.com/pxs4528/darth-forge/issues
Website: https://pipboi.dev (via Cloudflare Tunnel)

---

**Last Updated:** 2026-01-05 23:15 CST
**Next Action:** Test optimized build after Pi restart
