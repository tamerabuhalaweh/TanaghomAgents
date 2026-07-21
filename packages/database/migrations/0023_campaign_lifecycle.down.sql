BEGIN;

REVOKE EXECUTE ON FUNCTION tanaghom.mark_campaign_ready(uuid,uuid) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.reconcile_campaign_content_jobs(uuid,uuid) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.queue_campaign_content(uuid,uuid) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.queue_campaign_strategy(uuid,uuid) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.revise_campaign_brief(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,integer) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.create_campaign_draft(uuid,text,text,text,jsonb,numeric,numeric,text,integer) FROM tanaghom_api;

DROP FUNCTION tanaghom.mark_campaign_ready(uuid,uuid);
DROP FUNCTION tanaghom.reconcile_campaign_content_jobs(uuid,uuid);
DROP FUNCTION tanaghom.queue_campaign_content(uuid,uuid);
DROP FUNCTION tanaghom.queue_campaign_strategy(uuid,uuid);
DROP FUNCTION tanaghom.revise_campaign_brief(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,integer);
DROP FUNCTION tanaghom.create_campaign_draft(uuid,text,text,text,jsonb,numeric,numeric,text,integer);

DROP INDEX tanaghom.agent_jobs_one_open_core_job_per_campaign_idx;
ALTER TABLE tanaghom.campaigns DROP COLUMN content_item_target;

DELETE FROM public.schema_migrations WHERE version = '0023_campaign_lifecycle';

COMMIT;
