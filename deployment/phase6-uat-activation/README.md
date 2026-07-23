# Controlled all-agent UAT activation

This package prepares Tanaghom for customer-led UAT without granting uncontrolled
provider authority.

It performs these Tanaghom-only runtime changes:

- imports the three reviewed workflows that are still absent from production;
- republishes all eight reviewed Tanaghom workflow exports;
- enables the existing one-minute schedules only for Campaign Strategist and
  Content Producer;
- keeps every Postiz, GHL, conversation, and quality schedule disabled;
- records the corresponding live workflow states in the Agent Registry; and
- preserves an exact workflow and registry rollback.

Publishing a workflow with a disabled schedule makes its reviewed definition
available to an operator, but does not create a background provider action. The
database claim functions, customer policies, connection readiness, channel
mapping, and platform emergency stops remain authoritative.

The package does not add credentials, clear emergency stops, map a channel,
create a provider operation, import customer data, publish content, contact a
lead, change a firewall or Nginx, or modify SmartLabs, SmartCC, voice, or the
Gemma service.

See [RUNBOOK.md](RUNBOOK.md) for the controlled procedure.
