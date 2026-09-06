#!/bin/bash
set -euo pipefail
cd /opt/tanaghom-test/source
export TANAGHOM_RELEASE="$(git rev-parse HEAD)"
compose=(docker compose -p tanaghom-test -f deployment/fresh-test-vps/compose.yml)
"${compose[@]}" config --quiet
"${compose[@]}" config --format json | python3 deployment/fresh-test-vps/validate-compose.py
test "$("${compose[@]}" ps --status running --services | wc -l)" -eq 3
for service in postgres dashboard; do
  id=$("${compose[@]}" ps -q "$service")
  test "$(docker inspect --format '{{.State.Health.Status}}' "$id")" = healthy
  test "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$id")" = 0
done
"${compose[@]}" exec -T postgres psql -U postgres -d tanaghom_test -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF current_database() <> 'tanaghom_test' OR (SELECT count(*) FROM public.schema_migrations) <> 34
 THEN RAISE EXCEPTION 'wrong database/migrations'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tanaghom_api' AND
    (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls))
 THEN RAISE EXCEPTION 'unsafe API role'; END IF;
 IF EXISTS (SELECT 1 FROM tanaghom.automation_platform_controls WHERE NOT emergency_stop)
 THEN RAISE EXCEPTION 'platform stop changed'; END IF;
END $$;
SELECT count(*) AS migrations FROM public.schema_migrations;
SELECT count(*) AS accepted_test_owners FROM tanaghom.app_users
WHERE role='owner' AND kind='human' AND accepted_at IS NOT NULL;
SQL
"${compose[@]}" exec -T dashboard node -e '
const required=["AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED","AGENCY_PILOT_GATEWAY_ENABLED","POSTIZ_HANDOFF_ENABLED","POSTIZ_AUTOMATION_RUNTIME_READY","POSTIZ_PERFORMANCE_SYNC_ENABLED","GHL_CONTACT_SYNC_ENABLED","GHL_CONTACT_HANDOFF_ENABLED","GHL_WEBHOOK_INGRESS_ENABLED","GHL_ACTION_RUNTIME_ENABLED","GHL_ACTION_RUNTIME_READY","ALLOW_STAGING_PUBLISH"];
if(required.some(k=>process.env[k]!=="false")||process.env.SUPABASE_SECRET_KEY||process.env.OPENAI_API_KEY)process.exit(1);
console.log("Provider/model/admin-key boundaries verified");'
url=https://tanaghom-test.155-117-45-45.sslip.io
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$url/api/health"
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url/login")" = 200
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url/api/operations")" = 401
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url/api/admin/agents")" = 401
"${compose[@]}" ps
docker image inspect "tanaghom-test-dashboard:$TANAGHOM_RELEASE" --format '{{.Id}}'
df -h /
echo 'TEST_DEPLOYMENT_VALIDATION_PASSED'
