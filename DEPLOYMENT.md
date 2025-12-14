# Deployment Guide - darth-forge

Self-hosted deployment guide for the darth-forge web application using Cloudflare Tunnel and automated CI/CD.

## Architecture Overview

```
Your Development PC
    ↓ (git push)
GitHub Repository
    ↓ (webhook)
Cloudflare Edge Network (DDoS protection, SSL)
    ↓ (encrypted tunnel)
Raspberry Pi (Self-Hosted)
    ├─ Cloudflare Tunnel (cloudflared)
    ├─ Webhook Listener (Python)
    ├─ Frontend Container (SolidJS + Caddy)
    └─ Backend Container (Go API)
```

## Live URLs

- **Main Application:** https://pipboi.dev
- **Webhook Endpoint:** https://webhook.pipboi.dev/webhook (GitHub only)
- **Webhook Health:** https://webhook.pipboi.dev/health

## Key Features

### Security
- ✅ No port forwarding required
- ✅ Home IP address hidden behind Cloudflare
- ✅ Free DDoS protection
- ✅ Automatic HTTPS with Cloudflare SSL
- ✅ Webhook signature verification (HMAC-SHA256)
- ✅ Firewall remains closed

### Automation
- ✅ Automatic deployment on git push
- ✅ Zero-downtime container updates
- ✅ Health checks after deployment
- ✅ Deployment logs for debugging

### Cost
- **$0/month** - Completely free using Cloudflare Free tier

## Prerequisites

### Domain & Cloudflare
1. Domain name (pipboi.dev)
2. Cloudflare account (free tier)
3. Domain added to Cloudflare with nameservers updated

### Raspberry Pi
- Raspberry Pi running Ubuntu/Debian
- Podman and podman-compose installed
- Git configured with SSH access to GitHub
- Python 3 installed

## Initial Setup

### 1. Cloudflare Tunnel Setup

The Cloudflare Tunnel creates a secure, outbound-only connection from your Pi to Cloudflare's edge network, eliminating the need for port forwarding.

#### Installation

```bash
cd ~/darth-forge
./.cloudflare/setup-cloudflare-tunnel.sh
```

This automated script will:
1. Download and install `cloudflared` binary
2. Open browser for Cloudflare authentication
3. Prompt for your domain name
4. Create tunnel named "darth-forge"
5. Configure DNS routes automatically
6. Install systemd service
7. Validate configuration

#### Manual Configuration

If you need to configure manually, see `.cloudflare/README.md` for detailed instructions.

#### Start the Tunnel

```bash
# Start tunnel
sudo systemctl start cloudflared

# Enable auto-start on boot
sudo systemctl enable cloudflared

# Check status
sudo systemctl status cloudflared

# View logs
sudo journalctl -u cloudflared -f
```

#### DNS Configuration

The setup script automatically creates these DNS records in Cloudflare:
- `pipboi.dev` → CNAME to tunnel (main app)
- `webhook.pipboi.dev` → CNAME to tunnel (GitHub webhooks)

### 2. Webhook Listener Setup

The webhook listener receives GitHub push events and triggers automatic deployments.

#### Start the Webhook Listener

The webhook listener should already be running if you followed the CI/CD setup. To verify:

```bash
# Check if running
ps aux | grep webhook-listener

# View logs
tail -f .cicd/webhook.log

# View deployment logs
tail -f .cicd/deploy.log
```

If not running, start it:

```bash
cd ~/darth-forge
python3 .cicd/webhook-listener.py &
```

### 3. GitHub Webhook Configuration

#### Get Your Webhook Secret

```bash
cat ~/darth-forge/.cicd/.webhook_secret
```

#### Configure in GitHub

1. Go to: `https://github.com/<username>/darth-forge/settings/hooks`
2. Click "Add webhook" (or "Edit" if exists)
3. Configure:
   - **Payload URL:** `https://webhook.pipboi.dev/webhook`
   - **Content type:** `application/json`
   - **Secret:** (paste from `.webhook_secret` file)
   - **SSL verification:** Enable
   - **Events:** Just the push event
   - **Active:** ✓ Checked

4. Click "Add webhook" or "Update webhook"

#### Test the Webhook

1. In GitHub webhook settings, scroll to "Recent Deliveries"
2. Click "Redeliver" on any recent delivery
3. Should see response: `{"status": "deployment triggered"}`
4. Check Pi logs: `tail -f ~/darth-forge/.cicd/deploy.log`

## Deployment Workflow

### Automatic Deployment (Recommended)

