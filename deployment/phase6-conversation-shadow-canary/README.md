# Tanaghom Conversation Intelligence shadow canary

This package proves one production-shaped but wholly synthetic conversation
path:

`approved knowledge -> inbound WhatsApp question -> grounded AI proposal -> Supervisor Inbox`

The canary creates a unique inactive `.test` organization, a synthetic owner,
one fake GHL connection, one approved pricing fact, and one synthetic inbound
question. It briefly unlocks only the GHL conversation-claim gate, executes the
reviewed Conversation Intelligence workflow exactly once, and restores every
workflow and platform lock before retaining the isolated proposal as evidence.

It never calls GHL, sends a message, creates a CRM contact/action, publishes
content, spends money, uses customer credentials/data, changes a firewall, or
recreates a container. SmartLabs, SmartCC, voice, the Gemma service and its
configuration, Nginx, and every non-Tanaghom file are outside mutation scope.

Merging this package is preparation only. Production execution is a separate,
explicitly authorized action described in [RUNBOOK.md](RUNBOOK.md).
