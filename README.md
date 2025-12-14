# Darth Forge

A production-ready personal website built with SolidJS frontend, Go backend, and containerized with Podman. Self-hosted on Raspberry Pi with Cloudflare Tunnel and automated CI/CD pipeline.

**🌐 Live:** https://pipboi.dev

## ✨ Features

- 🚀 Automatic deployment on git push
- 🔒 Secure Cloudflare Tunnel (no port forwarding)
- 🆓 Zero cost hosting ($0/month)
- 📦 Containerized with Podman
- 🔄 CI/CD with GitHub webhooks
- 🌐 Custom domain with HTTPS

## 🏗️ Architecture

### Production (Self-Hosted on Raspberry Pi)

```
Browser → Cloudflare Edge (DDoS, SSL) → Cloudflare Tunnel → Raspberry Pi
                                                              ├─ Frontend Container (Caddy + SolidJS)
                                                              └─ Backend Container (Go API)

Developer → git push → GitHub → Webhook → Cloudflare Tunnel → Webhook Listener → Auto Deploy
```

### Local Development

```
Browser → Caddy (Frontend Container) → Go API (Backend Container)
          ├─ Serves SolidJS app
          └─ Reverse proxies /api/* to backend
```

**Tech Stack:**
- **Frontend:** SolidJS, Vite, TailwindCSS, Caddy web server
- **Backend:** Go 1.21, standard library HTTP server
- **Containerization:** Podman (Docker-compatible)
- **Deployment:** Cloudflare Tunnel, GitHub Webhooks
- **Hosting:** Raspberry Pi (self-hosted, $0/month)

## 📋 Prerequisites

- **WSL2** (for Windows development) or **Linux**
- **Podman** 4.9.3+ or Docker
- **podman-compose** 1.0.6+ or docker-compose
- **Go** 1.21+ (for local development)
- **Node.js** 18+ (for local development)

### Installation

**WSL2 (Ubuntu):**
```bash
# Install Podman
sudo apt update
sudo apt install podman

# Install podman-compose
pip3 install podman-compose
```

**Verify:**
```bash
podman --version
podman-compose --version
```

## 🔧 Environment Configuration

This project uses environment-based configuration for different deployment scenarios.

### Environment Files

| File | Purpose | Committed to Git? |
|------|---------|------------------|
| `.env.local` | Local WSL development (no containers) | ❌ No |
| `.env.dev` | Container development | ✅ Yes |
| `.env.prod` | Production (Raspberry Pi) | ❌ No |
| `.env.prod.example` | Production template | ✅ Yes |

### Setup for Development

The `.env.dev` file is already configured and committed. No setup needed!

### Setup for Production

```bash
# Copy template
cp .env.prod.example .env.prod

# Edit and fill in your values
nano .env.prod
```

**Required changes in `.env.prod`:**
- `DOMAIN=yoursite.com` - Your actual domain name
- Add any secrets (DB passwords, API keys, etc.)

## 🚀 Quick Start

### Development Mode (Recommended)

Start both frontend and backend in containers:

```bash
# Build images
podman-compose build

# Start containers (foreground, see logs)
podman-compose up

# Or start in background
podman-compose up -d

# View logs
podman-compose logs -f

# Stop containers
podman-compose down
```

**Access:**
- **Frontend:** http://localhost:8080
- **API (via frontend):** http://localhost:8080/api/health
- **API (direct):** http://localhost:8081/api/health

### Local Development (No Containers)

Run services directly in WSL for faster iteration:

```bash
# Terminal 1: Frontend
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173

# Terminal 2: Backend
cd backend
go run cmd/api/main.go
# Runs on http://localhost:8080

# Terminal 3: Caddy (optional)
export $(cat .env.local | xargs)
caddy run
```

## 📦 Podman Compose Commands

### Building

```bash
# Build all services
podman-compose build

# Build specific service
podman-compose build frontend
podman-compose build backend

# Force rebuild (ignore cache)
podman-compose build --no-cache

# Build with different compose files
podman-compose -f compose.yaml -f compose.prod.yaml build
```

### Running

