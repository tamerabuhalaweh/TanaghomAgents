# Controlled deployment and rollback

Run from `/opt/n8n-smartlabs` as the authorized administrator. Preserve the
base Compose file; this package is an additive override. Never run a Compose
command for n8n without both `-f` arguments after the package is installed.

## Preflight and deployment

```sh
docker compose -f docker-compose.yml \
  -f phase3-shadow-canary/docker-compose.database-egress.yml config --quiet
ip -4 route | grep -F '172.30.252.0/29' && exit 1 || true
docker compose -f docker-compose.yml \
  -f phase3-shadow-canary/docker-compose.database-egress.yml pull
docker network create \
  --driver bridge \
  --opt com.docker.network.bridge.name=br-tan-n8n-db \
  --subnet 172.30.252.0/29 tanaghom-n8n-database-egress
TANAGHOM_FIREWALL_CHANGE_AUTHORIZED=YES-I-AM-THE-AUTHORIZED-OWNER \
  ./phase3-shadow-canary/scripts/install-database-firewall.sh
docker compose -f docker-compose.yml \
  -f phase3-shadow-canary/docker-compose.database-egress.yml \
  up -d --no-deps n8n n8n-worker
docker compose -f docker-compose.yml \
  -f phase3-shadow-canary/docker-compose.database-egress.yml \
  ps n8n n8n-worker
./phase3-shadow-canary/scripts/validate-database-egress.sh
```

Create `tanaghom_n8n_runtime` with a newly generated password through the
operator database connection, then validate the login by sending the password
over stdin:

```sh
./phase3-shadow-canary/scripts/validate-runtime-login.sh \
  aws-1-ap-south-1.pooler.supabase.com postgres \
  tanaghom_n8n_runtime.gvyldxhhynusmnrllxjj \
  ./phase3-shadow-canary/certificates/supabase-root-2021-ca.pem
```

Rotate Gemma before import because the previous token was exposed during
process inspection. The script contains a service rollback trap and prints no
secret:

```sh
sudo ./phase3-shadow-canary/scripts/rotate-gemma-key.sh
./phase3-shadow-canary/scripts/import-n8n-credentials.sh \
  aws-1-ap-south-1.pooler.supabase.com postgres \
  tanaghom_n8n_runtime.gvyldxhhynusmnrllxjj \
  /etc/smartlabs/gemma4_canary_api_key
```

Both workflow exports must be imported with `active=false`. Use manual CLI or
editor execution only. Do not activate either schedule trigger.

## Firewall refresh after pooler DNS changes

This is a controlled stop-replace-validate operation, not an in-place chain
edit. Stop only n8n main and worker, remove the package chain, reinstall it from
fresh public A records, run the socket validation, and restart only after it
passes. If validation fails, leave n8n stopped and run rollback below.

```sh
docker compose -f docker-compose.yml \
  -f phase3-shadow-canary/docker-compose.database-egress.yml stop n8n n8n-worker
./phase3-shadow-canary/scripts/rollback-database-firewall.sh
TANAGHOM_FIREWALL_CHANGE_AUTHORIZED=YES-I-AM-THE-AUTHORIZED-OWNER \
  ./phase3-shadow-canary/scripts/install-database-firewall.sh
docker compose -f docker-compose.yml \
  -f phase3-shadow-canary/docker-compose.database-egress.yml start n8n n8n-worker
./phase3-shadow-canary/scripts/validate-database-egress.sh
```

## Exact rollback

This removes only package-owned firewall state and the package network. The
five-container n8n stack remains otherwise intact and its persistent volumes
are not deleted.

```sh
cd /opt/n8n-smartlabs
docker compose -f docker-compose.yml \
  -f phase3-shadow-canary/docker-compose.database-egress.yml stop n8n n8n-worker
./phase3-shadow-canary/scripts/rollback-database-firewall.sh
docker compose -f docker-compose.yml up -d --no-deps n8n n8n-worker
docker network rm tanaghom-n8n-database-egress
docker compose -f docker-compose.yml ps
```

Optionally revoke the runtime login after n8n is back on the base network:

```sql
REVOKE tanaghom_n8n_worker FROM tanaghom_n8n_runtime;
ALTER ROLE tanaghom_n8n_runtime NOLOGIN;
```
