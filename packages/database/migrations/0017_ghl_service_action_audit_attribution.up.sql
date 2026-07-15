BEGIN;

CREATE OR REPLACE FUNCTION tanaghom.attach_ghl_service_actor_to_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,pg_temp
AS $$
BEGIN
  IF NEW.actor_user_id IS NULL AND NEW.agent_id IS NULL THEN
    IF NEW.entity_type='ghl_action_job' AND NEW.entity_id IS NOT NULL THEN
      SELECT job.requested_by_agent_id INTO NEW.actor_user_id
      FROM tanaghom.ghl_action_jobs job
      WHERE job.id=NEW.entity_id;
    ELSIF NEW.action_type='ghl.action_queued'
       AND jsonb_typeof(NEW.payload->'job_id')='string' THEN
      BEGIN
        SELECT job.requested_by_agent_id INTO NEW.actor_user_id
        FROM tanaghom.ghl_action_jobs job
        WHERE job.id=(NEW.payload->>'job_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        NULL;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION tanaghom.attach_ghl_service_actor_to_audit() FROM PUBLIC;

INSERT INTO public.schema_migrations(version)
VALUES ('0017_ghl_service_action_audit_attribution');

COMMIT;
