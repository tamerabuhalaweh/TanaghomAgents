#!/bin/sh
set -eu

: "${TANAGHOM_PUBLIC_DOMAIN:?TANAGHOM_PUBLIC_DOMAIN must be set to the dashboard hostname}"
: "${TANAGHOM_POSTIZ_DOMAIN:?TANAGHOM_POSTIZ_DOMAIN must be set to the Postiz hostname}"

case "$TANAGHOM_PUBLIC_DOMAIN" in
  localhost|127.*|0.0.0.0|"")
    echo "refusing to start Caddy without a public domain (got '$TANAGHOM_PUBLIC_DOMAIN')" >&2
    exit 1
    ;;
  *.invalid|*.example|example.com|example.org)
    echo "refusing to start Caddy with a placeholder domain ('$TANAGHOM_PUBLIC_DOMAIN')" >&2
    exit 1
    ;;
esac

case "$TANAGHOM_PUBLIC_DOMAIN" in
  *.*) ;;
  *)
    echo "TANAGHOM_PUBLIC_DOMAIN must be a fully qualified hostname" >&2
    exit 1
    ;;
esac

if [ -n "${TANAGHOM_ACME_EMAIL:-}" ]; then
  case "$TANAGHOM_ACME_EMAIL" in
    *@*.*) ;;
    *)
      echo "TANAGHOM_ACME_EMAIL is not a valid email address" >&2
      exit 1
      ;;
  esac
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
