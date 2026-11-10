#!/bin/bash
# Creates the customer organization, its brand kit, and its owner account, then
# archives the synthetic demo fixtures. Idempotent: re-running updates the same
# organization, owner, and brand kit instead of creating duplicates.
#
# Required:
#   ONBOARD_ORGANIZATION_NAME, ONBOARD_ORGANIZATION_SLUG, ONBOARD_OWNER_EMAIL,
#   ONBOARD_BRAND_VOICE_AR, ONBOARD_BRAND_VOICE_EN, TANAGHOM_DEMO_SECRETS_DIR
# Optional:
#   ONBOARD_OWNER_NAME, ONBOARD_BRAND_LOGO_URL, ONBOARD_BRAND_COLORS,
#   ONBOARD_BRAND_TONE, ONBOARD_BRAND_KIT_NAME, ONBOARD_BRAND_TYPOGRAPHY,
#   ONBOARD_BRAND_ARABIC_FONT, ONBOARD_BRAND_LATIN_FONT, ONBOARD_BRAND_CTA,
#   ONBOARD_BRAND_CHANNELS, ONBOARD_RETIRE_DEMO (default 1),
#   TANAGHOM_DEMO_ROOT (default /home/ubuntu/tanaghom-demo)
set -euo pipefail

cd "$(dirname "$0")/.."
compose=(docker compose -p tanaghom-dashboard-demo -f compose.yml)
[ -f .env ] && compose+=(--env-file .env)
: "${TANAGHOM_DEMO_SECRETS_DIR:?set TANAGHOM_DEMO_SECRETS_DIR}"
export TANAGHOM_DEMO_SECRETS_DIR
root="${TANAGHOM_DEMO_ROOT:-/home/ubuntu/tanaghom-demo}"

name="${ONBOARD_ORGANIZATION_NAME:?set ONBOARD_ORGANIZATION_NAME}"
slug="${ONBOARD_ORGANIZATION_SLUG:?set ONBOARD_ORGANIZATION_SLUG}"
owner_email="${ONBOARD_OWNER_EMAIL:?set ONBOARD_OWNER_EMAIL}"
voice_ar="${ONBOARD_BRAND_VOICE_AR:?set ONBOARD_BRAND_VOICE_AR}"
voice_en="${ONBOARD_BRAND_VOICE_EN:?set ONBOARD_BRAND_VOICE_EN}"
owner_name="${ONBOARD_OWNER_NAME:-$name owner}"
kit_name="${ONBOARD_BRAND_KIT_NAME:-$name Brand}"
logo="${ONBOARD_BRAND_LOGO_URL:-}"
retire_demo="${ONBOARD_RETIRE_DEMO:-1}"

owner_email="$(printf '%s' "$owner_email" | tr '[:upper:]' '[:lower:]')"

