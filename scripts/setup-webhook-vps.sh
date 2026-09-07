#!/usr/bin/env bash
#
# Set up GitHub webhook listener on the VPS.
#
# Run as deploy user:
#   bash scripts/setup-webhook-vps.sh <webhook-secret>
#
# Or with a pre-generated secret (32 hex chars):
#   bash scripts/setup-webhook-vps.sh
#

set -euo pipefail

WEBHOOK_SECRET="${1:-$(openssl rand -hex 32)}"
WEBHOOK_SECRET_FILE="/home/deploy/darth-forge/.webhook_secret"
WEBHOOK_LISTENER_URL="https://raw.githubusercontent.com/pxs4528/darth-forge/main/.cicd/webhook-listener.py"
LISTENER_PATH="/home/deploy/darth-forge/webhook-listener.py"
SERVICE_FILE="/etc/systemd/system/webhook-vps.service"
SERVICE_SOURCE="./scripts/webhook-vps.service"

if [[ $EUID -ne 0 ]]; then
	echo "Run as root: sudo bash $0" >&2
	exit 1
fi

echo "==> Setting up GitHub webhook listener on VPS"

# Copy webhook listener if not present
if [[ ! -f "${LISTENER_PATH}" ]]; then
	echo "==> Fetching webhook listener"
	curl -fsSL "${WEBHOOK_LISTENER_URL}" -o "${LISTENER_PATH}"
	chmod 755 "${LISTENER_PATH}"
	chown deploy:deploy "${LISTENER_PATH}"
fi

# Store webhook secret
echo "==> Storing webhook secret"
echo -n "${WEBHOOK_SECRET}" > "${WEBHOOK_SECRET_FILE}"
chmod 600 "${WEBHOOK_SECRET_FILE}"
chown deploy:deploy "${WEBHOOK_SECRET_FILE}"

# Copy systemd service
echo "==> Installing systemd service"
if [[ ! -f "${SERVICE_SOURCE}" ]]; then
	echo "!! ${SERVICE_SOURCE} not found" >&2
	exit 1
fi
cp "${SERVICE_SOURCE}" "${SERVICE_FILE}"
chmod 644 "${SERVICE_FILE}"

# Enable and start
echo "==> Enabling and starting webhook service"
systemctl daemon-reload
systemctl enable webhook-vps.service
systemctl restart webhook-vps.service

# Wait for it to start
sleep 2

# Verify
echo "==> Verifying webhook listener"
if systemctl is-active --quiet webhook-vps.service; then
	echo "✓ Webhook service is running"
else
	echo "!! Webhook service failed to start — check logs:"
	journalctl -u webhook-vps.service -n 10
	exit 1
fi

# Health check
if curl -fsS http://localhost:9000/health >/dev/null; then
	echo "✓ Webhook listener is responding"
else
	echo "!! Webhook listener health check failed"
	exit 1
fi

cat <<EOF

✓ Webhook listener installed and running on port 9000

Next steps:

1. Update GitHub repository secrets:
   - WEBHOOK_URL_VPS: https://<your-vps-ip>:9000/webhook
   - WEBHOOK_SECRET_VPS: ${WEBHOOK_SECRET}

   (Webhook runs on HTTP internally; use your VPS's public IP for the external URL,
    or set up a reverse proxy/firewall to route HTTPS to the internal listener.)

2. Test the webhook:
   curl -H "Content-Type: application/json" \
     -H "X-Hub-Signature-256: sha256=$(echo -n '{}' | openssl dgst -sha256 -hmac '${WEBHOOK_SECRET}' | sed 's/^.* //')" \
     -d '{}' \
     http://localhost:9000/webhook

3. Watch deployment logs:
   tail -f /home/deploy/darth-forge/.webhook.log

4. Troubleshoot:
   systemctl status webhook-vps.service
   journalctl -u webhook-vps.service -f
EOF
