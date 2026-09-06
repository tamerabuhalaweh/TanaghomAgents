#!/bin/sh
set -eu
export N8N_ENCRYPTION_KEY="$(cat /run/secrets/workspace_n8n_key)"
umask 077
credential="$(mktemp /tmp/workspace-credential.XXXXXX)"
trap 'rm -f "$credential"' EXIT HUP INT TERM
node /workspace/credential.cjs "$credential"
n8n import:credentials --input="$credential"
n8n import:workflow --input=/workspace-workflow.json
# Import never publishes or activates the schedule. Activation is a later gate.
