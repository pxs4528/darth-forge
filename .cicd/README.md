# CI/CD Setup for darth-forge

This directory contains the CI/CD pipeline for auto-deploying your webapp to the Raspberry Pi.

## How it works

1. You push code to GitHub (main branch)
2. GitHub Actions workflow triggers
3. GitHub sends a webhook to your Raspberry Pi
4. Webhook listener receives the event
5. Deployment script pulls latest code and rebuilds containers
6. Your webapp is automatically updated!

## Files

- `webhook-listener.py` - Python HTTP server that listens for GitHub webhooks
- `deploy.sh` - Deployment script that pulls code and rebuilds containers
- `webhook.service` - Systemd service file for the webhook listener
- `setup.sh` - Setup script to configure everything
- `webhook.log` - Webhook listener logs
- `deploy.log` - Deployment logs
- `.webhook_secret` - Secret key for webhook authentication (auto-generated)

## Quick Start

1. Run the setup script:
   ```bash
   cd /home/darth/darth-forge/.cicd
   ./setup.sh
   ```

2. Get your public IP:
   ```bash
   curl -4 ifconfig.me
   ```

3. Configure port forwarding on your router:
   - Forward external port 9000 to this Pi's port 9000

4. Add secrets to GitHub:
   - Go to your repo: Settings → Secrets and variables → Actions
   - Add `WEBHOOK_URL`: `http://YOUR_PUBLIC_IP:9000/webhook`
   - Add `WEBHOOK_SECRET`: (from setup script output)

5. Start the webhook listener:
   ```bash
   sudo systemctl start webhook-darth-forge
   sudo systemctl enable webhook-darth-forge
   ```

6. Test by pushing to GitHub!

## Monitoring

Check webhook listener status:
```bash
sudo systemctl status webhook-darth-forge
```

View webhook logs:
```bash
tail -f /home/darth/darth-forge/.cicd/webhook.log
```

View deployment logs:
```bash
tail -f /home/darth/darth-forge/.cicd/deploy.log
```

Test webhook manually:
```bash
curl http://localhost:9000/health
```

## Troubleshooting

### Webhook not receiving events
- Check if port 9000 is forwarded on your router
- Verify your public IP hasn't changed
- Check firewall settings: `sudo ufw status`
- Test from outside network: `curl http://YOUR_PUBLIC_IP:9000/health`

### Deployment failing
- Check deploy logs: `tail -f .cicd/deploy.log`
- Ensure git credentials are configured
- Verify Podman is working: `podman ps`

### Service won't start
- Check logs: `sudo journalctl -u webhook-darth-forge -f`
- Verify Python3 is installed: `python3 --version`
- Check file permissions: `ls -la /home/darth/darth-forge/.cicd/`

## Security Notes

- The webhook secret is stored in `.webhook_secret` (600 permissions)
- This file is gitignored automatically
- GitHub sends signed requests using HMAC-SHA256
- The webhook listener verifies signatures before deploying
- Consider using a reverse proxy (Caddy/nginx) for HTTPS in production