[[ "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "slug must be lowercase words separated by single hyphens" >&2; exit 1; }
[[ "$owner_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { echo "owner email is not valid" >&2; exit 1; }
[ "${#name}" -ge 2 ] && [ "${#name}" -le 120 ] || { echo "organization name must be 2-120 characters" >&2; exit 1; }
[ "${#voice_ar}" -ge 10 ] && [ "${#voice_en}" -ge 10 ] || { echo "Arabic and English brand voice are required" >&2; exit 1; }
if [ -n "$logo" ]; then
  case "$logo" in
    https://*|brand/*) ;;
    *) echo "logo must be an https URL or a brand/ object key" >&2; exit 1 ;;
  esac
fi

command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }

colors="${ONBOARD_BRAND_COLORS:-}"
[ -n "$colors" ] || colors='{"primary":"#0f766e","secondary":"#f8fafc","accent":"#e2e8f0"}'
typography="${ONBOARD_BRAND_TYPOGRAPHY:-}"
[ -n "$typography" ] || typography='{"heading":"Inter","body":"Inter"}'
cta="${ONBOARD_BRAND_CTA:-}"
[ -n "$cta" ] || cta='{"default":"Learn more"}'
channels="${ONBOARD_BRAND_CHANNELS:-}"
[ -n "$channels" ] || channels='{"instagram":true}'
arabic_font="${ONBOARD_BRAND_ARABIC_FONT:-Noto Kufi Arabic}"
latin_font="${ONBOARD_BRAND_LATIN_FONT:-Inter}"
tone="${ONBOARD_BRAND_TONE:-Warm, credible, and practical in Arabic and English.}"

for pair in "colors:$colors" "typography:$typography" "cta:$cta" "channels:$channels"; do
  key="${pair%%:*}"
  value="${pair#*:}"
  python3 -c 'import json,sys
value=json.loads(sys.argv[1])
assert isinstance(value, dict) and value, "expected a non-empty object"' "$value" ||
    { echo "$key must be a non-empty JSON object" >&2; exit 1; }
done

if [ -n "$logo" ]; then
  logos="$(python3 -c 'import json,sys; print(json.dumps({"primary": sys.argv[1]}))' "$logo")"
else
  logos='{}'
fi
rules="$(python3 - "$voice_ar" "$voice_en" <<'PY'
import json
import sys
print(json.dumps({
    "voice": {"ar": sys.argv[1], "en": sys.argv[2]},
    "do": [],
    "avoid": [],
}, ensure_ascii=False))
PY
)"

"${compose[@]}" ps -q auth | grep -q . || { echo "auth service is not running; deploy the stack first" >&2; exit 1; }

owner_password="$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-28)"
[ "${#owner_password}" -ge 12 ] || { echo "password generation failed" >&2; exit 1; }

admin_output="$(printf '%s\n' "$owner_password" | "${compose[@]}" exec -T auth node /app/admin.mjs upsert \
  --email "$owner_email" --name "$owner_name" --stdin-password)"
owner_sub="$(printf '%s\n' "$admin_output" | sed -n 's/^SUB=//p')"
[[ "$owner_sub" =~ ^[0-9a-f-]{36}$ ]] || { echo "auth service did not return an account subject" >&2; exit 1; }

sql_file="$(mktemp)"
trap 'rm -f "$sql_file"' EXIT

cat > "$sql_file" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO tanaghom.organizations (slug, name) VALUES (:'slug', :'name')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
RETURNING id AS org_id \gset

INSERT INTO tanaghom.app_users (email, display_name, kind, role, auth_subject, organization_id, accepted_at)
VALUES (:'owner_email', :'owner_name', 'human', 'owner', :'owner_sub'::uuid, :'org_id'::uuid, now())
ON CONFLICT (email) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = 'owner',
  auth_subject = EXCLUDED.auth_subject,
  organization_id = EXCLUDED.organization_id,
  is_active = true,
  accepted_at = coalesce(tanaghom.app_users.accepted_at, now())
RETURNING id AS owner_id \gset

SELECT count(*) AS kit_count FROM tanaghom.brand_kits WHERE organization_id = :'org_id' \gset

\if :kit_count
\echo ONBOARD_BRAND_KIT existing
\else
SELECT tanaghom.create_brand_kit(
  :'owner_id'::uuid, :'kit_name', :'colors'::jsonb, :'typography'::jsonb,
  :'arabic_font', :'latin_font', :'logos'::jsonb, :'tone', :'rules'::jsonb,
  :'cta'::jsonb, :'channels'::jsonb
) AS kit_id \gset
\echo ONBOARD_BRAND_KIT :kit_id
\endif

INSERT INTO tanaghom.agent_actions_log
  (correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result)
VALUES
  (gen_random_uuid(), :'owner_id'::uuid, 'organization.onboarded', 'organization', :'org_id'::uuid,
   jsonb_build_object(
     'slug', :'slug',
     'brand_kit_created', (SELECT count(*) = 0 FROM tanaghom.brand_kits WHERE organization_id = :'org_id'::uuid),
     'source', 'onboard-organization.sh'
   ), 'success');

-- Archive the synthetic demo campaign and deactivate its accounts. Rows stay in
-- place for audit continuity, but no customer view or login can reach them.
UPDATE tanaghom.campaigns
   SET status = 'closed',
       blocked_reason = 'Archived synthetic demo fixture; not a customer campaign.'
 WHERE organization_id = '10000000-0000-4000-8000-000000000001'
   AND name = 'Demo Summer Camp'
   AND status <> 'closed';
\echo ONBOARD_DEMO_CAMPAIGNS_ARCHIVED :ROW_COUNT

UPDATE tanaghom.app_users
   SET is_active = false, auth_subject = NULL
 WHERE organization_id = '10000000-0000-4000-8000-000000000001'
   AND email IN ('owner@demo.tanaghom.test', 'reviewer@demo.tanaghom.test');

COMMIT;

\echo ONBOARD_ORG :org_id
\echo ONBOARD_OWNER :owner_id
SQL

sql_output="$("${compose[@]}" exec -T postgres psql -U postgres -d tanaghom_demo \
  -v ON_ERROR_STOP=1 \
  -v slug="$slug" \
  -v name="$name" \
  -v owner_email="$owner_email" \
  -v owner_name="$owner_name" \
  -v owner_sub="$owner_sub" \
  -v kit_name="$kit_name" \
  -v colors="$colors" \
  -v typography="$typography" \
  -v arabic_font="$arabic_font" \
  -v latin_font="$latin_font" \
  -v logos="$logos" \
  -v tone="$tone" \
  -v rules="$rules" \
  -v cta="$cta" \
  -v channels="$channels" \
  < "$sql_file")"

printf '%s\n' "$sql_output"

if [ "$retire_demo" = "1" ]; then
  for email in owner@demo.tanaghom.test reviewer@demo.tanaghom.test; do
    "${compose[@]}" exec -T auth node /app/admin.mjs disable --email "$email" >/dev/null 2>&1 || true
  done
  seed="$TANAGHOM_DEMO_SECRETS_DIR/auth_users.json"
  if [ -f "$seed" ]; then
    chmod 0600 "$seed"
    printf '{"users":[]}\n' > "$seed"
    chmod 0444 "$seed"
  fi
  rm -f "$TANAGHOM_DEMO_SECRETS_DIR/demo-credentials.txt"
  echo "DEMO_CREDENTIALS_RETIRED"
fi

credentials_dir="$root/runtime/credentials"
mkdir -p "$credentials_dir"
chmod 0700 "$credentials_dir"
credentials_file="$credentials_dir/${slug}-owner.txt"
umask 077
{
  printf 'Tanaghom owner account for %s\n\n' "$name"
  printf 'Email: %s\n' "$owner_email"
  printf 'Temporary password: %s\n\n' "$owner_password"
  printf 'The account must choose a new password after the first sign-in.\n'
} > "$credentials_file"
chmod 0600 "$credentials_file"

echo "ONBOARD_CREDENTIALS_FILE $credentials_file"
echo "ONBOARD_ORGANIZATION_SLUG $slug"
echo "ONBOARD_OWNER_EMAIL $owner_email"
echo "ONBOARD_COMPLETE"
