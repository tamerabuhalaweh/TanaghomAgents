#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
suffix="$$-$(date +%s)"
network="tanaghom-phase7d-package-$suffix"
postgres="tanaghom-phase7d-package-pg-$suffix"
n8n="tanaghom-phase7d-package-n8n-$suffix"
n8n_image='docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd'
postgres_image='postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'
temporary=$(mktemp -d)

cleanup() {
  docker rm -f "$n8n" "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$temporary"
}
trap cleanup EXIT HUP INT TERM

docker network create "$network" >/dev/null
docker run -d --name "$postgres" --network "$network" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=n8n_phase7d_package \
  "$postgres_image" >/dev/null

attempt=0
until docker exec "$postgres" pg_isready -U postgres -d n8n_phase7d_package \
  >/dev/null 2>&1
do
  attempt=$((attempt + 1))
  test "$attempt" -lt 80 || {
    echo 'disposable PostgreSQL did not become ready' >&2
    exit 1
  }
  sleep 1
done

docker run -d --name "$n8n" --network "$network" \
  -e N8N_ENCRYPTION_KEY=phase7d-package-disposable-key-32 \
  -e N8N_DIAGNOSTICS_ENABLED=false \
  -e N8N_VERSION_NOTIFICATIONS_ENABLED=false \
  -e N8N_USER_MANAGEMENT_DISABLED=true \
  -e DB_TYPE=postgresdb \
  -e DB_POSTGRESDB_HOST="$postgres" \
  -e DB_POSTGRESDB_PORT=5432 \
  -e DB_POSTGRESDB_DATABASE=n8n_phase7d_package \
  -e DB_POSTGRESDB_USER=postgres \
  -e DB_POSTGRESDB_PASSWORD=postgres \
  --entrypoint sh "$n8n_image" -c 'exec sleep 600' >/dev/null
docker exec -u node "$n8n" n8n list:workflow --onlyId >/dev/null

cat > "$temporary/credentials.json" <<'JSON'
[
  {
    "id":"7d000000-0000-4000-8000-000000000101",
    "name":"Tanaghom Agent Runtime PostgreSQL",
    "type":"postgres",
    "data":{"host":"example.test","database":"postgres","user":"runtime","password":"disposable","port":5432,"ssl":"require"}
  },
  {
    "id":"7d100000-0000-4000-8000-000000000301",
    "name":"Tanaghom Skill Read Executor PostgreSQL",
    "type":"postgres",
    "data":{"host":"example.test","database":"postgres","user":"read","password":"disposable","port":5432,"ssl":"require"}
  },
  {
    "id":"7d100000-0000-4000-8000-000000000302",
    "name":"Tanaghom Skill Proposal Executor PostgreSQL",
    "type":"postgres",
    "data":{"host":"example.test","database":"postgres","user":"proposal","password":"disposable","port":5432,"ssl":"require"}
  },
  {
    "id":"7d100000-0000-4000-8000-000000000303",
    "name":"Tanaghom Skill Action Executor PostgreSQL",
    "type":"postgres",
    "data":{"host":"example.test","database":"postgres","user":"action","password":"disposable","port":5432,"ssl":"require"}
  }
]
JSON

remote=/home/node/phase7d-package-credentials.json
docker exec -i -u node "$n8n" sh -ec \
  'umask 077; cat > "$1"' sh "$remote" < "$temporary/credentials.json"
docker exec -u node "$n8n" n8n import:credentials --input="$remote" >/dev/null
docker exec -u node "$n8n" rm -f "$remote"

for file in \
  policy-resolved-agent-runner.v1.json \
  simulation-dispatcher.v1.json \
  read-executor.v1.json \
  proposal-executor.v1.json \
  action-executor.v1.json \
  runtime-finalizer.v1.json
do
  remote="/home/node/$file"
  docker exec -i -u node "$n8n" sh -ec \
    'umask 077; cat > "$1"' sh "$remote" \
    < "$root/n8n/workflows/phase7d/$file"
  docker exec -u node "$n8n" n8n import:workflow \
    --input="$remote" --activeState=false >/dev/null
  docker exec -u node "$n8n" rm -f "$remote"
done

sql() {
  docker exec "$postgres" psql -U postgres -d n8n_phase7d_package \
    -X -v ON_ERROR_STOP=1 -At -c "$1"
}

test "$(sql "SELECT count(*) FROM credentials_entity;")" = 4
test "$(sql "
  SELECT count(*) FROM credentials_entity
   WHERE type='postgres' AND length(data)>40;
")" = 4
test "$(sql "SELECT count(*) FROM workflow_entity;")" = 6
test "$(sql "
  SELECT count(*) FROM workflow_entity
   WHERE active IS FALSE AND \"isArchived\" IS FALSE;
")" = 6
test "$(sql "
  SELECT count(*)
    FROM workflow_entity workflow
    CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes::jsonb) node
   WHERE node->>'type'='n8n-nodes-base.scheduleTrigger'
     AND coalesce((node->>'disabled')::boolean,false)=false;
")" = 0
test "$(sql "
  SELECT count(*)
    FROM workflow_entity workflow
    CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes::jsonb) node
   WHERE node->>'type'='n8n-nodes-base.scheduleTrigger';
")" = 5
test "$(sql 'SELECT count(*) FROM execution_entity;')" = 0
docker exec -u node "$n8n" n8n audit > "$temporary/n8n-audit.txt"
test -s "$temporary/n8n-audit.txt"

sql "
  BEGIN;
  DELETE FROM workflow_entity;
  DELETE FROM shared_credentials;
  DELETE FROM credentials_entity;
  COMMIT;
" >/dev/null
test "$(sql 'SELECT count(*) FROM workflow_entity;')" = 0
test "$(sql 'SELECT count(*) FROM credentials_entity;')" = 0
test "$(sql 'SELECT count(*) FROM execution_entity;')" = 0

echo 'PASS: pinned disposable n8n imported four encrypted credentials and six inactive disabled zero-execution workflows, audited, and removed only package records.'
