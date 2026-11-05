#!/bin/bash
# Prepares a fresh disposable Ubuntu host for the isolated demo (#243/#254/#259).
# Idempotent. Run as root on a host that is exclusively ours; it installs only
# Docker Engine, the Compose v2 plugin, and the small tool set the demo scripts
# need. It changed neither the kernel settings nor any network/firewall policy.
set -euo pipefail

test "$(id -u)" = 0 || { echo "BOOTSTRAP_REFUSED: run as root" >&2; exit 1; }
. /etc/os-release
test "${ID:-}" = "ubuntu" || { echo "BOOTSTRAP_REFUSED: expected Ubuntu, found ${ID:-unknown}" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg jq openssl python3 sqlite3 >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
    "$(dpkg --print-architecture)" "${VERSION_CODENAME}" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi

systemctl enable --now docker >/dev/null 2>&1 || true
if id ubuntu >/dev/null 2>&1; then usermod -aG docker ubuntu; fi

docker --version
docker compose version
echo "BOOTSTRAP_READY"
