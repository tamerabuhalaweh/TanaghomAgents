#!/bin/bash
# Allocate the 8 GiB swapfile that the 8 GB production host needs before Postiz,
# PostgreSQL, RustFS, the dashboard and the workspace worker run together.
#
# Idempotent and read-only when swap is already active. Run it as root on the
# host (13.60.253.82); it is not executed by CI.
set -euo pipefail

if [ "$(id -u)" != "0" ]; then
  echo "SWAP_HARDENING_REFUSED: run as root" >&2
  exit 1
fi

if swapon --show | grep -q '^/swapfile'; then
  echo "SWAP_ALREADY_ACTIVE"
  free -h
  swapon --show
  exit 0
fi

if [ ! -f /swapfile ]; then
  fallocate -l 8G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=8192 status=none
fi
chmod 600 /swapfile
mkswap /swapfile >/dev/null
swapon /swapfile

grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
printf 'vm.swappiness=10\nvm.vfs_cache_pressure=50\n' > /etc/sysctl.d/99-tanaghom-swap.conf
sysctl -q -p /etc/sysctl.d/99-tanaghom-swap.conf

echo "SWAP_ENABLED"
free -h
swapon --show