```bash
# Start all services (foreground)
podman-compose up

# Start in background (detached)
podman-compose up -d

# Start and rebuild if needed
podman-compose up --build

# Start specific service
podman-compose up frontend

# Start with production config
podman-compose -f compose.yaml -f compose.prod.yaml up -d
```

### Stopping

```bash
# Stop all services (keeps containers)
podman-compose stop

# Stop and remove containers
podman-compose down

# Stop, remove containers and volumes
podman-compose down -v
```

### Logs

```bash
# View all logs
podman-compose logs

# Follow logs (live)
podman-compose logs -f

# Logs for specific service
podman-compose logs frontend
podman-compose logs -f backend

# Last 100 lines
podman-compose logs --tail=100
```

### Managing Services

```bash
# Restart all services
podman-compose restart

# Restart specific service
podman-compose restart backend

# List running containers
podman-compose ps

# Execute command in running container
podman-compose exec frontend sh
podman-compose exec backend sh
```

### Cleanup

```bash
# Remove stopped containers
podman-compose rm

# Remove all project containers (stops first)
podman-compose down

# Remove containers and volumes
podman-compose down -v

# Remove containers, volumes, and images
podman-compose down -v --rmi all
```

## 🔍 Debugging & Inspection

### View Final Merged Configuration

See what compose will actually use (helpful for debugging):

```bash
# Development config (compose.yaml + compose.override.yaml)
podman-compose config

# Production config
podman-compose -f compose.yaml -f compose.prod.yaml config

# Validate configuration
podman-compose config --quiet
```

### Container Inspection

```bash
# List containers
podman ps

# Inspect container details
podman inspect darth-forge-backend

# View container resource usage
podman stats

# Check container health
podman healthcheck run darth-forge-backend
```

### Network Debugging

```bash
# List networks
podman network ls

# Inspect project network
podman network inspect darth-forge_default

# Test connectivity between containers
podman exec darth-forge-frontend ping backend
podman exec darth-forge-frontend wget -O- http://backend:8080/api/health
```

### Image Management

```bash
# List images
podman images

# Remove unused images
podman image prune

# Remove specific image
podman rmi darth-forge_frontend
```

## 🌍 Deployment Scenarios

### Scenario 1: Local Development (Default)

**Uses:** `compose.yaml` + `compose.override.yaml` (auto-loaded)

```bash
podman-compose up
```

**Configuration:**
- Backend exposed on port 8081 (direct debugging)
- Frontend on port 8080 (main access)
- Debug mode enabled
- Uses `.env.dev`

### Scenario 2: Production (Raspberry Pi)

**Uses:** `compose.yaml` + `compose.prod.yaml` (explicit)

```bash
podman-compose -f compose.yaml -f compose.prod.yaml up -d
```

**Configuration:**
- Only frontend exposed (port 80 or 443)
- Backend internal only (accessed via frontend proxy)
- Production logging enabled
- Uses `.env.prod`
- Caddy handles HTTPS automatically

### Scenario 3: Testing Production Config Locally

Test production setup before deploying:

```bash
# Create temporary .env.prod for testing
cp .env.prod.example .env.prod
nano .env.prod  # Set DOMAIN=localhost

# Run production config
podman-compose -f compose.yaml -f compose.prod.yaml up
```

## 🧪 Testing

### Manual Testing

```bash
# Health check
curl http://localhost:8080/api/health
# Expected: {"status":"healthy"}

# Frontend
curl http://localhost:8080
# Expected: HTML with SolidJS app

# Direct backend (dev only)
curl http://localhost:8081/api/health
```

### Automated Testing (TODO)

```bash
# Run backend tests
cd backend
go test ./...

# Run frontend tests
cd frontend
npm test
```

## 🔄 Development Workflow

### Making Changes

**Frontend changes:**
```bash
# 1. Edit code in frontend/src
# 2. Rebuild and restart
podman-compose up --build frontend
```

**Backend changes:**
```bash
# 1. Edit code in backend/
# 2. Rebuild and restart
podman-compose up --build backend
```

**Configuration changes:**
```bash
# 1. Edit compose files or env files
# 2. Restart (no rebuild needed for env changes)
podman-compose down
podman-compose up
```

