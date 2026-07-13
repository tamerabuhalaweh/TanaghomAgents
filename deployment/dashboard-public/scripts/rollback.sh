#!/bin/sh
set -eu

ROOT=/opt/tanaghom-dashboard
BASE=$ROOT/deployment/dashboard-canary/docker-compose.yml
NGINX_TARGET=/etc/nginx/conf.d/tanaghom-public.conf

test "$(id -u)" -eq 0
rm -f "$NGINX_TARGET"
nginx -t
systemctl reload nginx
docker compose -p tanaghom-dashboard-canary -f "$BASE" up -d --no-deps dashboard
i=0
until test "$(docker inspect -f '{{.State.Health.Status}}' tanaghom-dashboard-canary-dashboard-1)" = healthy; do
  i=$((i + 1)); test "$i" -lt 36 || exit 75; sleep 5
done
rm -f /var/lib/tanaghom-public/deployed
echo "Tanaghom public ingress removed; private dashboard canary restored."
