#!/usr/bin/env bash
#
# Pull the latest images and restart the stack. Run from the deploy directory
# on the VPS:
#
#   cd ~/darth-forge && bash deploy-vps.sh
#
# Safe to re-run. Nothing is built here — CI publishes the images to GHCR.

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="compose.vps.yaml"
ENV_FILE=".env.vps"

for f in "${COMPOSE_FILE}" "${ENV_FILE}"; do
	if [[ ! -f "$f" ]]; then
		echo "Missing ${f} — see docs/migration-vps.md" >&2
		exit 1
	fi
done

# Caddy fails to obtain certificates if the hostnames don't resolve here yet,
# and the failure is buried in container logs. Check before touching anything.
SITE_DOMAIN=$(grep -E '^SITE_DOMAIN=' "${ENV_FILE}" | cut -d= -f2-)
BUDGET_DOMAIN=$(grep -E '^BUDGET_DOMAIN=' "${ENV_FILE}" | cut -d= -f2-)
TAILSCALE_IP=$(grep -E '^TAILSCALE_IP=' "${ENV_FILE}" | cut -d= -f2-)
PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org || echo "")

# Portfolio (public) should resolve to public IP
resolved=$(getent hosts "${SITE_DOMAIN}" | awk '{print $1}' | head -1 || true)
if [[ -z "${resolved}" ]]; then
	echo "!! ${SITE_DOMAIN} does not resolve yet — Caddy will fail to get a certificate."
elif [[ -n "${PUBLIC_IP}" && "${resolved}" != "${PUBLIC_IP}" ]]; then
	echo "!! ${SITE_DOMAIN} resolves to ${resolved}, not this host (${PUBLIC_IP})."
	echo "   If it's proxied through Cloudflare, turn the proxy off until the"
	echo "   first certificate is issued."
fi

# Budget (Tailscale) should resolve to Tailscale IP (or public IP temporarily)
resolved=$(getent hosts "${BUDGET_DOMAIN}" | awk '{print $1}' | head -1 || true)
if [[ -z "${resolved}" ]]; then
	echo "!! ${BUDGET_DOMAIN} does not resolve yet — Caddy will fail to get a certificate."
elif [[ -n "${TAILSCALE_IP}" && "${resolved}" != "${TAILSCALE_IP}" && -n "${PUBLIC_IP}" && "${resolved}" != "${PUBLIC_IP}" ]]; then
	echo "⚠ ${BUDGET_DOMAIN} resolves to ${resolved}, expected ${TAILSCALE_IP} (or ${PUBLIC_IP} temporarily)"
fi

echo "==> Pulling images"
docker compose -f "${COMPOSE_FILE}" pull

echo "==> Starting"
docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans

echo "==> Pruning old images"
docker image prune -f >/dev/null

echo "==> Status"
docker compose -f "${COMPOSE_FILE}" ps

cat <<EOF

Watch certificate issuance (first boot only, ~30s):
  docker compose -f ${COMPOSE_FILE} logs -f frontend

Health check:
  curl -sS https://${SITE_DOMAIN}/api/health
EOF
