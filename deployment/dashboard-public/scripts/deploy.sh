#!/bin/sh
set -eu

HOST=tanaghom.38-247-187-232.sslip.io
ROOT=/opt/tanaghom-dashboard
PACKAGE=$ROOT/deployment/dashboard-public
BASE=$ROOT/deployment/dashboard-canary/docker-compose.yml
OVERRIDE=$PACKAGE/docker-compose.yml
NGINX_TARGET=/etc/nginx/conf.d/tanaghom-public.conf
WEBROOT=/var/www/letsencrypt

test "${TANAGHOM_PUBLIC_DEPLOY_AUTHORIZED:-}" = "YES-I-AM-THE-AUTHORIZED-OWNER" || {
  echo "Refusing: explicit public-deployment authorization is absent." >&2
  exit 64
}
test -n "${LETSENCRYPT_EMAIL:-}" || { echo "LETSENCRYPT_EMAIL is required." >&2; exit 64; }
test "$(id -u)" -eq 0
test ! -e "$NGINX_TARGET" || { echo "Refusing: Tanaghom Nginx configuration already exists." >&2; exit 67; }
test ! -e /var/lib/tanaghom-public/deployed || { echo "Refusing: deployment marker already exists." >&2; exit 67; }
getent ahostsv4 "$HOST" | awk '{print $1}' | sort -u | grep -qx 38.247.187.232
test "$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 20

dashboard_changed=0
nginx_changed=0
committed=0
rollback_partial() {
  test "$committed" -eq 1 && return 0
  if test "$nginx_changed" -eq 1; then
    rm -f "$NGINX_TARGET"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  fi
  if test "$dashboard_changed" -eq 1; then
    docker compose -p tanaghom-dashboard-canary -f "$BASE" up -d --no-deps dashboard >/dev/null 2>&1 || true
  fi
}
trap rollback_partial EXIT
trap 'exit 70' HUP INT TERM

install -d -o root -g root -m 0755 "$WEBROOT/.well-known/acme-challenge"
install -o root -g root -m 0644 "$PACKAGE/nginx/tanaghom-bootstrap.conf" "$NGINX_TARGET"
nginx_changed=1
nginx -t
systemctl reload nginx

certbot certonly --webroot -w "$WEBROOT" -d "$HOST" \
  --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email --non-interactive
test -s "/etc/letsencrypt/live/$HOST/fullchain.pem"
test -s "/etc/letsencrypt/live/$HOST/privkey.pem"

docker compose -p tanaghom-dashboard-canary -f "$BASE" -f "$OVERRIDE" config --quiet
docker compose -p tanaghom-dashboard-canary -f "$BASE" -f "$OVERRIDE" up -d --no-deps dashboard
dashboard_changed=1
i=0
until test "$(docker inspect -f '{{.State.Health.Status}}' tanaghom-dashboard-canary-dashboard-1)" = healthy; do
  i=$((i + 1)); test "$i" -lt 36 || exit 75; sleep 5
done
test "$(docker exec tanaghom-dashboard-canary-dashboard-1 printenv APP_ENV)" = production
test "$(docker exec tanaghom-dashboard-canary-dashboard-1 printenv APP_BASE_URL)" = "https://$HOST"

install -o root -g root -m 0644 "$PACKAGE/nginx/tanaghom.conf" "$NGINX_TARGET"
nginx -t
systemctl reload nginx

i=0
until curl -fsS --resolve "$HOST:443:127.0.0.1" "https://$HOST/login" >/dev/null; do
  i=$((i + 1)); test "$i" -lt 15 || exit 76; sleep 1
done
test "$(curl -sS -o /dev/null -w '%{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST/")" = 307
test "$(curl -sS -o /dev/null -w '%{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST/api/operations")" = 401

install -d -o root -g root -m 0755 /var/lib/tanaghom-public
printf '%s\n' "$HOST" > /var/lib/tanaghom-public/deployed
chmod 0644 /var/lib/tanaghom-public/deployed
committed=1
trap - EXIT HUP INT TERM
echo "Tanaghom public HTTPS deployment committed: https://$HOST/"
