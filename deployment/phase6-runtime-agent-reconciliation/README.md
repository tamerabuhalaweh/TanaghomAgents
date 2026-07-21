# Tanaghom runtime-agent reconciliation

This database-only package reconciles the two permanent runtime agent rows that
production is missing: `publisher_monitor` and `sales_crm`. Their workflow
registry entries already exist, but database claim functions require matching
rows in `tanaghom.agents` before Postiz or GHL work can run.

The package applies only migration `0025_runtime_agent_reconciliation`. It does
not update the dashboard checkout, import or activate a workflow, change a
credential, call a provider, recreate a container, or edit Nginx/firewall.
SmartLabs, SmartCC, voice, and Gemma are outside its mutation scope.

See [RUNBOOK.md](RUNBOOK.md) for controlled deployment and rollback.
