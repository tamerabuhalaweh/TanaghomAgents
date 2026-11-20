#!/bin/sh
set -eu

: "${TANAGHOM_PUBLIC_DOMAIN:?TANAGHOM_PUBLIC_DOMAIN must be set to the dashboard hostname}"
: "${TANAGHOM_POSTIZ_DOMAIN:?TANAGHOM_POSTIZ_DOMAIN must be set to the Postiz hostname}"

validate_domain() {
  var_name="$1"
  domain="$2"
  case "$domain" in
    localhost|127.*|0.0.0.0|"")
      echo "refusing to start Caddy without a public domain for $var_name (got '$domain')" >&2
      exit 1
      ;;
    *.invalid|*.example|example.com|example.org)
      echo "refusing to start Caddy with a placeholder domain for $var_name ('$domain')" >&2
      exit 1
      ;;
    *[!a-zA-Z0-9.-]*|.*|*.)
      echo "refusing to start Caddy with an invalid domain for $var_name ('$domain')" >&2
      exit 1
      ;;
  esac

  case "$domain" in
    *.*) ;;
    *)
      echo "$var_name must be a fully qualified hostname" >&2
      exit 1
      ;;
  esac
}

validate_domain "TANAGHOM_PUBLIC_DOMAIN" "$TANAGHOM_PUBLIC_DOMAIN"
validate_domain "TANAGHOM_POSTIZ_DOMAIN" "$TANAGHOM_POSTIZ_DOMAIN"

if [ -n "${TANAGHOM_ACME_EMAIL:-}" ]; then
  case "$TANAGHOM_ACME_EMAIL" in
    *@*.*) ;;
    *)
      echo "TANAGHOM_ACME_EMAIL is not a valid email address" >&2
      exit 1
      ;;
  esac
fi

MARKETING_DOMAIN="${TANAGHOM_MARKETING_DOMAIN:-}"
APEX_DOMAIN="${TANAGHOM_APEX_DOMAIN:-}"

if [ -n "$APEX_DOMAIN" ] && [ -z "$MARKETING_DOMAIN" ]; then
  echo "refusing to start Caddy: TANAGHOM_APEX_DOMAIN requires TANAGHOM_MARKETING_DOMAIN" >&2
  exit 1
fi

if [ -n "$MARKETING_DOMAIN" ]; then
  validate_domain "TANAGHOM_MARKETING_DOMAIN" "$MARKETING_DOMAIN"
  if [ "$MARKETING_DOMAIN" = "$TANAGHOM_PUBLIC_DOMAIN" ] || [ "$MARKETING_DOMAIN" = "$TANAGHOM_POSTIZ_DOMAIN" ]; then
    echo "refusing to start Caddy: TANAGHOM_MARKETING_DOMAIN must be distinct from app and Postiz domains" >&2
    exit 1
  fi
fi

if [ -n "$APEX_DOMAIN" ]; then
  validate_domain "TANAGHOM_APEX_DOMAIN" "$APEX_DOMAIN"
  if [ "$APEX_DOMAIN" = "$MARKETING_DOMAIN" ] || [ "$APEX_DOMAIN" = "$TANAGHOM_PUBLIC_DOMAIN" ] || [ "$APEX_DOMAIN" = "$TANAGHOM_POSTIZ_DOMAIN" ]; then
    echo "refusing to start Caddy: TANAGHOM_APEX_DOMAIN must be distinct from marketing, app, and Postiz domains" >&2
    exit 1
  fi
fi

CONFIG_FILE="/etc/caddy/Caddyfile"
if [ -n "$MARKETING_DOMAIN" ]; then
  CONFIG_FILE="${CADDY_RENDERED_CONFIG:-/tmp/Caddyfile}"
  cat > "$CONFIG_FILE" <<'EOF'
{
	email {$TANAGHOM_ACME_EMAIL}
	admin off
	# Automatic HTTPS provisions and renews certificates from Let's Encrypt.
}

{$TANAGHOM_PUBLIC_DOMAIN} {
	encode zstd gzip

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "SAMEORIGIN"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		X-Robots-Tag "noindex, nofollow"
		-Server
	}

	@marketingCanonical path /pricing /privacy /terms
	redir @marketingCanonical https://{$TANAGHOM_MARKETING_DOMAIN}{uri} 301

	# The dashboard keeps its loopback-only binding; Caddy is the only public listener.
	reverse_proxy dashboard:3000 {
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-Host {host}
		# Replace, rather than append to, client-supplied forwarding headers.
		header_up X-Forwarded-For {remote_host}
	}
}

{$TANAGHOM_MARKETING_DOMAIN} {
	encode zstd gzip

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "SAMEORIGIN"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		-Server
	}

	@marketingPublic path / /pricing /privacy /terms /robots.txt /sitemap.xml /llms.txt /favicon.ico /google*.html /opengraph-image* /twitter-image* /_next/* /api/waitlist /api/csp-report /api/health
	handle @marketingPublic {
		reverse_proxy dashboard:3000 {
			header_up X-Forwarded-Proto {scheme}
			header_up X-Forwarded-Host {host}
			header_up X-Forwarded-For {remote_host}
		}
	}

	handle {
		redir https://{$TANAGHOM_PUBLIC_DOMAIN}{uri} 302
	}
}
EOF

  if [ -n "$APEX_DOMAIN" ]; then
    cat >> "$CONFIG_FILE" <<'EOF'

{$TANAGHOM_APEX_DOMAIN} {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		-Server
	}

	redir https://{$TANAGHOM_MARKETING_DOMAIN}{uri} 301
}
EOF
  fi

  cat >> "$CONFIG_FILE" <<'EOF'

{$TANAGHOM_POSTIZ_DOMAIN} {
	encode zstd gzip

	# Postiz provisions tenants through the database; its public self-signup
	# endpoint is not part of the Tanaghom contract.
	@postizRegister path /api/auth/register*
	respond @postizRegister 403

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		-Server
	}

	reverse_proxy postiz:5000 {
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-Host {host}
		# The auth service uses the rightmost address as the client IP.
		header_up X-Forwarded-For {remote_host}
	}
}
EOF
fi

if [ "${CADDY_ENTRYPOINT_RENDER_ONLY:-0}" = "1" ]; then
  exit 0
fi

exec caddy run --config "$CONFIG_FILE" --adapter caddyfile