Every time you push to the `main` branch, your Pi automatically:

1. **Receives webhook** from GitHub via Cloudflare Tunnel
2. **Verifies signature** using HMAC-SHA256
3. **Pulls latest code** from GitHub
4. **Builds containers**:
   - Backend (Go API)
   - Frontend (SolidJS + Caddy)
5. **Stops old containers**
6. **Starts new containers**
7. **Runs health checks**:
   - Backend: `/api/health` endpoint
   - Frontend: Root URL accessibility

**Typical deployment time:** 2-3 minutes

### From Your Development PC

```bash
# Make changes
vim frontend/src/App.tsx

# Commit and push
git add .
git commit -m "Update homepage"
git push

# Watch deployment on Pi (optional)
# SSH to Pi and run:
tail -f ~/darth-forge/.cicd/deploy.log
```

### Manual Deployment

If needed, you can deploy manually on the Pi:

```bash
cd ~/darth-forge

# Run deployment script directly
./.cicd/deploy.sh

# Or rebuild and restart specific service
podman-compose -f compose.yaml -f compose.prod.yaml restart frontend
```

## Container Management

### View Running Containers

```bash
podman ps
```

### View Logs

```bash
# Frontend logs (Caddy)
podman logs -f darth-forge-frontend

# Backend logs (Go API)
podman logs -f darth-forge-backend
```

### Restart Containers

```bash
cd ~/darth-forge

# Restart all
podman-compose -f compose.yaml -f compose.prod.yaml restart

# Restart specific service
podman-compose -f compose.yaml -f compose.prod.yaml restart frontend
podman-compose -f compose.yaml -f compose.prod.yaml restart backend
```

### Stop/Start All Services

```bash
# Stop all
podman-compose -f compose.yaml -f compose.prod.yaml down

# Start all
podman-compose -f compose.yaml -f compose.prod.yaml up -d
```

## Monitoring

### Check Service Health

```bash
# Frontend (via Cloudflare)
curl https://pipboi.dev

# Backend (via Cloudflare)
curl https://pipboi.dev/api/health

# Webhook listener
curl https://webhook.pipboi.dev/health

# Cloudflare Tunnel metrics
curl http://localhost:9001/metrics
```

### View Logs

```bash
# Cloudflare Tunnel
sudo journalctl -u cloudflared -f

# Webhook listener
tail -f ~/darth-forge/.cicd/webhook.log

# Deployment logs
tail -f ~/darth-forge/.cicd/deploy.log

# Container logs
podman logs -f darth-forge-frontend
podman logs -f darth-forge-backend
```

### Check System Resources

```bash
# Container stats
podman stats

# Disk usage
df -h

# Memory usage
free -h
```

## Troubleshooting

### Webhook Not Triggering Deployment

1. **Check webhook listener is running:**
   ```bash
   ps aux | grep webhook-listener
   ```

2. **Check webhook logs:**
   ```bash
   tail -f ~/darth-forge/.cicd/webhook.log
   ```

3. **Check GitHub delivery status:**
   - Go to GitHub webhook settings
   - View "Recent Deliveries"
   - Look for red X (failed) or green check (success)
   - Click delivery to see response

4. **Verify signature:**
   ```bash
   # Check webhook secret matches
   cat ~/darth-forge/.cicd/.webhook_secret
   # Compare with GitHub webhook secret
   ```

### Site Not Loading

1. **Check containers are running:**
   ```bash
   podman ps
   ```

2. **Check Cloudflare Tunnel:**
   ```bash
   sudo systemctl status cloudflared
   ```

3. **Test locally:**
   ```bash
   curl http://localhost:8080  # Frontend
   curl http://localhost:9000/health  # Webhook
   ```

4. **Check DNS:**
   ```bash
   nslookup pipboi.dev
   # Should point to Cloudflare IPs
   ```

### Container Build Fails

1. **Check deployment logs:**
   ```bash
   tail -100 ~/darth-forge/.cicd/deploy.log
   ```

2. **Try manual build:**
   ```bash
   cd ~/darth-forge/frontend
   podman build -f Containerfile .

   cd ~/darth-forge/backend
   podman build -f Containerfile .
   ```

3. **Check disk space:**
   ```bash
   df -h
   # Clean up old images if needed
   podman image prune
   ```

### 502 Bad Gateway

This usually means containers aren't running or unhealthy:

1. **Restart containers:**
   ```bash
   cd ~/darth-forge
   podman-compose -f compose.yaml -f compose.prod.yaml restart
   ```

