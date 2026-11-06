#!/bin/bash
# Operator wrapper for the isolated demo workspace control (#257/#259).
# It never prints secret material: the transaction only reads control rows and
# writes an audit row keyed by the operator-supplied change reference.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: workspace-control.sh <status|enable|stop|disable> [options]

  --change-id <ref>       required for enable/stop; 8-80 chars [A-Za-z0-9._:-]
  --authorization <marker> must be APPROVED-ISOLATED-DEMO-CONTROL for enable/stop
  --compose-dir <dir>     defaults to the demo package next to this script

Refuses unless the compose project "tanaghom-dashboard-demo" is the only
project on this host and the database is at migration 0048 or later. Run it on
the disposable demo host only.
EOF
}

action="${1:-}"
case "$action" in
  status|enable|stop|disable) shift ;;
  -h|--help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac

# "disable" is the fail-closed spelling operators ask for; it means the same stop.
if [ "$action" = disable ]; then action=stop; fi

compose_dir="$(cd "$(dirname "$0")/.." && pwd)"
change_id=""
authorization=""
while [ $# -gt 0 ]; do
  case "$1" in
    --change-id) change_id="${2:-}"; shift 2 ;;
    --authorization) authorization="${2:-}"; shift 2 ;;
    --compose-dir) compose_dir="$(cd "${2:-}" && pwd)"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

compose=(docker compose -p tanaghom-dashboard-demo -f "$compose_dir/compose.yml")
psql_demo() { "${compose[@]}" exec -T postgres psql -X -At -U postgres -d tanaghom_demo "$@"; }

if ! docker info >/dev/null 2>&1; then
  echo "WORKSPACE_CONTROL_REFUSED: docker is unavailable" >&2
  exit 1
fi
if ! "${compose[@]}" ps -q postgres >/dev/null 2>&1 || [ -z "$("${compose[@]}" ps -q postgres)" ]; then
  echo "WORKSPACE_CONTROL_REFUSED: demo postgres is not running" >&2
  exit 1
fi
other_projects="$(docker ps --filter 'label=com.docker.compose.project' \
  --format '{{.Label "com.docker.compose.project"}}' | sort -u | grep -vx 'tanaghom-dashboard-demo' || true)"
if [ -n "$other_projects" ]; then
  echo "WORKSPACE_CONTROL_REFUSED: other compose projects are running on this host: $other_projects" >&2
  exit 1
fi

if [ "$action" = status ]; then
  psql_demo -c "SELECT 'ledger='||coalesce(max(version),'none') FROM public.schema_migrations"
  psql_demo -c "SELECT 'workspace_enabled='||enabled||' workspace_stop='||emergency_stop||' reason='||reason FROM tanaghom.agency_workspace_control"
  psql_demo -c "SELECT 'platform_stop='||emergency_stop||' reason='||reason FROM tanaghom.agent_runtime_controls"
  psql_demo -c "SELECT 'audit_rows='||count(*) FROM tanaghom.demo_workspace_control_audit" 2>/dev/null || echo "audit_rows=0"
  exit 0
fi

case "$change_id" in
  '') echo "WORKSPACE_CONTROL_REFUSED: --change-id is required" >&2; exit 2 ;;
esac
if ! printf '%s' "$change_id" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$'; then
  echo "WORKSPACE_CONTROL_REFUSED: change id must be 8-80 chars of [A-Za-z0-9._:-]" >&2
  exit 2
fi
if [ "$authorization" != "APPROVED-ISOLATED-DEMO-CONTROL" ]; then
  echo "WORKSPACE_CONTROL_REFUSED: --authorization must be APPROVED-ISOLATED-DEMO-CONTROL" >&2
  exit 2
fi

"${compose[@]}" exec -T \
  -e "DEMO_WORKSPACE_ACTION=$action" \
  -e "DEMO_WORKSPACE_CHANGE_ID=$change_id" \
  -e "DEMO_WORKSPACE_CONTROL_AUTHORIZATION=$authorization" \
  postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d tanaghom_demo \
  < "$compose_dir/sql/workspace-control.sql"

echo "WORKSPACE_CONTROL_APPLIED action=$action change_id=$change_id"
