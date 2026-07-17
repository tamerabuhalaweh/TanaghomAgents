#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
image='docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd'
postgres_image='postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'
workflow_id=phase5gQualityShadowEvaluatorV1
port=${N8N_SHADOW_TEST_POSTGRES_PORT:-55444}
postgres_container="tanaghom-shadow-pg-$$"
temporary=$(mktemp -d)

# GitHub's Linux runner creates mktemp directories as 0700. The pinned n8n
# image runs as a non-root user, so authorize only the disposable export file
# instead of making the whole evidence directory writable.
chmod 0755 "$temporary"
touch "$temporary/workflows.json"
chmod 0666 "$temporary/workflows.json"

case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) host=host.docker.internal ;; *) host=127.0.0.1 ;; esac

cleanup() {
  docker rm -f "$postgres_container" >/dev/null 2>&1 || true
  rm -rf -- "$temporary"
}
trap cleanup EXIT HUP INT TERM

docker run -d --name "$postgres_container" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=n8n_shadow_test -p "$port:5432" "$postgres_image" >/dev/null
attempt=0
until docker exec "$postgres_container" pg_isready -U postgres -d n8n_shadow_test >/dev/null 2>&1; do
  attempt=$((attempt + 1)); test "$attempt" -lt 30 || { echo 'disposable n8n PostgreSQL timeout' >&2; exit 1; }; sleep 1
done

run_n8n() {
  docker run --rm --network host \
    -e N8N_ENCRYPTION_KEY=integration-only-encryption-key-32 \
    -e DB_TYPE=postgresdb -e DB_POSTGRESDB_HOST="$host" -e DB_POSTGRESDB_PORT="$port" \
    -e DB_POSTGRESDB_DATABASE=n8n_shadow_test -e DB_POSTGRESDB_USER=postgres -e DB_POSTGRESDB_PASSWORD=postgres \
    -e N8N_DIAGNOSTICS_ENABLED=false \
    -v "$root/n8n/workflows/phase5g:/fixtures:ro" -v "$temporary:/evidence" "$image" "$@"
}

run_n8n_checked() {
  label=$1
  shift
  log="$temporary/$label.log"
  if ! run_n8n "$@" >"$log" 2>&1; then
    echo "FAIL: pinned n8n command '$label' failed" >&2
    cat "$log" >&2
    exit 1
  fi
}

echo 'TEST: initialize the disposable pinned n8n database'
run_n8n_checked initialize list:workflow --onlyId
test "$(docker exec "$postgres_container" psql -U postgres -d n8n_shadow_test -X -At -c "SELECT count(*) FROM workflow_entity WHERE id='$workflow_id';")" = 0
echo 'TEST: import the shadow evaluator inactive'
run_n8n_checked import import:workflow --input=/fixtures/quality-shadow-evaluator.v1.json --activeState=false
test "$(docker exec "$postgres_container" psql -U postgres -d n8n_shadow_test -X -At -c "SELECT count(*) FROM workflow_entity WHERE id='$workflow_id' AND active IS FALSE;")" = 1
test "$(docker exec "$postgres_container" psql -U postgres -d n8n_shadow_test -X -At -c "SELECT count(*) FROM execution_entity WHERE \"workflowId\"='$workflow_id';")" = 0
echo 'TEST: export and inspect the inactive workflow'
run_n8n_checked export export:workflow --all --pretty --output=/evidence/workflows.json
python3 -c 'import json,sys; rows=json.load(open(sys.argv[1],encoding="utf-8")); assert len([row for row in rows if row.get("id")==sys.argv[2] and row.get("active") is False])==1' "$temporary/workflows.json" "$workflow_id"
echo 'TEST: run the pinned n8n security audit'
if ! run_n8n audit >"$temporary/audit.txt" 2>&1; then
  echo "FAIL: pinned n8n command 'audit' failed" >&2
  cat "$temporary/audit.txt" >&2
  exit 1
fi
test -s "$temporary/audit.txt"
docker exec "$postgres_container" psql -U postgres -d n8n_shadow_test -X -v ON_ERROR_STOP=1 -c "DELETE FROM workflow_entity WHERE id='$workflow_id' AND active IS FALSE;" >/dev/null
test "$(docker exec "$postgres_container" psql -U postgres -d n8n_shadow_test -X -At -c "SELECT count(*) FROM workflow_entity WHERE id='$workflow_id';")" = 0

echo 'PASS: pinned n8n imported, audited, and transactionally removed exactly one inactive zero-execution shadow workflow.'