2. **Check backend health:**
   ```bash
   curl http://localhost:8080/api/health
   ```

3. **Check logs for errors:**
   ```bash
   podman logs darth-forge-frontend
   podman logs darth-forge-backend
   ```

## Environment Configuration

### Production Environment Variables

Located in `.env.prod` (not in git - create from template):

```bash
# Frontend
WEB_ROOT=/srv
API_HOST=backend
API_PORT=8080
PORT=80
FRONTEND_PORT=80

# Backend
GO_ENV=production
LOG_LEVEL=info

# Domain
DOMAIN=pipboi.dev
```

### Development Environment

For local development, use `.env.dev`:

```bash
# Different ports for local testing
FRONTEND_PORT=8080
```

## Security Considerations

### What's Protected

- ✅ **Webhook secret** - Stored in `.cicd/.webhook_secret`, excluded from git
- ✅ **Environment variables** - `.env.prod` excluded from git
- ✅ **Cloudflare credentials** - Stored in `~/.cloudflared/`, outside repo
- ✅ **Home IP address** - Hidden behind Cloudflare Tunnel
- ✅ **Firewall** - No ports exposed to internet

### What to Protect

- 🔒 Never commit `.env.prod` or `.cicd/.webhook_secret`
- 🔒 Keep `~/.cloudflared/` credentials secure (tunnel credentials)
- 🔒 Use strong webhook secrets (automatically generated)
- 🔒 Keep GitHub tokens secure

### Regenerating Secrets

If you suspect a secret was compromised:

1. **Webhook secret:**
   ```bash
   # Generate new secret
   openssl rand -hex 32 > ~/darth-forge/.cicd/.webhook_secret

   # Update GitHub webhook with new secret
   # Restart webhook listener
   ```

2. **Cloudflare Tunnel:**
   ```bash
   # Delete and recreate tunnel
   cloudflared tunnel delete darth-forge
   cd ~/darth-forge
   ./.cloudflare/setup-cloudflare-tunnel.sh
   ```

## Backup & Recovery

### What to Backup

1. **Webhook secret:** `.cicd/.webhook_secret`
2. **Environment config:** `.env.prod` (if you created one)
3. **Cloudflare tunnel credentials:** `~/.cloudflared/`
4. **Database data** (when you add PostgreSQL)

### Recovery

If your Pi crashes or you need to redeploy:

1. **Clone repo:**
   ```bash
   git clone git@github.com:yourusername/darth-forge.git
   cd darth-forge
   ```

2. **Restore secrets:**
   ```bash
   # Restore webhook secret
   echo "your-secret-here" > .cicd/.webhook_secret
   ```

3. **Setup Cloudflare Tunnel:**
   ```bash
   ./.cloudflare/setup-cloudflare-tunnel.sh
   ```

4. **Start services:**
   ```bash
   podman-compose -f compose.yaml -f compose.prod.yaml up -d
   python3 .cicd/webhook-listener.py &
   ```

## Performance Optimization

### Current Setup
- Frontend: Caddy with gzip compression
- Backend: Go compiled binary (minimal overhead)
- Containers: Alpine Linux base (small footprint)

### Future Improvements
- Add Redis for caching
- Enable Cloudflare caching for static assets
- Add CDN for assets
- Implement rate limiting

## Scaling

### Current Limitations
- Single Raspberry Pi (no redundancy)
- Single process webhook listener
- No load balancing

### Future Scaling Options
1. **Multiple Pis:** Use Cloudflare Load Balancing
2. **Database:** Add PostgreSQL container
3. **Monitoring:** Add Prometheus + Grafana
4. **Backups:** Automated database backups

## Cost Analysis

| Service | Cost | Notes |
|---------|------|-------|
| Cloudflare Tunnel | $0/month | Free tier |
| DNS Hosting | $0/month | Cloudflare |
| DDoS Protection | $0/month | Cloudflare |
| SSL Certificates | $0/month | Cloudflare |
| Domain | ~$10/year | One-time cost |
| Raspberry Pi | $0/month | Already owned |
| **Total** | **$0/month** | Just domain renewal annually |

## References

- [Cloudflare Tunnel Docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [GitHub Webhooks](https://docs.github.com/en/webhooks)
- [Podman Documentation](https://docs.podman.io/)
- [Caddy Server](https://caddyserver.com/docs/)

## Support

For issues or questions:
1. Check the troubleshooting section above
2. View logs for specific error messages
3. Check GitHub webhook delivery status
4. Review Cloudflare Tunnel status

## License

See LICENSE file in repository root.
