#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
n8n_image='docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd'
postgres_image='postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'
port=${N8N_UAT_ACTIVATION_TEST_PORT:-55448}
postgres_container="tanaghom-uat-activation-pg-$$"
n8n_container="tanaghom-uat-activation-n8n-$$"
temporary=$(mktemp -d)
chmod 0755 "$temporary"

core_ids='phase3StrategistV1 phase3ContentProducerV1'
controlled_ids='phase4PostizDraftV1 phase4PostizPerformanceV1 phase5GhlContactUpsertV1 phase5ConversationIntelligenceV1 phase5GovernedGhlActionsV1 phase5gQualityShadowEvaluatorV1'
all_ids="$core_ids $controlled_ids"
preexisting_ids='phase3StrategistV1 phase3ContentProducerV1 phase4PostizDraftV1 phase5ConversationIntelligenceV1 phase5gQualityShadowEvaluatorV1'
new_ids='phase4PostizPerformanceV1 phase5GhlContactUpsertV1 phase5GovernedGhlActionsV1'

cleanup() {
  docker rm -f "$n8n_container" >/dev/null 2>&1 || true
  docker rm -f "$postgres_container" >/dev/null 2>&1 || true
  rm -rf -- "$temporary"
}
trap cleanup EXIT HUP INT TERM

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) export MSYS_NO_PATHCONV=1; host=host.docker.internal ;;
  *) host=127.0.0.1 ;;
esac

docker run -d --name "$postgres_container" -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=n8n_uat_activation_test -p "$port:5432" "$postgres_image" >/dev/null
attempt=0
until docker exec "$postgres_container" pg_isready -U postgres -d n8n_uat_activation_test >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 30 || { echo 'disposable PostgreSQL timeout' >&2; exit 1; }
  sleep 1
done

docker run -d --name "$n8n_container" --network host \
  -e N8N_ENCRYPTION_KEY=uat-activation-disposable-key-32 \
  -e DB_TYPE=postgresdb -e DB_POSTGRESDB_HOST="$host" -e DB_POSTGRESDB_PORT="$port" \
  -e DB_POSTGRESDB_DATABASE=n8n_uat_activation_test -e DB_POSTGRESDB_USER=postgres \
  -e DB_POSTGRESDB_PASSWORD=postgres -e N8N_DIAGNOSTICS_ENABLED=false \
  --entrypoint sh "$n8n_image" -c 'exec sleep 600' >/dev/null
docker exec -u node "$n8n_container" n8n list:workflow --onlyId >/dev/null

source_for() {
  case "$1" in
    phase3StrategistV1) echo "$root/n8n/workflows/phase3/campaign-strategist.v1.json" ;;
    phase3ContentProducerV1) echo "$root/n8n/workflows/phase3/content-producer.v1.json" ;;
    phase4PostizDraftV1) echo "$root/n8n/workflows/phase4/postiz-draft-publisher.v1.json" ;;
    phase4PostizPerformanceV1) echo "$root/n8n/workflows/phase4/postiz-performance-monitor.v1.json" ;;
    phase5GhlContactUpsertV1) echo "$root/n8n/workflows/phase5/ghl-contact-sync.v1.json" ;;
    phase5ConversationIntelligenceV1) echo "$root/n8n/workflows/phase5/conversation-intelligence.v1.json" ;;
    phase5GovernedGhlActionsV1) echo "$root/n8n/workflows/phase5/governed-ghl-actions.v1.json" ;;
    phase5gQualityShadowEvaluatorV1) echo "$root/n8n/workflows/phase5g/quality-shadow-evaluator.v1.json" ;;
    *) exit 2 ;;
  esac
}

import_inactive() {
  id=$1
  remote="/home/node/$id.json"
  docker exec -i -u node "$n8n_container" sh -ec 'umask 077; cat > "$1"' sh "$remote" <"$(source_for "$id")"
  docker exec -u node "$n8n_container" n8n import:workflow --input="$remote" --activeState=false >/dev/null
  docker exec -u node "$n8n_container" rm -f "$remote"
}

export_before() {
  id=$1
  remote="/home/node/$id-before.json"
  docker exec -u node "$n8n_container" n8n export:workflow --id="$id" --pretty --output="$remote" >/dev/null
  docker exec -u node "$n8n_container" cat "$remote" >"$temporary/$id.json"
  docker exec -u node "$n8n_container" rm -f "$remote"
}

restore_before() {
  id=$1
  remote="/home/node/$id-restore.json"
  docker exec -i -u node "$n8n_container" sh -ec 'umask 077; cat > "$1"' sh "$remote" <"$temporary/$id.json"
  docker exec -u node "$n8n_container" n8n import:workflow --input="$remote" --activeState=false >/dev/null
  docker exec -u node "$n8n_container" rm -f "$remote"
}

sql() {
  docker exec "$postgres_container" psql -U postgres -d n8n_uat_activation_test -X -At -c "$1"
}

for id in $preexisting_ids; do import_inactive "$id"; export_before "$id"; done
test "$(sql "SELECT count(*) FROM workflow_entity;")" = 5
test "$(sql "SELECT count(*) FROM workflow_entity WHERE active IS TRUE;")" = 0

for id in $all_ids; do import_inactive "$id"; done
test "$(sql "SELECT count(*) FROM workflow_entity;")" = 8
test "$(sql "SELECT count(*) FROM workflow_entity workflow CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes::jsonb) node WHERE workflow.id IN ('phase3StrategistV1','phase3ContentProducerV1') AND node->>'type'='n8n-nodes-base.scheduleTrigger' AND coalesce((node->>'disabled')::boolean,false)=false;")" = 2
test "$(sql "SELECT count(*) FROM workflow_entity workflow CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes::jsonb) node WHERE workflow.id NOT IN ('phase3StrategistV1','phase3ContentProducerV1') AND node->>'type'='n8n-nodes-base.scheduleTrigger' AND coalesce((node->>'disabled')::boolean,false)=false;")" = 0

for id in $all_ids; do docker exec -u node "$n8n_container" n8n publish:workflow --id="$id" >/dev/null; done
test "$(sql "SELECT count(*) FROM workflow_entity WHERE active IS TRUE AND \"isArchived\" IS FALSE;")" = 8
docker exec -u node "$n8n_container" n8n audit >"$temporary/audit.txt"
test -s "$temporary/audit.txt"

for id in $all_ids; do docker exec -u node "$n8n_container" n8n unpublish:workflow --id="$id" >/dev/null; done
test "$(sql "SELECT count(*) FROM workflow_entity WHERE active IS TRUE;")" = 0
for id in $preexisting_ids; do restore_before "$id"; done
for id in $new_ids; do
  test "$(sql "SELECT count(*) FROM execution_entity WHERE \"workflowId\"='$id';")" = 0
done
sql "BEGIN; DELETE FROM workflow_entity WHERE id IN ('phase4PostizPerformanceV1','phase5GhlContactUpsertV1','phase5GovernedGhlActionsV1') AND active IS FALSE; COMMIT;" >/dev/null
test "$(sql "SELECT count(*) FROM workflow_entity;")" = 5
test "$(sql "SELECT count(*) FROM workflow_entity WHERE active IS TRUE;")" = 0
for id in $new_ids; do test "$(sql "SELECT count(*) FROM workflow_entity WHERE id='$id';")" = 0; done

echo 'PASS: pinned disposable n8n proved five baseline workflows, three imports, eight publications, core-only schedules, and exact package-owned rollback.'
