BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tanaghom.posts WHERE status = 'draft') THEN
    RAISE EXCEPTION 'cannot roll back Postiz handoff while draft post records exist';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION tanaghom.queue_postiz_draft(uuid, uuid) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.prepare_postiz_draft(uuid) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.complete_postiz_draft(uuid, text, jsonb) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.record_postiz_draft_failure(uuid, text, text, integer, boolean) FROM tanaghom_n8n_worker;

DROP FUNCTION tanaghom.record_postiz_draft_failure(uuid, text, text, integer, boolean);
DROP FUNCTION tanaghom.complete_postiz_draft(uuid, text, jsonb);
DROP FUNCTION tanaghom.prepare_postiz_draft(uuid);
DROP FUNCTION tanaghom.queue_postiz_draft(uuid, uuid);
DROP INDEX tanaghom.agent_jobs_postiz_content_uidx;
DROP TABLE tanaghom.publishing_channels;

ALTER TABLE tanaghom.posts
  DROP CONSTRAINT posts_status_check,
  ADD CONSTRAINT posts_status_check
    CHECK (status IN ('scheduled', 'live', 'failed', 'removed'));

DELETE FROM public.schema_migrations
WHERE version = '0007_postiz_draft_handoff';

COMMIT;
