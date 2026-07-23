#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
test -d "$PRODUCTION_ROOT/.git" || die 'Tanaghom production checkout is missing'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_TARGET_COMMIT" ||
  die 'production checkout is not the approved target commit'
unexpected=$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" status --porcelain |
  grep -v '^ M deployment/phase4-postiz-activation/egress/squid.conf$' || true)
test -z "$unexpected" || die 'production checkout contains unreviewed changes'
test "$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 20 || die 'less than 20 GiB is free'
test "$(db_scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;")" = "$EXPECTED_START_MIGRATION" ||
  die 'database is not at migration 0026'
test "$(db_scalar "SELECT to_regclass('tanaghom.organization_skill_definitions') IS NULL;")" = t ||
  die 'Skill Library tables already exist'
assert_policy_locked
docker info >/dev/null
compose config --quiet
for unit in $PROTECTED_UNITS; do
  test "$(systemctl is-active "$unit")" = active || die "protected unit is not active: $unit"
done
for container in $PROTECTED_N8N_CONTAINERS; do
  test "$(container_health "$container")" = healthy || die "protected n8n container is not healthy: $container"
done
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'Tanaghom dashboard is unhealthy'
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/admin/skills")" = 401 ||
  die 'Skill Library API authentication boundary is not closed'

echo "PASS: Phase 7B Skill Library read-only preflight passed for $TANAGHOM_RELEASE_ID."
