#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
n8n_image='docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd'
postgres_image='postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'
port=${N8N_UAT_CORRECTION_TEST_PORT:-55449}
n8n_port=${N8N_UAT_CORRECTION_HTTP_PORT:-55679}
postgres_container="tanaghom-uat-correction-pg-$$"
n8n_container="tanaghom-uat-correction-n8n-$$"
temporary=$(mktemp -d)
chmod 0755 "$temporary"

all_ids='phase3StrategistV1 phase3ContentProducerV1 phase4PostizDraftV1 phase4PostizPerformanceV1 phase5GhlContactUpsertV1 phase5ConversationIntelligenceV1 phase5GovernedGhlActionsV1 phase5gQualityShadowEvaluatorV1'

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

node "$root/deployment/phase6-uat-runtime-correction/scripts/prepare-runtime-workflows.mjs" \
  "$root" "$temporary/runtime"

docker run -d --name "$postgres_container" -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=n8n_uat_correction_test -p "$port:5432" "$postgres_image" >/dev/null
attempt=0
until docker exec "$postgres_container" pg_isready -U postgres -d n8n_uat_correction_test >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 30 || { echo 'disposable PostgreSQL timeout' >&2; exit 1; }
  sleep 1
done

docker run -d --name "$n8n_container" --network host \
  -e N8N_ENCRYPTION_KEY=uat-correction-disposable-key-32 \
  -e DB_TYPE=postgresdb -e DB_POSTGRESDB_HOST="$host" -e DB_POSTGRESDB_PORT="$port" \
  -e DB_POSTGRESDB_DATABASE=n8n_uat_correction_test -e DB_POSTGRESDB_USER=postgres \
  -e DB_POSTGRESDB_PASSWORD=postgres -e N8N_DIAGNOSTICS_ENABLED=false \
  -e N8N_VERSION_NOTIFICATIONS_ENABLED=false -e N8N_PORT="$n8n_port" \
  --entrypoint sh "$n8n_image" -c 'exec sleep 600' >/dev/null
docker exec -u node "$n8n_container" n8n list:workflow --onlyId >/dev/null

import_file() {
  source=$1
  id=$2
  remote="/home/node/$id.json"
  docker exec -i -u node "$n8n_container" sh -ec 'umask 077; cat > "$1"' sh "$remote" <"$source"
  docker exec -u node "$n8n_container" n8n import:workflow --input="$remote" --activeState=false >/dev/null
  docker exec -u node "$n8n_container" rm -f "$remote"
}

sql() {
  docker exec "$postgres_container" psql -U postgres -d n8n_uat_correction_test -X -At -c "$1"
}

for id in $all_ids; do import_file "$temporary/runtime/$id.json" "$id"; done
test "$(sql "SELECT count(*) FROM workflow_entity;")" = 8
test "$(sql "SELECT count(*) FROM workflow_entity workflow CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes::jsonb) node WHERE node->>'type'='n8n-nodes-base.scheduleTrigger' AND coalesce((node->>'disabled')::boolean,false)=false;")" = 8
for id in $all_ids; do
  docker exec -u node "$n8n_container" n8n publish:workflow --id="$id" >/dev/null
done

docker exec -d -u node "$n8n_container" sh -c \
  'exec n8n start > /home/node/uat-correction-runtime.log 2>&1'
attempt=0
until docker exec -u node "$n8n_container" grep -q 'Editor is now accessible' \
  /home/node/uat-correction-runtime.log 2>/dev/null; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 40 || {
    docker exec -u node "$n8n_container" cat /home/node/uat-correction-runtime.log >&2 || true
    echo 'disposable n8n runtime timeout' >&2
    exit 1
  }
  sleep 1
done
if docker exec -u node "$n8n_container" grep -E \
  'Tanaghom.*has no node to start|Activation of workflow "Tanaghom.*did fail|Issue on initial workflow activation try of "Tanaghom' \
  /home/node/uat-correction-runtime.log; then
  echo 'disposable n8n reported a Tanaghom activation failure' >&2
  exit 1
fi
test "$(sql "SELECT count(*) FROM workflow_entity WHERE active IS TRUE;")" = 8

for id in $all_ids; do
  docker exec -u node "$n8n_container" n8n unpublish:workflow --id="$id" >/dev/null
done
test "$(sql "SELECT count(*) FROM workflow_entity WHERE active IS TRUE;")" = 0

echo 'PASS: pinned disposable n8n started all eight policy-gated schedules without activation retries and returned to all-inactive safely.'
