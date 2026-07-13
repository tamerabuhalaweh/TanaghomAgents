#!/bin/sh
set -eu

OLD_CHAIN=TANAGHOM_N8N_DB_EGRESS
NEW_CHAIN=TANAGHOM_N8N_GATEWAY_EGRESS
POOLER_HOST=aws-1-ap-south-1.pooler.supabase.com
SUBNET=172.30.252.0/29
GATEWAY=172.30.252.4/32

test "${TANAGHOM_FIREWALL_CHANGE_AUTHORIZED:-}" = "YES-I-AM-THE-AUTHORIZED-OWNER" || {
  echo "Refusing: explicit infrastructure-owner authorization is absent." >&2
  exit 64
}
test "$(id -u)" -eq 0
iptables -nL DOCKER-USER >/dev/null 2>&1
iptables -nL "$OLD_CHAIN" >/dev/null 2>&1 || { echo "existing package chain is missing" >&2; exit 66; }
test "$(iptables -S DOCKER-USER | grep -Fxc -- "-A DOCKER-USER -j $OLD_CHAIN")" -eq 1 || {
  echo "existing package hook is not singular" >&2; exit 67;
}
if iptables -nL "$NEW_CHAIN" >/dev/null 2>&1 \
   || iptables -S DOCKER-USER | grep -F -- "-j $NEW_CHAIN" >/dev/null; then
  echo "gateway chain or hook already exists" >&2
  exit 68
fi

ips="$(getent ahostsv4 "$POOLER_HOST" | awk '{print $1}' | sort -u)"
test -n "$ips"
for ip in $ips; do
  case "$ip" in
    0.*|10.*|100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*|127.*|169.254.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|192.168.*|22[4-9].*|23[0-9].*|24[0-9].*|25[0-5].*)
      echo "Refusing private/reserved pooler resolution: $ip" >&2; exit 65 ;;
  esac
done

created=0
hooked_new=0
unhooked_old=0
committed=0
rollback_partial() {
  test "$committed" -eq 1 && return 0
  if test "$unhooked_old" -eq 1; then
    iptables -I DOCKER-USER 1 -j "$OLD_CHAIN" 2>/dev/null || true
  fi
  if test "$hooked_new" -eq 1; then
    iptables -D DOCKER-USER -j "$NEW_CHAIN" 2>/dev/null || true
  fi
  if test "$created" -eq 1; then
    iptables -F "$NEW_CHAIN" 2>/dev/null || true
    iptables -X "$NEW_CHAIN" 2>/dev/null || true
  fi
}
trap rollback_partial EXIT HUP INT TERM

iptables -N "$NEW_CHAIN"
created=1
iptables -A "$NEW_CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for source in 172.30.252.2/32 172.30.252.3/32; do
  iptables -A "$NEW_CHAIN" -s "$source" -d "$GATEWAY" -p tcp --dport 3000 \
    -m conntrack --ctstate NEW -j ACCEPT
  for ip in $ips; do
    iptables -A "$NEW_CHAIN" -s "$source" -d "$ip/32" -p tcp --dport 5432 \
      -m conntrack --ctstate NEW -j ACCEPT
  done
done
iptables -A "$NEW_CHAIN" -s "$SUBNET" -j DROP
iptables -A "$NEW_CHAIN" -j RETURN

iptables -C "$NEW_CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for source in 172.30.252.2/32 172.30.252.3/32; do
  iptables -C "$NEW_CHAIN" -s "$source" -d "$GATEWAY" -p tcp --dport 3000 \
    -m conntrack --ctstate NEW -j ACCEPT
done
iptables -C "$NEW_CHAIN" -s "$SUBNET" -j DROP

iptables -I DOCKER-USER 1 -j "$NEW_CHAIN"
hooked_new=1
iptables -D DOCKER-USER -j "$OLD_CHAIN"
unhooked_old=1
test "$(iptables -S DOCKER-USER | grep -Fxc -- "-A DOCKER-USER -j $NEW_CHAIN")" -eq 1
! iptables -S DOCKER-USER | grep -F -- "-j $OLD_CHAIN" >/dev/null

committed=1
trap - EXIT HUP INT TERM
echo "Tanaghom Postiz gateway firewall update committed."
