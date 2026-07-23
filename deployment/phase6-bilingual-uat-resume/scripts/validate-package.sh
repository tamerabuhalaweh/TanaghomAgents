#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
for script in "$SCRIPT_DIR"/*.sh; do sh -n "$script"; done
node "$ROOT/scripts/validate-vllm-structured-output-schemas.mjs"
node --test \
  "$ROOT/tests/vllm-structured-output.test.mjs" \
  "$ROOT/tests/phase6-bilingual-uat-resume.test.mjs"
grep -q 'max_tokens: 4096' \
  "$ROOT/n8n/workflows/phase3/campaign-strategist.v1.json"
grep -q 'gemma_output_truncated' \
  "$ROOT/n8n/workflows/phase3/campaign-strategist.v1.json"
if grep -R -E 'systemctl (start|stop|restart)|docker compose (up|down)|iptables|nginx' \
  "$SCRIPT_DIR" --include='*.sh' --exclude='validate-package.sh'
then
  echo 'ERROR: package contains a prohibited service/network mutation' >&2
  exit 1
fi
echo 'PASS: bilingual Arabic-resume package is syntax- and boundary-valid.'
