#!/bin/sh
set -eu

CHAIN=TANAGHOM_N8N_DB_EGRESS
POOLER_HOST=aws-1-ap-south-1.pooler.supabase.com
SUBNET=172.30.252.0/29

test "${TANAGHOM_FIREWALL_CHANGE_AUTHORIZED:-}" = "YES-I-AM-THE-AUTHORIZED-OWNER" || {
  echo "Refusing: explicit infrastructure-owner authorization is absent." >&2
  exit 64
}
command -v iptables >/dev/null
command -v getent >/dev/null
iptables -nL DOCKER-USER >/dev/null 2>&1 || exit 66

if iptables -nL "$CHAIN" >/dev/null 2>&1 || iptables -S DOCKER-USER | grep -F -- "-j $CHAIN" >/dev/null; then
  echo "Refusing: package chain or hook already exists; use the controlled update script." >&2
  exit 67
fi

ips="$(getent ahostsv4 "$POOLER_HOST" | awk '{print $1}' | sort -u)"
test -n "$ips"
for ip in $ips; do
  case "$ip" in
    0.*|10.*|100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*|127.*|169.254.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|192.168.*|22[4-9].*|23[0-9].*|24[0-9].*|25[0-5].*)
      echo "Refusing private/reserved pooler resolution: $ip" >&2
      exit 65
      ;;
  esac
done

created=0
hooked=0
committed=0
rollback_partial() {
  test "$committed" -eq 1 && return 0
  test "$hooked" -eq 0 || iptables -D DOCKER-USER -j "$CHAIN" 2>/dev/null || true
  if test "$created" -eq 1; then
    iptables -F "$CHAIN" 2>/dev/null || true
    iptables -X "$CHAIN" 2>/dev/null || true
  fi
}
trap rollback_partial EXIT
trap 'exit 70' HUP INT TERM

iptables -N "$CHAIN"
created=1
iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for source in 172.30.252.2/32 172.30.252.3/32; do
  for ip in $ips; do
    iptables -A "$CHAIN" -s "$source" -d "$ip/32" -p tcp --dport 5432 -m conntrack --ctstate NEW -j ACCEPT
  done
done
iptables -A "$CHAIN" -s "$SUBNET" -j DROP
iptables -A "$CHAIN" -j RETURN

iptables -C "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -C "$CHAIN" -s "$SUBNET" -j DROP
for source in 172.30.252.2/32 172.30.252.3/32; do
  for ip in $ips; do
    iptables -C "$CHAIN" -s "$source" -d "$ip/32" -p tcp --dport 5432 -m conntrack --ctstate NEW -j ACCEPT
  done
done

iptables -I DOCKER-USER 1 -j "$CHAIN"
hooked=1
iptables -C DOCKER-USER -j "$CHAIN"
committed=1
trap - EXIT HUP INT TERM
echo "Tanaghom n8n database-egress firewall transaction committed."
