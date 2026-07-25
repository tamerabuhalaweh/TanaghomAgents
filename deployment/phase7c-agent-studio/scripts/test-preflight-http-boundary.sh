#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

assert_predeployment_agent_studio_api_status 401
assert_predeployment_agent_studio_api_status 404

for denied in 000 200 302 500; do
  if (assert_predeployment_agent_studio_api_status "$denied") 2>/dev/null; then
    echo "ERROR: preflight accepted unsafe Agent Studio API status $denied" >&2
    exit 1
  fi
done

echo 'PASS: Phase 7C accepts only absent or authentication-closed pre-deployment Agent Studio API states.'
