#!/bin/sh
set -eu
export N8N_ENCRYPTION_KEY="$(cat /run/secrets/workspace_n8n_key)"
exec n8n "$@"
