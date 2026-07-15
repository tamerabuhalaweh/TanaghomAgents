BEGIN;

REVOKE EXECUTE ON FUNCTION tanaghom.record_ghl_action_failure(uuid,text,text,integer,integer) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.complete_ghl_action(uuid,jsonb) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.prepare_ghl_action_dispatch(uuid) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.claim_ghl_action_job() FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.decide_ghl_action(uuid,uuid,text,text,uuid) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.queue_ghl_action(uuid,text,text,text,jsonb,uuid,uuid,uuid,bigint,uuid,text)
  FROM tanaghom_api,tanaghom_conversation_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.set_ghl_action_emergency_stop(uuid,boolean,text,boolean,uuid) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.set_ghl_action_automation_mode(uuid,text,boolean,uuid) FROM tanaghom_api;

DROP TRIGGER ghl_contact_restriction_cancels_actions ON tanaghom.ghl_contact_channel_policies;
DROP FUNCTION tanaghom.cancel_ghl_actions_on_contact_restriction();
DROP FUNCTION tanaghom.record_ghl_action_failure(uuid,text,text,integer,integer);
DROP FUNCTION tanaghom.complete_ghl_action(uuid,jsonb);
DROP FUNCTION tanaghom.prepare_ghl_action_dispatch(uuid);
DROP FUNCTION tanaghom.claim_ghl_action_job();
DROP FUNCTION tanaghom.decide_ghl_action(uuid,uuid,text,text,uuid);
DROP FUNCTION tanaghom.queue_ghl_action(uuid,text,text,text,jsonb,uuid,uuid,uuid,bigint,uuid,text);
DROP FUNCTION tanaghom.set_ghl_action_emergency_stop(uuid,boolean,text,boolean,uuid);
DROP FUNCTION tanaghom.set_ghl_action_automation_mode(uuid,text,boolean,uuid);
DROP VIEW tanaghom.ghl_action_automation_status;
DROP TRIGGER ghl_action_outcome_no_delete ON tanaghom.ghl_action_outcomes;
DROP TRIGGER ghl_action_outcome_no_update ON tanaghom.ghl_action_outcomes;
DROP FUNCTION tanaghom.prevent_ghl_action_outcome_mutation();
DROP TABLE tanaghom.ghl_action_outcomes;
DROP TABLE tanaghom.ghl_action_approvals;
DROP TABLE tanaghom.ghl_action_jobs;
DROP TRIGGER ghl_contact_channel_policies_updated_at ON tanaghom.ghl_contact_channel_policies;
DROP TABLE tanaghom.ghl_contact_channel_policies;
DROP TABLE tanaghom.ghl_message_template_versions;

ALTER TABLE tanaghom.organization_crm_policies
  DROP COLUMN action_policy_changed_at,
  DROP COLUMN action_policy_changed_by,
  DROP COLUMN action_contact_frequency_cap_24h,
  DROP COLUMN action_timezone,
  DROP COLUMN action_quiet_hours_end,
  DROP COLUMN action_quiet_hours_start,
  DROP COLUMN action_allowed_channels,
  DROP COLUMN action_emergency_reason,
  DROP COLUMN action_emergency_stop,
  DROP COLUMN proactive_message_mode,
  DROP COLUMN action_mode;

DELETE FROM public.schema_migrations WHERE version='0015_governed_ghl_actions';
COMMIT;
