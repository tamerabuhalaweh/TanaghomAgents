#!/bin/sh
set -eu

test "$#" -eq 4 || {
  echo "usage: validate-runtime-login.sh HOST DATABASE USER CA_FILE < password" >&2
  exit 64
}
HOST=$1
DATABASE=$2
USER=$3
CA_FILE=$4
N8N_CONTAINER=${N8N_CONTAINER:-smartlabs-n8n-n8n-1}
POSTGRES_IMAGE='postgres:16.14-alpine3.24@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777'
test -r "$CA_FILE"

docker run --rm -i --network "container:$N8N_CONTAINER" \
  -v "$CA_FILE:/run/tanaghom/supabase-ca.pem:ro" \
  --entrypoint /bin/sh "$POSTGRES_IMAGE" -ec '
    IFS= read -r password
    export PGPASSWORD="$password"
    psql "host=$1 port=5432 dbname=$2 user=$3 sslmode=verify-full sslrootcert=/run/tanaghom/supabase-ca.pem" \
      -v ON_ERROR_STOP=1 -Atqc "
        SELECT current_user;
        SELECT has_function_privilege(current_user, '\''tanaghom.claim_agent_job(text,text[])'\'', '\''EXECUTE'\'');
        SELECT has_table_privilege(current_user, '\''tanaghom.content_approvals'\'', '\''SELECT,INSERT,UPDATE,DELETE'\'');
      "
    unset PGPASSWORD password
  ' validate-runtime "$HOST" "$DATABASE" "$USER"
echo "PASS: restricted runtime login connected with verified TLS and retains the approval boundary."
