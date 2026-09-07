#!/usr/bin/env bash
#
# One-time bootstrap for a fresh Debian/Ubuntu VPS.
#
#   ssh root@<ip>
#   curl -fsSL https://raw.githubusercontent.com/pxs4528/darth-forge/main/scripts/setup-vps.sh | bash -s -- <username>
#
# or copy it over and run:  bash setup-vps.sh <username>
#
# Installs Docker, creates a non-root deploy user, locks down SSH and the
# firewall, and lays out the deploy directory. It does NOT start the stack —
# you still need .env.vps and DNS pointing here first. See
# docs/migration-vps.md.

set -euo pipefail

DEPLOY_USER="${1:-deploy}"
DEPLOY_DIR="/home/${DEPLOY_USER}/darth-forge"

if [[ $EUID -ne 0 ]]; then
	echo "Run as root: sudo bash $0 ${DEPLOY_USER}" >&2
	exit 1
fi

echo "==> Updating packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl gnupg ufw fail2ban unattended-upgrades

echo "==> Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
	install -m 0755 -d /etc/apt/keyrings
	curl -fsSL https://download.docker.com/linux/debian/gpg |
		gpg --dearmor -o /etc/apt/keyrings/docker.gpg
	chmod a+r /etc/apt/keyrings/docker.gpg
	# shellcheck disable=SC1091
	. /etc/os-release
	echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
		>/etc/apt/sources.list.d/docker.list
	apt-get update -qq
	apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
		docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Creating deploy user '${DEPLOY_USER}'"
if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
	adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
usermod -aG docker "${DEPLOY_USER}"

# Carry root's authorised keys across so you don't lock yourself out when
# root login is disabled below.
if [[ -f /root/.ssh/authorized_keys ]]; then
	install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
	install -m 600 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" \
		/root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
fi

echo "==> Firewall"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp comment 'HTTP - ACME challenge and redirect'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

echo "==> Hardening SSH"
SSHD_DROPIN=/etc/ssh/sshd_config.d/99-darth-forge.conf
mkdir -p /etc/ssh/sshd_config.d
cat >"${SSHD_DROPIN}" <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
# Only apply if a key is actually installed, otherwise this locks you out.
if [[ -s "/home/${DEPLOY_USER}/.ssh/authorized_keys" ]]; then
	systemctl reload ssh 2>/dev/null || systemctl reload sshd
	echo "    root login and passwords disabled"
else
	rm -f "${SSHD_DROPIN}"
	echo "    !! no authorized_keys for ${DEPLOY_USER} — SSH left as-is."
	echo "       Install your key, then re-run this script."
fi

echo "==> Unattended security upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
systemctl enable --now fail2ban

echo "==> Deploy directory"
install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_DIR}"
# The infosec container mounts this read-only; it must exist or the container
# fails to start.
install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_DIR}/infosec-data"

cat <<EOF

Done. Next:

  1. From your laptop, copy the deploy files up:
       scp compose.vps.yaml ${DEPLOY_USER}@<ip>:${DEPLOY_DIR}/
       scp scripts/deploy-vps.sh ${DEPLOY_USER}@<ip>:${DEPLOY_DIR}/
       scp .env.vps            ${DEPLOY_USER}@<ip>:${DEPLOY_DIR}/

  2. Point both hostnames at this machine and wait for DNS to propagate.

  3. ssh ${DEPLOY_USER}@<ip> and run:
       cd ${DEPLOY_DIR} && bash deploy-vps.sh

If the GHCR packages are private, log in once first:
  echo <PAT-with-read:packages> | docker login ghcr.io -u pxs4528 --password-stdin
EOF
