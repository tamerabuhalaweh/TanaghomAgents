#!/bin/sh
set -eu

CHAIN=TANAGHOM_N8N_DB_EGRESS
while iptables -C DOCKER-USER -j "$CHAIN" >/dev/null 2>&1; do
  iptables -D DOCKER-USER -j "$CHAIN"
done
if iptables -nL "$CHAIN" >/dev/null 2>&1; then
  iptables -F "$CHAIN"
  iptables -X "$CHAIN"
fi
echo "Tanaghom n8n database-egress firewall rules removed."
