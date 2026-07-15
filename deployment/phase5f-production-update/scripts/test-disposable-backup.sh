#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
exec "$root/deployment/production-database-backup/test-disposable-backup.sh" "$@"
