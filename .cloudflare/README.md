# Cloudflare Tunnel Setup for darth-forge

This directory contains configuration files and setup scripts for exposing your self-hosted darth-forge application using Cloudflare Tunnel.

## Why Cloudflare Tunnel?

**Security Benefits:**
- ✅ No port forwarding required
- ✅ Hides your home IP address
- ✅ Free DDoS protection from Cloudflare
- ✅ No exposed attack surface on your firewall
- ✅ Automatic HTTPS with Cloudflare's SSL certificates

**Operational Benefits:**
- ✅ Completely free (Cloudflare Free tier)
- ✅ Works behind CGNAT/dynamic IPs
- ✅ No ISP port blocking issues
- ✅ Multiple service routing (web app + webhook)
- ✅ Built-in traffic analytics

## Quick Start

### Prerequisites

1. **Cloudflare Account** - Sign up at https://cloudflare.com (free)
2. **Domain Name** - Add your domain to Cloudflare (free tier works)
3. **Running Services**:
   - Frontend/Backend containers running on port 80
   - Webhook listener running on port 9000

### Installation

Run the automated setup script:

```bash
cd /home/darth/darth-forge
./.cloudflare/setup-cloudflare-tunnel.sh
```

The script will:
1. Download and install `cloudflared` binary
2. Authenticate with your Cloudflare account (opens browser)
3. Prompt for your domain name
4. Create a tunnel named "darth-forge"
5. Configure DNS routes automatically
6. Generate configuration file
7. Install systemd service
8. Validate the configuration

### Starting the Tunnel

```bash
# Start the tunnel
sudo systemctl start cloudflared

# Enable auto-start on boot
sudo systemctl enable cloudflared

# Check status
sudo systemctl status cloudflared

# View live logs
sudo journalctl -u cloudflared -f
```

### Stopping the Tunnel

```bash
# Stop the tunnel
sudo systemctl stop cloudflared

# Disable auto-start
sudo systemctl disable cloudflared
```

## Configuration

### Tunnel Configuration File

Location: `~/.cloudflared/config.yml`

The configuration routes traffic from Cloudflare to your local services:

```yaml
tunnel: <your-tunnel-id>
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  # Main web app (yourdomain.com → localhost:80)
  - hostname: yourdomain.com
    service: http://localhost:80

  # Webhook (webhook.yourdomain.com → localhost:9000)
  - hostname: webhook.yourdomain.com
    service: http://localhost:9000

  # Catch-all (required)
  - service: http_status:404
```

### DNS Routes

After setup, you'll have two DNS entries:
- `yourdomain.com` → Your SolidJS frontend + Go backend
- `webhook.yourdomain.com` → GitHub webhook listener

### Systemd Service

Location: `/etc/systemd/system/cloudflared.service`

The service runs as user `darth` and automatically restarts on failure.

## Updating GitHub Webhook

After the tunnel is running, update your GitHub webhook URL:

1. Go to your GitHub repo → Settings → Webhooks
2. Edit the existing webhook
3. Change the URL from:
   ```
   http://your-home-ip:9000/webhook
   ```
   to:
   ```
   https://webhook.yourdomain.com/webhook
   ```
4. Keep the secret unchanged
5. Save the webhook

Test it by pushing a commit to trigger the CI/CD pipeline.

## Monitoring & Troubleshooting

### Check Tunnel Status

```bash
# Service status
sudo systemctl status cloudflared

# Live logs
sudo journalctl -u cloudflared -f

# List all tunnels
cloudflared tunnel list

# Check DNS routes
cloudflared tunnel route dns list
```

### Metrics Dashboard

Cloudflared exposes Prometheus metrics at `http://localhost:9001/metrics`

### Common Issues

**Tunnel won't start:**
```bash
# Validate configuration
cloudflared tunnel --config ~/.cloudflared/config.yml ingress validate

# Test tunnel manually
cloudflared tunnel --config ~/.cloudflared/config.yml run
```

**DNS not resolving:**
```bash
# Check DNS routes
cloudflared tunnel route dns list

# Add routes manually if needed
cloudflared tunnel route dns darth-forge yourdomain.com
cloudflared tunnel route dns darth-forge webhook.yourdomain.com
```

**502 Bad Gateway:**
- Check if your containers are running: `podman ps`
- Verify services are accessible locally:
  ```bash
  curl http://localhost:80
  curl http://localhost:9000/health
  ```

## Architecture Diagram

```
GitHub Actions
    ↓
    | HTTPS POST (signed webhook)
    ↓
Cloudflare Edge Network (DDoS protection, SSL termination)
    ↓
    | Encrypted tunnel to your Pi
    ↓
cloudflared (localhost tunnel daemon)
    ↓
    ├─→ yourdomain.com → http://localhost:80
    │   └─→ Caddy (frontend container)
    │       ├─ Serves SolidJS static files
    │       └─ Reverse proxy /api/* → backend:8080
    │
    └─→ webhook.yourdomain.com → http://localhost:9000
        └─→ webhook-listener.py (validates & triggers deploy)
```

## Security Considerations

### What's Secure

✅ **No open ports** - Your firewall remains closed
✅ **Encrypted tunnel** - All traffic encrypted between Cloudflare and your Pi
✅ **DDoS protection** - Cloudflare filters malicious traffic
✅ **Webhook signatures** - GitHub HMAC validation still active
✅ **HTTPS enforced** - Cloudflare provides SSL/TLS certificates

### What to Protect

🔒 **Credentials file** - `~/.cloudflared/<tunnel-id>.json` contains tunnel credentials
🔒 **Webhook secret** - `.webhook_secret` still needed for GitHub signature validation
🔒 **Cloudflare API token** - If you use API tokens instead of cert.pem

### Cloudflare Access (Optional)

For additional security, you can enable Cloudflare Access to require authentication before accessing your app:

```bash
# Add authentication to webhook endpoint
cloudflared access <policy-commands>
```

See: https://developers.cloudflare.com/cloudflare-one/

## Cost Analysis

| Component | Cost | Notes |
|-----------|------|-------|
| Cloudflare Tunnel | $0/month | Free tier |
| DNS hosting | $0/month | Included with Cloudflare |
| DDoS protection | $0/month | Basic protection included |
| SSL certificates | $0/month | Automatic via Cloudflare |
| Bandwidth | $0/month | Unlimited on free tier |
| **Total** | **$0/month** | No cost for personal projects |

## Files in This Directory

- `setup-cloudflare-tunnel.sh` - Automated setup script
- `config.template.yml` - Template for tunnel configuration
- `cloudflared.service` - Systemd service file
- `README.md` - This documentation

## Additional Resources

- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [cloudflared GitHub](https://github.com/cloudflare/cloudflared)
- [Cloudflare Zero Trust](https://developers.cloudflare.com/cloudflare-one/)

## Uninstalling

To remove Cloudflare Tunnel:

```bash
# Stop and disable service
sudo systemctl stop cloudflared
sudo systemctl disable cloudflared
sudo rm /etc/systemd/system/cloudflared.service
sudo systemctl daemon-reload

# Delete tunnel
cloudflared tunnel delete darth-forge

# Remove cloudflared binary
sudo rm /usr/local/bin/cloudflared

# Remove configuration
rm -rf ~/.cloudflared

# Remove logs
sudo rm -rf /var/log/cloudflared
```

## Support

If you encounter issues:
1. Check the logs: `sudo journalctl -u cloudflared -f`
2. Validate config: `cloudflared tunnel ingress validate`
3. Test manually: `cloudflared tunnel run`
4. Cloudflare Community: https://community.cloudflare.com/
