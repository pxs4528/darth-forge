#!/bin/bash
set -e

# Cloudflare Tunnel Setup Script for darth-forge
# This script installs cloudflared and sets up the tunnel configuration

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Cloudflare Tunnel Setup for darth-forge${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}Error: Do not run this script as root${NC}"
    echo "Run it as your regular user (darth). Sudo will be used when needed."
    exit 1
fi

# Step 1: Install cloudflared
echo -e "${GREEN}Step 1: Installing cloudflared${NC}"
if command -v cloudflared &> /dev/null; then
    echo -e "${YELLOW}cloudflared is already installed$(cloudflared --version)${NC}"
else
    echo "Downloading cloudflared for ARM64..."
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /tmp/cloudflared

    echo "Installing to /usr/local/bin/cloudflared..."
    sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
    sudo chmod +x /usr/local/bin/cloudflared

    echo -e "${GREEN}✓ cloudflared installed successfully${NC}"
    cloudflared --version
fi

# Step 2: Authenticate with Cloudflare
echo -e "\n${GREEN}Step 2: Authenticate with Cloudflare${NC}"
echo "This will open a browser window for you to log in to Cloudflare."
echo "After logging in, the credentials will be saved to ~/.cloudflared/cert.pem"
read -p "Press Enter to continue..."

cloudflared tunnel login

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
    echo -e "${RED}Error: Authentication failed. cert.pem not found.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Authentication successful${NC}"

# Step 3: Get domain name from user
echo -e "\n${GREEN}Step 3: Configure your domain${NC}"
read -p "Enter your domain name (e.g., darth-forge.com): " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Error: Domain name cannot be empty${NC}"
    exit 1
fi

echo "You entered: $DOMAIN"
echo "This will create two subdomains:"
echo "  - $DOMAIN (main web app)"
echo "  - webhook.$DOMAIN (GitHub webhook listener)"
read -p "Is this correct? (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ]; then
    echo "Setup cancelled."
    exit 1
fi

# Step 4: Create tunnel
echo -e "\n${GREEN}Step 4: Creating Cloudflare Tunnel${NC}"
TUNNEL_NAME="darth-forge"

# Check if tunnel already exists
if cloudflared tunnel list | grep -q "$TUNNEL_NAME"; then
    echo -e "${YELLOW}Tunnel '$TUNNEL_NAME' already exists. Using existing tunnel.${NC}"
    TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
else
    echo "Creating new tunnel: $TUNNEL_NAME"
    cloudflared tunnel create $TUNNEL_NAME
    TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
fi

echo -e "${GREEN}✓ Tunnel ID: $TUNNEL_ID${NC}"

# Step 5: Configure DNS routing
echo -e "\n${GREEN}Step 5: Configuring DNS routes${NC}"
echo "Setting up DNS for $DOMAIN..."
cloudflared tunnel route dns $TUNNEL_NAME $DOMAIN 2>/dev/null || echo "DNS route for $DOMAIN may already exist"

echo "Setting up DNS for webhook.$DOMAIN..."
cloudflared tunnel route dns $TUNNEL_NAME webhook.$DOMAIN 2>/dev/null || echo "DNS route for webhook.$DOMAIN may already exist"

echo -e "${GREEN}✓ DNS routes configured${NC}"

# Step 6: Create configuration file
echo -e "\n${GREEN}Step 6: Creating tunnel configuration${NC}"
CREDENTIALS_FILE="$HOME/.cloudflared/$TUNNEL_ID.json"
CONFIG_FILE="$HOME/.cloudflared/config.yml"

# Create .cloudflared directory if it doesn't exist
mkdir -p $HOME/.cloudflared

# Create config from template
cat > $CONFIG_FILE << EOF
# Cloudflare Tunnel Configuration for darth-forge
# Auto-generated on $(date)

tunnel: $TUNNEL_ID
credentials-file: $CREDENTIALS_FILE

# Ingress rules
ingress:
  # Main web application (SolidJS + Go backend)
  - hostname: $DOMAIN
    service: http://localhost:80
    originRequest:
      noTLSVerify: false
      connectTimeout: 30s

  # GitHub webhook listener
  - hostname: webhook.$DOMAIN
    service: http://localhost:9000
    originRequest:
      noTLSVerify: false
      connectTimeout: 30s

  # Catch-all rule (required)
  - service: http_status:404

# Logging
logDirectory: /var/log/cloudflared
loglevel: info

# Metrics (accessible at localhost:9001/metrics)
metrics: localhost:9001
EOF

echo -e "${GREEN}✓ Configuration created at $CONFIG_FILE${NC}"

# Step 7: Create log directory
echo -e "\n${GREEN}Step 7: Setting up logging${NC}"
sudo mkdir -p /var/log/cloudflared
sudo chown $USER:$USER /var/log/cloudflared

echo -e "${GREEN}✓ Log directory created${NC}"

# Step 8: Install systemd service
echo -e "\n${GREEN}Step 8: Installing systemd service${NC}"
sudo cp .cloudflare/cloudflared.service /etc/systemd/system/cloudflared.service
sudo systemctl daemon-reload

echo -e "${GREEN}✓ Systemd service installed${NC}"

# Step 9: Test configuration
echo -e "\n${GREEN}Step 9: Testing configuration${NC}"
echo "Running configuration validation..."
cloudflared tunnel --config $CONFIG_FILE ingress validate

echo -e "${GREEN}✓ Configuration is valid${NC}"

# Summary
echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Setup Complete!${NC}"
echo -e "${BLUE}========================================${NC}\n"

echo -e "${GREEN}Your Cloudflare Tunnel is configured:${NC}"
echo "  Tunnel Name: $TUNNEL_NAME"
echo "  Tunnel ID: $TUNNEL_ID"
echo "  Main App: https://$DOMAIN"
echo "  Webhook: https://webhook.$DOMAIN"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Start the tunnel:"
echo "     ${GREEN}sudo systemctl start cloudflared${NC}"
echo ""
echo "  2. Enable auto-start on boot:"
echo "     ${GREEN}sudo systemctl enable cloudflared${NC}"
echo ""
echo "  3. Check tunnel status:"
echo "     ${GREEN}sudo systemctl status cloudflared${NC}"
echo ""
echo "  4. View logs:"
echo "     ${GREEN}sudo journalctl -u cloudflared -f${NC}"
echo ""
echo "  5. Update GitHub webhook URL to:"
echo "     ${GREEN}https://webhook.$DOMAIN/webhook${NC}"
echo ""
echo -e "${YELLOW}Configuration file:${NC} $CONFIG_FILE"
echo -e "${YELLOW}Credentials file:${NC} $CREDENTIALS_FILE"
echo ""
echo "To start using the tunnel now, run:"
echo "  ${GREEN}sudo systemctl start cloudflared${NC}"
