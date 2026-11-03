#!/usr/bin/env bash
# ==============================================================================
# Mini CTF Arena - AWS EC2 Provisioning Script
# Task P3-09 (Shubham)
# Target OS: Ubuntu 22.04 LTS / Ubuntu 24.04 LTS
# ==============================================================================

set -euo pipefail

echo "====================================================="
echo "   MINI CTF ARENA - EC2 PRODUCTION ENVIRONMENT SETUP  "
echo "====================================================="

# Check root privileges
if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root (e.g. sudo bash deploy/ec2-setup.sh)"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "[1/6] Updating system packages..."
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg lsb-release ufw htop git

echo "[2/6] Configuring swap space (2GB) for container headroom..."
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "vm.swappiness=10" >> /etc/sysctl.d/99-swap.conf
  sysctl -p /etc/sysctl.d/99-swap.conf
  echo "[+] 2GB swap space enabled."
else
  echo "[*] Swap file already exists."
fi

echo "[3/6] Installing official Docker Engine & Docker Compose plugin..."
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

ARCH=$(dpkg --print-architecture)
CODENAME=$(lsb_release -cs)
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker

# Add standard 'ubuntu' user to docker group if present
if id "ubuntu" &>/dev/null; then
  usermod -aG docker ubuntu
  echo "[+] Added 'ubuntu' user to docker group."
fi

echo "[4/6] Creating Docker networks..."
docker network create ctf-net 2>/dev/null || echo "[*] ctf-net network already exists."
docker network create ctf-challenges 2>/dev/null || echo "[*] ctf-challenges network already exists."

echo "[5/6] Configuring Host Firewall (UFW)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP / Nginx'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 30000:30100/tcp comment 'CTF Challenge Containers'
echo "y" | ufw enable
ufw status verbose

echo "[6/6] Verifying Docker installation..."
docker --version
docker compose version

echo "====================================================="
echo "[+] EC2 setup completed successfully!"
echo ""
echo "AWS Security Group Checklist:"
echo "  1. Inbound Port 22 (SSH)           -> Restricted to team IPs / GitHub Actions CIDR"
echo "  2. Inbound Port 80 (HTTP)          -> 0.0.0.0/0 (Public)"
echo "  3. Inbound Port 443 (HTTPS)        -> 0.0.0.0/0 (Public)"
echo "  4. Inbound Port 30000-30100 (TCP)  -> 0.0.0.0/0 (Challenge instances)"
echo "  5. Allocate & associate an Elastic IP (EIP) with this instance."
echo "====================================================="

