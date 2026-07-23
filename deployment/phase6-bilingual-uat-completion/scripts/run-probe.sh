#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_bilingual_environment
evidence=$1
test -d "$evidence" || die 'probe evidence directory is missing'
test ! -e "$evidence/probe-result.env" || die 'probe already completed'

request="$evidence/probe-request.json"
response="$evidence/probe-response.json"
claimed="$evidence/probe-claimed.json"
before_pid=$(systemctl show "$GEMMA_UNIT" -p MainPID --value)
before_started=$(systemctl show "$GEMMA_UNIT" -p ExecMainStartTimestamp --value)
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

url=$(database_url)
PGAPPNAME=tanaghom-bilingual-probe psql "$url" -X -v ON_ERROR_STOP=1 -At -c "
  SELECT jsonb_build_object('job_id',job.id,'input',job.input)::text
  FROM tanaghom.agent_jobs job
  JOIN tanaghom.campaigns campaign ON campaign.id=job.campaign_id
  WHERE campaign.name='.test English Core-Agent UAT 2026-07-23'
    AND job.job_type='campaign.strategy.generate'
    AND job.status='failed'
    AND job.attempt=job.max_attempts
    AND job.error_code='gemma_http_error';
" >"$claimed"
unset url
test -s "$claimed" || die 'English probe source job is missing'
node "$SCRIPT_DIR/probe-contract.mjs" build "$STRATEGIST_SOURCE" "$claimed" "$request"
chmod 0600 "$claimed" "$request"

key=$(cat "$GEMMA_KEY")
http_status=$(curl -sS --max-time 240 -o "$response" -w '%{http_code}' \
  -H "Authorization: Bearer $key" \
  -H 'Content-Type: application/json' \
  --data-binary "@$request" \
  https://api.thesmartlabs.net/gemma4/v1/chat/completions)
unset key
printf '%s\n' "$http_status" >"$evidence/probe-http-status"
chmod 0600 "$response" "$evidence/probe-http-status"
test "$http_status" = 200 || die "Gemma probe returned HTTP $http_status"
node "$SCRIPT_DIR/probe-contract.mjs" validate "$response"

after_pid=$(systemctl show "$GEMMA_UNIT" -p MainPID --value)
after_started=$(systemctl show "$GEMMA_UNIT" -p ExecMainStartTimestamp --value)
test "$(systemctl is-active "$GEMMA_UNIT")" = active ||
  die 'Gemma became inactive during the probe'
test "$after_pid" = "$before_pid" || die 'Gemma process changed during the probe'
test "$after_started" = "$before_started" ||
  die 'Gemma start time changed during the probe'
if journalctl -u "$GEMMA_UNIT" --since "$started_at" --no-pager |
  grep -Eqi 'minProperties is greater|EngineCore.*failed|fatal error|engine core.*died'
then
  die 'Gemma/xgrammar fatal log occurred during the corrected probe'
fi

completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat >"$evidence/probe-result.env" <<EOF
PROBE_STARTED_AT=$started_at
PROBE_COMPLETED_AT=$completed_at
HTTP_STATUS=$http_status
GEMMA_PID=$after_pid
GEMMA_STARTED=$after_started
RESULT=passed
EOF
chmod 0600 "$evidence/probe-result.env"
echo 'PASS: corrected Gemma probe passed without an engine restart.'
