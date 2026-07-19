# Tanaghom core-agent canary

This package prepares one controlled production canary for the Campaign
Strategist and Content Producer. It creates one fictional, uniquely named
`.test` campaign with zero budget and zero revenue target, generates at most two
drafts, and stops at the existing authenticated human-approval gate.

The package does **not** publish content, create a Postiz draft, contact a lead,
write to GoHighLevel, activate polling, change credentials, apply a migration,
recreate a container, edit the firewall, or deploy dashboard code. SmartLabs,
SmartCC, voice, Gemma service configuration, Nginx, and all non-Tanaghom files
are outside its mutation scope.

Merging this package is preparation only. Running `run-canary.sh` remains a
separate production action requiring Tamer's explicit authorization and the
full reviewed source commit.

See [RUNBOOK.md](RUNBOOK.md) for preflight, execution, human approval,
validation, failure recovery, and exact rollback commands.
