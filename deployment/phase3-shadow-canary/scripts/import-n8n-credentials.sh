#!/bin/sh
set -eu

test "$#" -eq 4 || {
  echo "usage: import-n8n-credentials.sh DB_HOST DB_NAME DB_USER GEMMA_KEY_FILE < db-password" >&2
  exit 64
}
DB_HOST=$1
DB_NAME=$2
DB_USER=$3
GEMMA_KEY_FILE=$4
N8N_CONTAINER=${N8N_CONTAINER:-smartlabs-n8n-n8n-1}
test -r "$GEMMA_KEY_FILE"

umask 077
secret_input=$(mktemp)
credential_json=$(mktemp)
cleanup() {
  rm -f "$secret_input" "$credential_json"
  docker exec "$N8N_CONTAINER" rm -f /tmp/tanaghom-credentials.json >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
IFS= read -r db_password
printf '%s\n' "$db_password" > "$secret_input"
unset db_password

python3 - "$credential_json" "$secret_input" "$GEMMA_KEY_FILE" "$DB_HOST" "$DB_NAME" "$DB_USER" <<'PY'
import json, pathlib, sys
output, password_file, gemma_file, host, database, user = sys.argv[1:]
password = pathlib.Path(password_file).read_text().rstrip('\n')
gemma = pathlib.Path(gemma_file).read_text().strip()
if not password or not gemma:
    raise SystemExit('credential source was empty')
credentials = [
    {
        'id': '62000000-0000-4000-8000-000000000001',
        'name': 'Tanaghom Worker PostgreSQL',
        'type': 'postgres',
        'data': {
            'host': host,
            'database': database,
            'user': user,
            'password': password,
            'port': 5432,
            'maxConnections': 4,
            'allowUnauthorizedCerts': False,
            'ssl': 'require',
        },
    },
    {
        'id': '62000000-0000-4000-8000-000000000002',
        'name': 'Tanaghom Gemma API',
        'type': 'httpHeaderAuth',
        'data': {'name': 'Authorization', 'value': f'Bearer {gemma}'},
    },
]
pathlib.Path(output).write_text(json.dumps(credentials))
PY

docker cp "$credential_json" "$N8N_CONTAINER:/tmp/tanaghom-credentials.json" >/dev/null
docker exec --user node "$N8N_CONTAINER" n8n import:credentials --input=/tmp/tanaghom-credentials.json
docker exec "$N8N_CONTAINER" rm -f /tmp/tanaghom-credentials.json
echo "Encrypted n8n credentials imported; plaintext staging files removed."
