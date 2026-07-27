#!/bin/sh
set -eu

suffix="$$-$(date +%s)"
network="tanaghom-phase7f-dispatch-$suffix"
postgres="tanaghom-phase7f-dispatch-pg-$suffix"
n8n="tanaghom-phase7f-dispatch-n8n-$suffix"
n8n_image='docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd'
postgres_image='postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'
parent_id=phase7fDisposableParent
dispatcher_id=phase7fDisposableDispatcher
temporary=$(mktemp -d)

cleanup() {
  status=$?
  if test "$status" -ne 0; then
    for log in "$temporary"/*.log; do
      test -f "$log" || continue
      echo "=== $(basename "$log") ===" >&2
      sed -n '1,240p' "$log" >&2
    done
  fi
  docker rm -f "$n8n" "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$temporary"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

docker network create "$network" >/dev/null
docker run -d --name "$postgres" --network "$network" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=n8n_phase7f_dispatch \
  "$postgres_image" >/dev/null

attempt=0
until docker exec "$postgres" pg_isready -U postgres -d n8n_phase7f_dispatch \
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
  -e N8N_ENCRYPTION_KEY=phase7f-dispatch-disposable-key-32 \
  -e N8N_DIAGNOSTICS_ENABLED=false \
  -e N8N_VERSION_NOTIFICATIONS_ENABLED=false \
  -e N8N_USER_MANAGEMENT_DISABLED=true \
  -e DB_TYPE=postgresdb \
  -e DB_POSTGRESDB_HOST="$postgres" \
  -e DB_POSTGRESDB_PORT=5432 \
  -e DB_POSTGRESDB_DATABASE=n8n_phase7f_dispatch \
  -e DB_POSTGRESDB_USER=postgres \
  -e DB_POSTGRESDB_PASSWORD=postgres \
  --entrypoint sh "$n8n_image" -c 'exec sleep 600' >/dev/null
docker exec -u node "$n8n" n8n list:workflow --onlyId >/dev/null

cat > "$temporary/dispatcher.json" <<'JSON'
{
  "id": "phase7fDisposableDispatcher",
  "name": "Phase 7F Disposable Dispatcher",
  "active": false,
  "nodes": [
    {
      "parameters": {"inputSource": "passthrough"},
      "id": "phase7f-disposable-child-trigger",
      "name": "Called by Disposable Parent",
      "type": "n8n-nodes-base.executeWorkflowTrigger",
      "typeVersion": 1.1,
      "position": [0, 0]
    },
    {
      "parameters": {"jsCode": "return [{ json: { bounded_dispatch: true } }];"},
      "id": "phase7f-disposable-child-result",
      "name": "Return Bounded Result",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [240, 0]
    }
  ],
  "connections": {
    "Called by Disposable Parent": {
      "main": [[{"node": "Return Bounded Result", "type": "main", "index": 0}]]
    }
  },
  "settings": {"executionOrder": "v1"},
  "meta": {"templateCredsSetupCompleted": true},
  "pinData": {}
}
JSON

cat > "$temporary/parent.json" <<'JSON'
{
  "id": "phase7fDisposableParent",
  "name": "Phase 7F Disposable Parent",
  "active": false,
  "nodes": [
    {
      "parameters": {},
      "id": "phase7f-disposable-parent-trigger",
      "name": "Manual Disposable Trigger",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {
        "source": "database",
        "workflowId": {
          "__rl": true,
          "value": "phase7fDisposableDispatcher",
          "mode": "id"
        },
        "mode": "each",
        "options": {"waitForSubWorkflow": true}
      },
      "id": "phase7f-disposable-parent-call",
      "name": "Call Fixed Disposable Dispatcher",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1.3,
      "position": [240, 0]
    }
  ],
  "connections": {
    "Manual Disposable Trigger": {
      "main": [[{"node": "Call Fixed Disposable Dispatcher", "type": "main", "index": 0}]]
    }
  },
  "settings": {"executionOrder": "v1"},
  "meta": {"templateCredsSetupCompleted": true},
  "pinData": {}
}
JSON

for file in dispatcher parent; do
  remote="/home/node/phase7f-$file.json"
  docker exec -i -u node "$n8n" sh -ec \
    'umask 077; cat > "$1"' sh "$remote" < "$temporary/$file.json"
  docker exec -u node "$n8n" n8n import:workflow \
    --input="$remote" --activeState=false >/dev/null
  docker exec -u node "$n8n" rm -f "$remote"
done

sql() {
  docker exec "$postgres" psql -U postgres -d n8n_phase7f_dispatch \
    -X -v ON_ERROR_STOP=1 -At -c "$1"
}

test "$(sql "
  SELECT count(*) FROM workflow_entity
   WHERE id IN ('$parent_id','$dispatcher_id') AND active IS FALSE;
")" = 2

if docker exec -u node "$n8n" n8n execute --id="$parent_id" --rawOutput \
  > "$temporary/inactive-child.log" 2>&1
then
  echo 'inactive dispatcher unexpectedly accepted a parent call' >&2
  exit 1
fi
grep -q 'Workflow is not active and cannot be executed' \
  "$temporary/inactive-child.log"

docker exec -u node "$n8n" n8n publish:workflow --id="$dispatcher_id" \
  > "$temporary/publish.log"
test "$(sql "
  SELECT count(*) FROM workflow_entity
   WHERE id='$dispatcher_id' AND active IS TRUE;
")" = 1
test "$(sql "
  SELECT count(*) FROM workflow_entity
   WHERE id='$parent_id' AND active IS FALSE;
")" = 1

docker exec -u node "$n8n" n8n execute --id="$parent_id" --rawOutput \
  > "$temporary/published-child.log"
grep -q '"bounded_dispatch": true' "$temporary/published-child.log"

docker exec -u node "$n8n" n8n unpublish:workflow --id="$dispatcher_id" \
  > "$temporary/unpublish.log"
test "$(sql "
  SELECT count(*) FROM workflow_entity
   WHERE id IN ('$parent_id','$dispatcher_id') AND active IS FALSE;
")" = 2

echo 'PASS: pinned n8n refused the inactive child, accepted only the bounded published-child window, and returned both workflows inactive.'
