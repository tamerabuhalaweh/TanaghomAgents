#!/bin/sh
set -eu

N8N_CONTAINER=${N8N_CONTAINER:-smartlabs-n8n-n8n-1}
POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-smartlabs-n8n-postgres-1}
CREDENTIAL_ID=62000000-0000-4000-8000-000000000004
CONTAINER_FILE=/home/node/.n8n/tanaghom-integration-gateway-credential.json

test "$(id -u)" -eq 0
existing="$(docker exec "$POSTGRES_CONTAINER" sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM credentials_entity WHERE id='"'"'62000000-0000-4000-8000-000000000004'"'"';"')"
test "$existing" = 0 || { echo "gateway credential already exists; refusing overwrite" >&2; exit 67; }

umask 077
token_file="$(mktemp)"
credential_json="$(mktemp)"
cleanup() {
  rm -f "$token_file" "$credential_json"
  docker exec --user node "$N8N_CONTAINER" rm -f "$CONTAINER_FILE" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
IFS= read -r token
token="$(printf %s "$token" | tr -d '\r')"
test "${#token}" -ge 32 || { echo "worker token is too short" >&2; exit 64; }
printf '%s' "$token" > "$token_file"
unset token

python3 - "$credential_json" "$token_file" <<'PY'
import json, pathlib, sys
output, token_file = sys.argv[1:]
token = pathlib.Path(token_file).read_text().strip()
credential = [{
    'id': '62000000-0000-4000-8000-000000000004',
    'name': 'Tanaghom Integration Gateway',
    'type': 'httpHeaderAuth',
    'data': {'name': 'Authorization', 'value': f'Bearer {token}'},
}]
pathlib.Path(output).write_text(json.dumps(credential))
PY

docker exec -i --user node "$N8N_CONTAINER" sh -ec \
  "umask 077; cat > '$CONTAINER_FILE'" < "$credential_json"
docker exec --user node "$N8N_CONTAINER" n8n import:credentials --input="$CONTAINER_FILE"
docker exec --user node "$N8N_CONTAINER" rm -f "$CONTAINER_FILE"

shape="$(docker exec "$POSTGRES_CONTAINER" sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|" -c "SELECT name,type FROM credentials_entity WHERE id='"'"'62000000-0000-4000-8000-000000000004'"'"';"')"
test "$shape" = "Tanaghom Integration Gateway|httpHeaderAuth"
echo "Encrypted Tanaghom gateway credential imported; plaintext files removed."
