# Migration from Podman to Docker

## Why We Migrated

Podman v5.4.2 has critical stability issues on ARM64 (Raspberry Pi):
- Both rootful and rootless modes crash with SIGSEGV
- podman-compose fails with segmentation faults
- Known bug in podman on Ubuntu 25.10 ARM64

Docker has better ARM support and is production-proven on Raspberry Pi.

## Changes Made

### 1. Renamed Containerfiles → Dockerfiles
- `backend/Containerfile` → `backend/Dockerfile`
- `frontend/Containerfile` → `frontend/Dockerfile`
- Content remains identical (multi-stage builds work the same)

### 2. Updated deploy.sh
**Before:**
```bash
podman-compose -f compose.yaml -f compose.prod.yaml up -d --build
```

**After:**
```bash
sudo docker compose -f compose.yaml -f compose.prod.yaml up -d --build
```

### 3. Updated compose.yaml
**Before:**
```yaml
backend:
  image: darth-forge_backend:latest
  build:
    context: ./backend
    dockerfile: Containerfile
```

**After:**
```yaml
backend:
  build:
    context: ./backend
    dockerfile: Dockerfile
```

### 4. Cleanup Steps

After Docker is installed and working:

```bash
# Remove all podman containers
podman stop -a
podman rm -a

# Remove all podman images
podman rmi -a

# Remove podman-compose (optional)
sudo apt-get remove -y podman podman-compose

# Remove podman user config
rm -rf ~/.local/share/containers
rm -rf ~/.config/containers
```

## Verification

After migration, verify deployment:

```bash
# Check Docker is running
sudo docker --version
sudo systemctl status docker

# Test deployment
bash .cicd/deploy.sh

# Check running containers
sudo docker ps

# View logs
sudo docker logs darth-forge-frontend
sudo docker logs darth-forge-backend

# Check health
curl http://localhost:8080/api/health
curl http://localhost:8080
```

## Differences from Podman

| Feature | Podman | Docker |
|---------|--------|--------|
| **Root required** | No (rootless mode) | Yes (sudo needed) |
| **Daemon** | Daemonless | Dockerd daemon |
| **Security** | More secure (rootless) | Rootful only |
| **ARM Stability** | ❌ Crashes | ✅ Stable |
| **Command** | `podman-compose` | `docker compose` |
| **Socket** | Not required | `/var/run/docker.sock` |

## Rollback (if needed)

If you need to go back to podman:

```bash
# Reinstall podman
sudo apt-get install -y podman podman-compose

# Revert files
git checkout <commit-before-migration>

# Remove Docker
sudo systemctl stop docker
sudo apt-get remove -y docker-ce docker-ce-cli containerd.io
```

## Future Considerations

With Docker installed, you can now easily add:
- **Watchtower** - Auto-update containers on new images
- **Portainer** - Web UI for managing containers
- **Grafana/Prometheus** - Monitoring stack (easier with Docker)
- **Traefik** - Better reverse proxy with automatic SSL

These are harder to setup with podman due to ARM stability issues.
