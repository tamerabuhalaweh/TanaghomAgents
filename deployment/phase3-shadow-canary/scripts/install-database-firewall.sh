#!/bin/sh
set -eu

EGRESS_CHAIN=TANAGHOM_N8N_DB_EGRESS
INPUT_CHAIN=TANAGHOM_N8N_DB_INPUT
POOLER_HOST=aws-1-ap-south-1.pooler.supabase.com
SUBNET=172.30.252.0/29

test "${TANAGHOM_FIREWALL_CHANGE_AUTHORIZED:-}" = "YES-I-AM-THE-AUTHORIZED-OWNER" || {
  echo "Refusing: explicit infrastructure-owner authorization is absent." >&2
  exit 64
}
command -v iptables >/dev/null
command -v getent >/dev/null
iptables -nL DOCKER-USER >/dev/null 2>&1 || exit 66

if iptables -nL "$EGRESS_CHAIN" >/dev/null 2>&1 \
   || iptables -nL "$INPUT_CHAIN" >/dev/null 2>&1 \
   || iptables -S DOCKER-USER | grep -F -- "-j $EGRESS_CHAIN" >/dev/null \
   || iptables -S INPUT | grep -F -- "-j $INPUT_CHAIN" >/dev/null; then
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

created_egress=0
created_input=0
hooked_egress=0
hooked_input=0
committed=0
rollback_partial() {
  test "$committed" -eq 1 && return 0
  test "$hooked_input" -eq 0 || iptables -D INPUT -j "$INPUT_CHAIN" 2>/dev/null || true
  test "$hooked_egress" -eq 0 || iptables -D DOCKER-USER -j "$EGRESS_CHAIN" 2>/dev/null || true
  if test "$created_input" -eq 1; then
    iptables -F "$INPUT_CHAIN" 2>/dev/null || true
    iptables -X "$INPUT_CHAIN" 2>/dev/null || true
  fi
  if test "$created_egress" -eq 1; then
    iptables -F "$EGRESS_CHAIN" 2>/dev/null || true
    iptables -X "$EGRESS_CHAIN" 2>/dev/null || true
  fi
}
trap rollback_partial EXIT
trap 'exit 70' HUP INT TERM

iptables -N "$EGRESS_CHAIN"
created_egress=1
iptables -A "$EGRESS_CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for source in 172.30.252.2/32 172.30.252.3/32; do
  for ip in $ips; do
    iptables -A "$EGRESS_CHAIN" -s "$source" -d "$ip/32" -p tcp --dport 5432 -m conntrack --ctstate NEW -j ACCEPT
  done
done
iptables -A "$EGRESS_CHAIN" -s "$SUBNET" -j DROP
iptables -A "$EGRESS_CHAIN" -j RETURN

iptables -N "$INPUT_CHAIN"
created_input=1
iptables -A "$INPUT_CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -A "$INPUT_CHAIN" -i br-tan-n8n-db -j DROP
iptables -A "$INPUT_CHAIN" -j RETURN

iptables -C "$EGRESS_CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -C "$EGRESS_CHAIN" -s "$SUBNET" -j DROP
iptables -C "$INPUT_CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -C "$INPUT_CHAIN" -i br-tan-n8n-db -j DROP
for source in 172.30.252.2/32 172.30.252.3/32; do
  for ip in $ips; do
    iptables -C "$EGRESS_CHAIN" -s "$source" -d "$ip/32" -p tcp --dport 5432 -m conntrack --ctstate NEW -j ACCEPT
  done
done

iptables -I DOCKER-USER 1 -j "$EGRESS_CHAIN"
hooked_egress=1
iptables -I INPUT 1 -j "$INPUT_CHAIN"
hooked_input=1
iptables -C DOCKER-USER -j "$EGRESS_CHAIN"
iptables -C INPUT -j "$INPUT_CHAIN"
committed=1
trap - EXIT HUP INT TERM
echo "Tanaghom n8n database-egress firewall transaction committed."
