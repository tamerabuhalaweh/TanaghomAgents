#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
image='docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd'
postgres_image='postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'
workflow_id=phase5ConversationIntelligenceV1
credential_id=62000000-0000-4000-8000-000000000005
port=${N8N_CONVERSATION_RELEASE_TEST_PORT:-55446}
postgres_container="tanaghom-conversation-release-pg-$$"
n8n_container="tanaghom-conversation-release-n8n-$$"
temporary=$(mktemp -d)
chmod 0755 "$temporary"

cleanup() {
  docker rm -f "$n8n_container" >/dev/null 2>&1 || true
  docker rm -f "$postgres_container" >/dev/null 2>&1 || true
  rm -rf -- "$temporary"
}
trap cleanup EXIT HUP INT TERM

cat > "$temporary/credential.json" <<'JSON'
[{"id":"62000000-0000-4000-8000-000000000005","name":"Tanaghom Conversation PostgreSQL","type":"postgres","data":{"host":"database.example.test","database":"postgres","user":"tanaghom_conversation_runtime.project","password":"disposable-only","port":5432,"maxConnections":4,"allowUnauthorizedCerts":false,"ssl":"require"}}]
JSON
chmod 0644 "$temporary/credential.json"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) host=host.docker.internal ;; *) host=127.0.0.1 ;; esac

docker run -d --name "$postgres_container" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=n8n_conversation_release_test -p "$port:5432" "$postgres_image" >/dev/null
attempt=0
until docker exec "$postgres_container" pg_isready -U postgres -d n8n_conversation_release_test >/dev/null 2>&1; do
  attempt=$((attempt + 1)); test "$attempt" -lt 30 || { echo 'disposable n8n PostgreSQL timeout' >&2; exit 1; }; sleep 1
done

docker run -d --name "$n8n_container" --network host \
  -e N8N_ENCRYPTION_KEY=integration-only-encryption-key-32 \
  -e DB_TYPE=postgresdb -e DB_POSTGRESDB_HOST="$host" -e DB_POSTGRESDB_PORT="$port" \
  -e DB_POSTGRESDB_DATABASE=n8n_conversation_release_test -e DB_POSTGRESDB_USER=postgres -e DB_POSTGRESDB_PASSWORD=postgres \
  -e N8N_DIAGNOSTICS_ENABLED=false --entrypoint sh "$image" -c 'exec sleep 300' >/dev/null

docker exec -u node "$n8n_container" n8n list:workflow --onlyId >/dev/null
credential_remote=/home/node/conversation-credential.json
workflow_remote=/home/node/conversation-workflow.json
docker cp "$temporary/credential.json" "$n8n_container:$credential_remote" >/dev/null
docker exec -u root "$n8n_container" chown node:node "$credential_remote"
docker exec -u root "$n8n_container" chmod 0400 "$credential_remote"
docker exec -u node "$n8n_container" test -r "$credential_remote"
docker exec -u node "$n8n_container" n8n import:credentials --input="$credential_remote" >/dev/null
docker exec -u node "$n8n_container" rm -f "$credential_remote"
docker cp "$root/n8n/workflows/phase5/conversation-intelligence.v1.json" "$n8n_container:$workflow_remote" >/dev/null
docker exec -u root "$n8n_container" chmod 0444 "$workflow_remote"
docker exec -u node "$n8n_container" n8n import:workflow --input="$workflow_remote" --activeState=false >/dev/null
docker exec -u node "$n8n_container" rm -f "$workflow_remote"

sql() { docker exec "$postgres_container" psql -U postgres -d n8n_conversation_release_test -X -At -c "$1"; }
test "$(sql "SELECT count(*) FROM credentials_entity WHERE id='$credential_id' AND type='postgres';")" = 1
test "$(sql "SELECT count(*) FROM workflow_entity WHERE id='$workflow_id' AND active IS FALSE;")" = 1
test "$(sql "SELECT count(*) FROM execution_entity WHERE \"workflowId\"='$workflow_id';")" = 0
docker exec -u node "$n8n_container" n8n audit > "$temporary/audit.txt"
test -s "$temporary/audit.txt"

docker exec "$postgres_container" psql -U postgres -d n8n_conversation_release_test -X -v ON_ERROR_STOP=1 -c \
  "BEGIN; DELETE FROM workflow_entity WHERE id='$workflow_id' AND active IS FALSE; DELETE FROM shared_credentials WHERE \"credentialsId\"='$credential_id'; DELETE FROM credentials_entity WHERE id='$credential_id'; COMMIT;" >/dev/null
test "$(sql "SELECT count(*) FROM workflow_entity WHERE id='$workflow_id';")" = 0
test "$(sql "SELECT count(*) FROM credentials_entity WHERE id='$credential_id';")" = 0
test "$(sql "SELECT count(*) FROM shared_credentials WHERE \"credentialsId\"='$credential_id';")" = 0

echo 'PASS: pinned n8n imported one encrypted credential and one inactive zero-execution workflow, audited them, and removed only package-owned rows.'
