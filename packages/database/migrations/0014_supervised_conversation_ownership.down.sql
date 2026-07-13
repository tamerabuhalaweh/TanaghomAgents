BEGIN;

REVOKE EXECUTE ON FUNCTION tanaghom.assert_conversation_ai_reply_authority(uuid,uuid,bigint) FROM tanaghom_conversation_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.claim_conversation_ai_lease(uuid,bigint,integer,uuid) FROM tanaghom_conversation_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.sweep_conversation_supervisor_alerts() FROM tanaghom_conversation_worker;
REVOKE SELECT ON tanaghom.conversation_supervisor_inbox,tanaghom.conversation_ownership_history,
  tanaghom.conversation_human_reply_drafts FROM tanaghom_readonly;
REVOKE EXECUTE ON FUNCTION tanaghom.set_organization_conversation_emergency_stop(boolean,text,uuid,uuid) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.create_conversation_human_reply_draft(uuid,uuid,bigint,text,text,uuid) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.transition_supervised_conversation(uuid,text,uuid,uuid,text,bigint,uuid) FROM tanaghom_api;

DROP TRIGGER conversation_proposal_supervisor_state ON tanaghom.conversation_intelligence_proposals;
DROP FUNCTION tanaghom.apply_conversation_intelligence_to_supervisor();
DROP TRIGGER ghl_event_failure_supervisor_state ON tanaghom.ghl_inbound_events;
DROP FUNCTION tanaghom.apply_conversation_failure_to_supervisor();
DROP TRIGGER ghl_event_sync_supervised_conversation ON tanaghom.ghl_inbound_events;
DROP FUNCTION tanaghom.sync_supervised_conversation_from_event();
DROP FUNCTION tanaghom.set_organization_conversation_emergency_stop(boolean,text,uuid,uuid);
DROP FUNCTION tanaghom.create_conversation_human_reply_draft(uuid,uuid,bigint,text,text,uuid);
DROP FUNCTION tanaghom.assert_conversation_ai_reply_authority(uuid,uuid,bigint);
DROP FUNCTION tanaghom.claim_conversation_ai_lease(uuid,bigint,integer,uuid);
DROP FUNCTION tanaghom.transition_supervised_conversation(uuid,text,uuid,uuid,text,bigint,uuid);
DROP FUNCTION tanaghom.sweep_conversation_supervisor_alerts();
DROP VIEW tanaghom.conversation_supervisor_inbox;
DROP TABLE tanaghom.conversation_notification_receipts;
DROP TABLE tanaghom.conversation_human_reply_drafts;
DROP TABLE tanaghom.conversation_ai_lease_claims;
DROP TABLE tanaghom.conversation_ownership_history;
DROP TABLE tanaghom.conversations;

ALTER TABLE tanaghom.organization_crm_policies
  DROP COLUMN conversation_emergency_changed_at,
  DROP COLUMN conversation_emergency_changed_by,
  DROP COLUMN conversation_emergency_reason,
  DROP COLUMN conversation_emergency_stop;

DELETE FROM public.schema_migrations WHERE version='0014_supervised_conversation_ownership';
COMMIT;
