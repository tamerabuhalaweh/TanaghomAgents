#!/bin/sh
set -eu

source_dir="${1:-/home/administrator/tanaghom-dashboard-stage}"
target_dir=/opt/tanaghom-dashboard
package_dir="$target_dir/deployment/dashboard-canary"
project=tanaghom-dashboard-canary
committed=false

test "$(id -u)" -eq 0 || { echo "run this script with sudo" >&2; exit 1; }
test -d "$source_dir/.git" || { echo "staged Git source is missing" >&2; exit 1; }
test ! -e "$target_dir" || { echo "$target_dir already exists; use the reviewed update procedure" >&2; exit 1; }
test "$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 20 || { echo "less than 20 GiB is available" >&2; exit 1; }
! ss -H -ltn | awk '{print $4}' | grep -Eq '(^|:)3200$' || { echo "port 3200 is already in use" >&2; exit 1; }

for unit in \
  smartlabs-api.service convai-ws.service convai-stt-api.service \
  omnivoice-tts.service gemma4-26b-a4b-vllm-canary.service \
  smartcc-api.service smartcc-smartlabs-bridge.service smartcc-web.service nginx.service
do
  test "$(systemctl is-active "$unit")" = active || { echo "protected unit is not active: $unit" >&2; exit 1; }
done

docker info >/dev/null
docker network inspect "$project-outbound" >/dev/null 2>&1 && { echo "package network already exists" >&2; exit 1; } || true
docker network inspect $(docker network ls -q) > /tmp/tanaghom-dashboard-networks.json
python3 - /tmp/tanaghom-dashboard-networks.json <<'PY'
import ipaddress, json, sys
candidate = ipaddress.ip_network("172.30.251.0/29")
with open(sys.argv[1], encoding="utf-8") as source:
    networks = json.load(source)
for network in networks:
    for config in network.get("IPAM", {}).get("Config", []) or []:
        subnet = config.get("Subnet")
        if subnet and candidate.overlaps(ipaddress.ip_network(subnet)):
            raise SystemExit(f"candidate subnet overlaps {network['Name']}: {subnet}")
PY
rm -f /tmp/tanaghom-dashboard-networks.json

for secret in database_url supabase_url supabase_publishable_key supabase_jwks_url supabase_secret_key
do
  test -s "$source_dir/deployment/dashboard-canary/secrets/$secret" || { echo "required staged secret is missing: $secret" >&2; exit 1; }
done

cleanup() {
  if [ "$committed" != true ] && [ -d "$package_dir" ]; then
    cd "$package_dir"
    docker compose -p "$project" -f docker-compose.yml stop dashboard >/dev/null 2>&1 || true
    docker compose -p "$project" -f docker-compose.yml rm -f dashboard >/dev/null 2>&1 || true
  fi
  rm -f /tmp/tanaghom-dashboard-networks.json
}
trap cleanup EXIT HUP INT TERM

install -d -m 0755 "$target_dir"
cp -a "$source_dir/." "$target_dir/"
chown -R root:root "$target_dir"
chown root:1000 "$package_dir/secrets" "$package_dir"/secrets/database_url \
  "$package_dir"/secrets/supabase_url "$package_dir"/secrets/supabase_publishable_key \
  "$package_dir"/secrets/supabase_jwks_url "$package_dir"/secrets/supabase_secret_key
chmod 0710 "$package_dir/secrets"
chmod 0640 "$package_dir"/secrets/database_url "$package_dir"/secrets/supabase_url \
  "$package_dir"/secrets/supabase_publishable_key "$package_dir"/secrets/supabase_jwks_url
chmod 0640 "$package_dir"/secrets/supabase_secret_key

cd "$package_dir"
docker compose -p "$project" -f docker-compose.yml config --quiet
docker compose -p "$project" -f docker-compose.yml build --pull dashboard
docker compose -p "$project" -f docker-compose.yml up -d dashboard

attempt=0
until docker compose -p "$project" -f docker-compose.yml exec -T dashboard \
  node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
do
  attempt=$((attempt + 1))
  test "$attempt" -lt 12 || { echo "dashboard health gate failed" >&2; exit 1; }
  sleep 5
done

for unit in \
  smartlabs-api.service convai-ws.service convai-stt-api.service \
  omnivoice-tts.service gemma4-26b-a4b-vllm-canary.service \
  smartcc-api.service smartcc-smartlabs-bridge.service smartcc-web.service nginx.service
do
  test "$(systemctl is-active "$unit")" = active || { echo "protected unit changed state: $unit" >&2; exit 1; }
done

docker compose -p "$project" -f docker-compose.yml ps
docker image inspect tanaghom-dashboard-canary:canary --format 'image={{.Id}}'
git -C "$target_dir" rev-parse HEAD
committed=true
echo "Tanaghom dashboard private canary deployed successfully."