### Cleaning Build Cache

If builds are cached incorrectly:

```bash
# Rebuild without cache
podman-compose build --no-cache

# Remove all stopped containers and rebuild
podman-compose down
podman system prune
podman-compose build
```

## 📁 Project Structure

```
darth-forge/
├── frontend/                 # SolidJS application
│   ├── src/                 # Source code
│   ├── dist/                # Build output (gitignored)
│   ├── Containerfile        # Frontend container build
│   ├── Caddyfile            # Caddy web server config
│   ├── .containerignore     # Files to exclude from image
│   └── package.json
├── backend/                 # Go API
│   ├── cmd/api/main.go      # Application entry point
│   ├── Containerfile        # Backend container build
│   ├── .containerignore     # Files to exclude from image
│   └── go.mod
├── nginx/                   # nginx configs (for reference)
├── compose.yaml             # Base compose configuration
├── compose.override.yaml    # Development overrides (auto-loaded)
├── compose.prod.yaml        # Production overrides
├── Caddyfile                # Caddyfile for local development
├── .env.dev                 # Development environment
├── .env.prod.example        # Production template
└── README.md                # This file
```

## 🚨 Troubleshooting

### Port Already in Use

**Error:** `bind: address already in use`

**Solution:**
```bash
# Find what's using the port
sudo lsof -i :8080

# Stop conflicting service (e.g., nginx)
sudo systemctl stop nginx

# Or change ports in compose.override.yaml
```

### Container Name Already Exists

**Error:** `container name "darth-forge-backend" is already in use`

**Solution:**
```bash
# Remove old containers
podman-compose down

# Or remove manually
podman rm -f darth-forge-backend darth-forge-frontend
```

### Cannot Connect to Backend

**Symptoms:** Frontend works, but API calls fail (502 Bad Gateway)

**Debug:**
```bash
# Check if backend is running
podman-compose ps

# Check backend logs
podman-compose logs backend

# Test backend from frontend container
podman exec darth-forge-frontend wget -O- http://backend:8080/api/health

# Check network
podman network inspect darth-forge_default
```

### Image Build Fails

**Solution:**
```bash
# Check Containerfile syntax
cat frontend/Containerfile

# Build with verbose output
podman build -f frontend/Containerfile -t test ./frontend

# Clear cache and rebuild
podman-compose build --no-cache
```

### Changes Not Reflected

**Problem:** Code changes don't appear after rebuild

**Solution:**
```bash
# Full cleanup and rebuild
podman-compose down
podman rmi darth-forge_frontend darth-forge_backend
podman-compose build --no-cache
podman-compose up
```

## 🚀 Deployment

This project is fully deployed and running on a Raspberry Pi with automatic CI/CD.

**For deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md)**

### Quick Deploy Workflow

```bash
# On your development machine
git add .
git commit -m "Your changes"
git push

# Automatic deployment happens:
# 1. GitHub sends webhook to Cloudflare Tunnel
# 2. Raspberry Pi receives webhook
# 3. Pulls latest code
# 4. Rebuilds containers
# 5. Restarts services
# 6. Live in ~2 minutes at https://pipboi.dev
```

## 🎯 Next Steps

- [x] Deploy to Raspberry Pi
- [x] Configure domain with Cloudflare Tunnel
- [x] Set up GitHub webhook CI/CD
- [ ] Add database (PostgreSQL)
- [ ] Add Prometheus + Grafana monitoring
- [ ] Add automated tests
- [ ] Implement features from project roadmap

## 📚 Resources

- [Podman Documentation](https://docs.podman.io/)
- [Caddy Documentation](https://caddyserver.com/docs/)
- [SolidJS Guide](https://www.solidjs.com/guides/getting-started)
- [Go Web Development](https://go.dev/doc/articles/wiki/)
- [12 Factor App](https://12factor.net/) - Best practices for modern apps

## 🤝 Contributing

This is a personal learning project, but suggestions are welcome!

## 📝 License

MIT - Feel free to use this as a template for your own projects.
# Test webhook
