#!/bin/bash
# Cleanup script to remove podman after migrating to Docker
# Run this AFTER verifying Docker deployment works!

set -e

echo "========================================="
echo "Podman Cleanup Script"
echo "========================================="
echo ""
echo "⚠️  WARNING: This will remove all podman containers and images!"
echo "Make sure Docker is working before running this."
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Cleanup cancelled."
    exit 0
fi

echo ""
echo "[1/5] Stopping all podman containers..."
podman stop -a 2>/dev/null || true

echo "[2/5] Removing all podman containers..."
podman rm -a 2>/dev/null || true

echo "[3/5] Removing all podman images..."
podman rmi -a -f 2>/dev/null || true

echo "[4/5] Cleaning up podman networks..."
podman network prune -f 2>/dev/null || true

echo "[5/5] Removing podman user data..."
rm -rf ~/.local/share/containers 2>/dev/null || true
rm -rf ~/.config/containers 2>/dev/null || true

echo ""
echo "✅ Podman cleanup complete!"
echo ""
echo "Optional: Uninstall podman completely"
echo "Run: sudo apt-get remove -y podman podman-compose"
echo ""
