#!/bin/sh
set -eu

OLD_CHAIN=TANAGHOM_N8N_DB_EGRESS
NEW_CHAIN=TANAGHOM_N8N_GATEWAY_EGRESS

test "${TANAGHOM_FIREWALL_CHANGE_AUTHORIZED:-}" = "YES-I-AM-THE-AUTHORIZED-OWNER" || {
  echo "Refusing: explicit infrastructure-owner authorization is absent." >&2
  exit 64
}
test "$(id -u)" -eq 0
iptables -nL "$OLD_CHAIN" >/dev/null 2>&1
iptables -nL "$NEW_CHAIN" >/dev/null 2>&1
test "$(iptables -S DOCKER-USER | grep -Fxc -- "-A DOCKER-USER -j $NEW_CHAIN")" -eq 1
! iptables -S DOCKER-USER | grep -F -- "-j $OLD_CHAIN" >/dev/null

iptables -I DOCKER-USER 1 -j "$OLD_CHAIN"
iptables -D DOCKER-USER -j "$NEW_CHAIN"
iptables -F "$NEW_CHAIN"
iptables -X "$NEW_CHAIN"
test "$(iptables -S DOCKER-USER | grep -Fxc -- "-A DOCKER-USER -j $OLD_CHAIN")" -eq 1
echo "Tanaghom Postiz gateway firewall update rolled back."
