#!/bin/bash
# Setup script for CI/CD webhook listener

set -e

CICD_DIR="/home/darth/darth-forge/.cicd"
SERVICE_FILE="$CICD_DIR/webhook.service"
SYSTEMD_SERVICE="/etc/systemd/system/webhook-darth-forge.service"

echo "=========================================="
echo "Setting up CI/CD webhook listener"
echo "=========================================="
echo ""

# Generate webhook secret if not exists
if [ -f "$CICD_DIR/.webhook_secret" ]; then
    WEBHOOK_SECRET=$(cat "$CICD_DIR/.webhook_secret")
    echo "Using existing webhook secret"
else
    echo "Generating new webhook secret..."
    WEBHOOK_SECRET=$(openssl rand -hex 32)
    echo "$WEBHOOK_SECRET" > "$CICD_DIR/.webhook_secret"
    chmod 600 "$CICD_DIR/.webhook_secret"
    echo "✓ Webhook secret generated and saved to $CICD_DIR/.webhook_secret"
fi

# Update service file with the secret
echo ""
echo "Updating systemd service file..."
sed -i "s/WEBHOOK_SECRET=changeme/WEBHOOK_SECRET=$WEBHOOK_SECRET/" "$SERVICE_FILE"

# Copy service file to systemd directory
echo "Installing systemd service..."
sudo cp "$SERVICE_FILE" "$SYSTEMD_SERVICE"
sudo systemctl daemon-reload

echo ""
echo "=========================================="
echo "Setup complete!"
echo "=========================================="
echo ""
echo "Your webhook secret: $WEBHOOK_SECRET"
echo ""
echo "Next steps:"
echo "1. Get your public IP address:"
echo "   curl -4 ifconfig.me"
echo ""
echo "2. Configure port forwarding on your router:"
echo "   External Port: 9000 -> Internal IP:9000 (this Pi)"
echo ""
echo "3. Add these secrets to your GitHub repository:"
echo "   Go to: Settings -> Secrets and variables -> Actions"
echo "   - WEBHOOK_URL: http://YOUR_PUBLIC_IP:9000/webhook"
echo "   - WEBHOOK_SECRET: $WEBHOOK_SECRET"
echo ""
echo "4. Start the webhook listener:"
echo "   sudo systemctl start webhook-darth-forge"
echo "   sudo systemctl enable webhook-darth-forge"
echo ""
echo "5. Check webhook status:"
echo "   sudo systemctl status webhook-darth-forge"
echo "   tail -f $CICD_DIR/webhook.log"
echo ""
echo "=========================================="
