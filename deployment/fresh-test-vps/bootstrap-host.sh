#!/bin/bash
set -euo pipefail
test "$(id -u)" = 0
test "$(hostname)" = vps-khal-tanaghom
test "$(dpkg --print-architecture)" = amd64
. /etc/os-release
test "$ID:$VERSION_ID" = ubuntu:24.04
if command -v docker >/dev/null; then
  echo 'Docker already exists; refuse first-install bootstrap.' >&2
  exit 1
fi
test ! -e /opt/tanaghom-test
test "$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 30
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl git
install -d -m 0755 /etc/apt/keyrings
curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod 0644 /etc/apt/keyrings/docker.asc
install -m 0644 /home/administrator/tanaghom-bootstrap/docker.sources /etc/apt/sources.list.d/docker.sources
apt-get update -qq
apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
install -d -m 0755 /opt/tanaghom-test
systemctl enable --now docker
docker version --format '{{.Server.Version}}'
docker compose version
df -h /
echo 'HOST_BOOTSTRAP_COMPLETE'
