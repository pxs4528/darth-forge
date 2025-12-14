# Cloudflare Tunnel - Quick Reference

## Setup (One-time)

```bash
# Run the automated setup
./.cloudflare/setup-cloudflare-tunnel.sh
```

## Service Management

```bash
# Start tunnel
sudo systemctl start cloudflared

# Stop tunnel
sudo systemctl stop cloudflared

# Restart tunnel
sudo systemctl restart cloudflared

# Enable auto-start on boot
sudo systemctl enable cloudflared

# Disable auto-start
sudo systemctl disable cloudflared

# Check status
sudo systemctl status cloudflared
```

## Logs & Monitoring

```bash
# View live logs
sudo journalctl -u cloudflared -f

# View recent logs
sudo journalctl -u cloudflared -n 100

# View logs from today
sudo journalctl -u cloudflared --since today

# Check log files
tail -f /var/log/cloudflared/*.log
```

## Tunnel Management

```bash
# List all tunnels
cloudflared tunnel list

# Check DNS routes
cloudflared tunnel route dns list

# Validate configuration
cloudflared tunnel --config ~/.cloudflared/config.yml ingress validate

# Test tunnel manually (without systemd)
cloudflared tunnel --config ~/.cloudflared/config.yml run

# View tunnel info
cloudflared tunnel info darth-forge
```

## Testing

```bash
# Test web app (locally)
curl http://localhost:80

# Test webhook (locally)
curl http://localhost:9000/health

# Test web app (via Cloudflare)
curl https://yourdomain.com

# Test webhook (via Cloudflare)
curl https://webhook.yourdomain.com/health
```

## GitHub Webhook URL

Update to:
```
https://webhook.yourdomain.com/webhook
```

Keep your existing webhook secret unchanged.

## Metrics

View Prometheus metrics:
```bash
curl http://localhost:9001/metrics
```

## Configuration Files

- Main config: `~/.cloudflared/config.yml`
- Credentials: `~/.cloudflared/<tunnel-id>.json`
- Service: `/etc/systemd/system/cloudflared.service`
- Logs: `/var/log/cloudflared/`

## Troubleshooting

**Tunnel not working?**
```bash
# 1. Check service status
sudo systemctl status cloudflared

# 2. View logs
sudo journalctl -u cloudflared -f

# 3. Test locally first
curl http://localhost:80
curl http://localhost:9000/health

# 4. Restart tunnel
sudo systemctl restart cloudflared
```

**502 Bad Gateway?**
```bash
# Check if containers are running
podman ps

# Restart containers
podman-compose -f compose.yaml -f compose.prod.yaml restart
```

**DNS not resolving?**
```bash
# Check DNS routes
cloudflared tunnel route dns list

# Re-add if needed
cloudflared tunnel route dns darth-forge yourdomain.com
cloudflared tunnel route dns darth-forge webhook.yourdomain.com
```
