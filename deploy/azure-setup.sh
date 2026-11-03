#!/usr/bin/env bash
# Mini CTF Arena - one-time setup of a fresh Ubuntu 22.04 / 24.04 Azure VM (task P3-09).
#
# What it does. Safe to run again: every step checks before it changes anything.
#   1. apt update + base packages (ca-certificates, curl, git, ufw)
#   2. installs Docker Engine and the Compose plugin from Docker's official apt repository
#   3. adds the deploy user to the "docker" group
#   4. creates a 2 GB swapfile if the VM has no swap
#   5. enables the ufw firewall for SSH (22), HTTP (80), HTTPS (443) and challenge ports 30000-30100
#   6. prints the docker group id to put in .env as DOCKER_GID
#
# It contains no secrets and never reads or writes .env. Run it as your normal login user (it uses sudo):
#   bash deploy/azure-setup.sh
# Optional overrides: DEPLOY_USER=<user> SWAP_MB=2048 CHALLENGE_PORTS=30000:30100
#
# Note on ufw: Docker publishes container ports with its own iptables rules, which bypass ufw.
# So ufw only protects non-Docker services (such as sshd). The Azure network security group (NSG) is
# the real perimeter. Never publish MongoDB, the backend port or the Docker API to the host.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-$(id -un)}}"
SWAP_MB="${SWAP_MB:-2048}"
CHALLENGE_PORTS="${CHALLENGE_PORTS:-30000:30100}"

log() { printf '\n==> %s\n' "$*"; }
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

# --- 0. sanity checks ----------------------------------------------------------------------
# shellcheck disable=SC1091
. /etc/os-release
if [ "${ID:-}" != "ubuntu" ]; then
  echo "This script is written for Ubuntu. Found: ${PRETTY_NAME:-unknown}. Stopping." >&2
  exit 1
fi
case "${VERSION_ID:-}" in
  22.04|24.04) ;;
  *) echo "Warning: tested on Ubuntu 22.04 and 24.04, found ${VERSION_ID:-unknown}. Continuing." >&2 ;;
esac
if [ "$DEPLOY_USER" = "root" ]; then
  echo "Run this as your normal login user (for example azureuser), not as root, or set DEPLOY_USER." >&2
  exit 1
fi
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "User '$DEPLOY_USER' does not exist." >&2
  exit 1
fi

# --- 1. base packages ----------------------------------------------------------------------
log "Updating apt and installing base packages"
as_root apt-get update -y
as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git ufw

# --- 2. Docker Engine + Compose plugin ------------------------------------------------------
log "Installing Docker Engine and the Compose plugin"
as_root install -m 0755 -d /etc/apt/keyrings
if [ ! -s /etc/apt/keyrings/docker.asc ]; then
  as_root curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  as_root chmod a+r /etc/apt/keyrings/docker.asc
fi
arch="$(dpkg --print-architecture)"
codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$arch" "$codename" | as_root tee /etc/apt/sources.list.d/docker.list >/dev/null
as_root apt-get update -y
as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
as_root systemctl enable --now docker

# --- 3. docker group ------------------------------------------------------------------------
log "Allowing '$DEPLOY_USER' to run docker without sudo"
user_groups="$(id -nG "$DEPLOY_USER")"
case " $user_groups " in
  *" docker "*) echo "Already in the docker group." ;;
  *) as_root usermod -aG docker "$DEPLOY_USER"; echo "Added. Log out and back in for it to take effect." ;;
esac

# --- 4. swap --------------------------------------------------------------------------------
log "Checking swap"
if [ -n "$(swapon --show --noheadings)" ]; then
  echo "Swap already active:"
  swapon --show
else
  if [ ! -f /swapfile ]; then
    echo "Creating a ${SWAP_MB} MB swapfile at /swapfile"
    as_root fallocate -l "${SWAP_MB}M" /swapfile || as_root dd if=/dev/zero of=/swapfile bs=1M count="$SWAP_MB" status=none
    as_root chmod 600 /swapfile
    as_root mkswap /swapfile >/dev/null
  fi
  as_root swapon /swapfile
  echo "Swap enabled."
fi
if ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' | as_root tee -a /etc/fstab >/dev/null
fi

# --- 5. firewall ----------------------------------------------------------------------------
log "Configuring ufw (SSH 22, HTTP 80, HTTPS 443, challenges ${CHALLENGE_PORTS})"
as_root ufw default deny incoming
as_root ufw default allow outgoing
# SSH first, so enabling the firewall can never lock us out of this session.
as_root ufw allow 22/tcp comment 'SSH'
as_root ufw allow 80/tcp comment 'HTTP'
as_root ufw allow 443/tcp comment 'HTTPS (optional)'
as_root ufw allow "${CHALLENGE_PORTS}/tcp" comment 'CTF challenge instances'
as_root ufw --force enable
as_root ufw status verbose

# --- 6. summary -----------------------------------------------------------------------------
log "Done"
docker_gid="$(getent group docker | cut -d: -f3)"
public_ip="$(curl -fsS --max-time 3 -H 'Metadata:true' \
  'http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2021-02-01&format=text' 2>/dev/null || true)"
as_root docker --version
as_root docker compose version
printf '\nPut these in the .env file in the repository root:\n'
printf '  DOCKER_GID=%s\n' "$docker_gid"
if [ -n "$public_ip" ]; then
  printf '  PUBLIC_HOST=%s      (or the DNS name of the public IP)\n' "$public_ip"
  printf 'Add %s to MongoDB Atlas > Network Access.\n' "$public_ip"
fi
printf '\nNext: log out and back in (docker group), then follow docs/AZURE_SETUP.md from step 6.\n'
