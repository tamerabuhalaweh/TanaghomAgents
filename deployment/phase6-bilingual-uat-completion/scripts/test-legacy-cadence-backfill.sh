#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
DATABASE_TEST_URL=${1:-}
test -n "$DATABASE_TEST_URL" || {
  echo 'usage: test-legacy-cadence-backfill.sh DATABASE_TEST_URL' >&2
  exit 2
}
export DATABASE_URL=$DATABASE_TEST_URL

latest() {
  psql "$DATABASE_TEST_URL" -X -v ON_ERROR_STOP=1 -At -c \
    'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;'
}

test "$(latest)" = 0029_organization_agent_studio
node "$ROOT/scripts/database.mjs" rollback >/dev/null
test "$(latest)" = 0028_strategy_cadence_integrity
node "$ROOT/scripts/database.mjs" rollback >/dev/null
test "$(latest)" = 0027_governed_skill_library
psql "$DATABASE_TEST_URL" -X -v ON_ERROR_STOP=1 \
  -f "$ROOT/packages/database/seeds/staging.sql" >/dev/null

psql "$DATABASE_TEST_URL" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO tanaghom.campaign_strategies(
  id,campaign_id,version,positioning,key_messages,channels,posting_cadence,
  content_pillars,model_name,prompt_version
) VALUES (
  '78000000-0000-4000-8000-000000000028',
  '20000000-0000-4000-8000-000000000001',
  1,
  'Legacy backfill fixture',
  '["Message one","Message two","Message three"]',
  '["instagram","facebook","whatsapp_status"]',
  '{
    "instagram":"4-5 posts per week plus daily stories",
    "facebook":"3 posts per week",
    "whatsapp_status":"daily"
  }',
  '[
    {"name":"One","description":"One","example_angles":["One"]},
    {"name":"Two","description":"Two","example_angles":["Two"]},
    {"name":"Three","description":"Three","example_angles":["Three"]},
    {"name":"Four","description":"Four","example_angles":["Four"]}
  ]',
  'legacy-fixture',
  'campaign-strategist/legacy'
);
SQL

node "$ROOT/scripts/database.mjs" migrate >/dev/null
test "$(latest)" = 0029_organization_agent_studio
psql "$DATABASE_TEST_URL" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DO $$
DECLARE
  v_cadence jsonb;
  v_original jsonb;
BEGIN
  SELECT posting_cadence INTO v_cadence
  FROM tanaghom.campaign_strategies
  WHERE id='78000000-0000-4000-8000-000000000028';
  IF v_cadence <> '{
    "instagram":{"posts_per_week":5},
    "facebook":{"posts_per_week":3},
    "whatsapp_status":{"posts_per_week":7}
  }'::jsonb THEN
    RAISE EXCEPTION 'legacy cadence was not deterministically normalized';
  END IF;
  IF NOT tanaghom.campaign_strategy_cadence_is_valid(
    '["instagram","facebook","whatsapp_status"]'::jsonb,v_cadence
  ) THEN
    RAISE EXCEPTION 'normalized legacy cadence does not satisfy the guard';
  END IF;
  SELECT original_posting_cadence INTO v_original
  FROM tanaghom.strategy_cadence_0028_legacy_backup
  WHERE strategy_id='78000000-0000-4000-8000-000000000028';
  IF v_original->>'whatsapp_status'<>'daily'
     OR v_original->>'instagram'<>'4-5 posts per week plus daily stories' THEN
    RAISE EXCEPTION 'legacy cadence backup did not preserve the source';
  END IF;
END
$$;
SQL

node "$ROOT/scripts/database.mjs" rollback >/dev/null
test "$(latest)" = 0028_strategy_cadence_integrity
node "$ROOT/scripts/database.mjs" rollback >/dev/null
test "$(latest)" = 0027_governed_skill_library
psql "$DATABASE_TEST_URL" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DO $$
DECLARE v_cadence jsonb;
BEGIN
  IF to_regclass('tanaghom.strategy_cadence_0028_legacy_backup') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy cadence backup table survived rollback';
  END IF;
  SELECT posting_cadence INTO v_cadence
  FROM tanaghom.campaign_strategies
  WHERE id='78000000-0000-4000-8000-000000000028';
  IF v_cadence->>'whatsapp_status'<>'daily'
     OR v_cadence->>'facebook'<>'3 posts per week' THEN
    RAISE EXCEPTION 'rollback did not restore the exact legacy cadence';
  END IF;
END
$$;
SQL

node "$ROOT/scripts/database.mjs" migrate >/dev/null
test "$(latest)" = 0029_organization_agent_studio
psql "$DATABASE_TEST_URL" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DELETE FROM tanaghom.strategy_cadence_0028_legacy_backup
WHERE strategy_id='78000000-0000-4000-8000-000000000028';
DELETE FROM tanaghom.campaign_strategies
WHERE id='78000000-0000-4000-8000-000000000028';
DELETE FROM tanaghom.campaigns
WHERE id='20000000-0000-4000-8000-000000000001';
DELETE FROM tanaghom.app_users
WHERE id='00000000-0000-4000-8000-000000000001';
SQL

echo 'PASS: legacy cadence backfill is deterministic, source-preserving, and exactly reversible.'
