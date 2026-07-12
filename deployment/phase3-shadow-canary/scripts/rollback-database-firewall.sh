#!/bin/sh
set -eu

EGRESS_CHAIN=TANAGHOM_N8N_DB_EGRESS
INPUT_CHAIN=TANAGHOM_N8N_DB_INPUT
while iptables -C INPUT -j "$INPUT_CHAIN" >/dev/null 2>&1; do
  iptables -D INPUT -j "$INPUT_CHAIN"
done
while iptables -C DOCKER-USER -j "$EGRESS_CHAIN" >/dev/null 2>&1; do
  iptables -D DOCKER-USER -j "$EGRESS_CHAIN"
done
if iptables -nL "$INPUT_CHAIN" >/dev/null 2>&1; then
  iptables -F "$INPUT_CHAIN"
  iptables -X "$INPUT_CHAIN"
fi
if iptables -nL "$EGRESS_CHAIN" >/dev/null 2>&1; then
  iptables -F "$EGRESS_CHAIN"
  iptables -X "$EGRESS_CHAIN"
fi
echo "Tanaghom n8n database-egress firewall rules removed."
