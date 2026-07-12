#!/bin/sh
set -eu

cd /opt/tanaghom-dashboard/deployment/dashboard-canary
docker compose -p tanaghom-dashboard-canary -f docker-compose.yml stop dashboard
docker compose -p tanaghom-dashboard-canary -f docker-compose.yml rm -f dashboard

echo "Dashboard container removed. Source and secret files were preserved for audit or redeployment."
