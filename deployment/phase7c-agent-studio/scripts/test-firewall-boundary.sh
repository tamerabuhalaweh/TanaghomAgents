#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT

cat > "$temporary/iptables" <<'EOF'
#!/bin/sh
set -eu

case "$*" in
  '-C DOCKER-USER -j TANAGHOM_N8N_DB_EGRESS')
    test "${PHASE7C_MISSING_HOOK:-0}" != 1
    ;;
  '-C INPUT -j TANAGHOM_N8N_DB_INPUT')
    exit 0
    ;;
  '-S TANAGHOM_N8N_DB_EGRESS')
    echo '-N TANAGHOM_N8N_DB_EGRESS'
    if test "${PHASE7C_FIREWALL_MUTATION:-0}" = 1; then
      echo '-A TANAGHOM_N8N_DB_EGRESS -j ACCEPT'
    else
      echo '-A TANAGHOM_N8N_DB_EGRESS -j RETURN'
    fi
    ;;
  '-S TANAGHOM_N8N_DB_INPUT')
    echo '-N TANAGHOM_N8N_DB_INPUT'
    echo '-A TANAGHOM_N8N_DB_INPUT -j RETURN'
    ;;
  '-S DOCKER-USER')
    echo '-A DOCKER-USER -j TANAGHOM_N8N_DB_EGRESS'
    ;;
  '-S INPUT')
    echo '-A INPUT -j TANAGHOM_N8N_DB_INPUT'
    ;;
  *)
    echo "unexpected iptables arguments: $*" >&2
    exit 2
    ;;
esac
EOF
chmod 0700 "$temporary/iptables"
PATH="$temporary:$PATH"
export PATH

. "$SCRIPT_DIR/common.sh"

assert_firewall_boundary
capture_firewall_boundary "$temporary/before"
capture_firewall_boundary "$temporary/equivalent"
cmp -s "$temporary/before" "$temporary/equivalent" ||
  die 'equivalent package-owned firewall state changed'

PHASE7C_FIREWALL_MUTATION=1
export PHASE7C_FIREWALL_MUTATION
capture_firewall_boundary "$temporary/changed"
if cmp -s "$temporary/before" "$temporary/changed"; then
  die 'package-owned firewall drift was not detected'
fi
unset PHASE7C_FIREWALL_MUTATION

if (
  PHASE7C_MISSING_HOOK=1
  export PHASE7C_MISSING_HOOK
  assert_firewall_boundary
) 2>/dev/null; then
  die 'missing firewall hook was not detected'
fi

echo 'PASS: Phase 7C preserves exact package-owned firewall chains and rejects real drift.'
