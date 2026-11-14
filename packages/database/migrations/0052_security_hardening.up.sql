BEGIN;

-- Security hardening follow-up to 0051. Worker/webhook audit rows can carry a
-- NULL actor and a job without a campaign; those rows need an organisation
-- derived from the job input or from the audited entity. Also remove the
-- tenant API role's ability to flip the platform-global creative kill switch.

DO $$ BEGIN
  IF (SELECT count(*) FROM public.schema_migrations) <> 48
     OR (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0051_agent_audit_organization' THEN
    RAISE EXCEPTION '0052 requires the exact 0051 ledger (48 migrations)';
  END IF;
END $$;

-- Audit rows are immutable. This is the controlled backfill exception; the
-- trigger is restored before the migration commits.
ALTER TABLE tanaghom.agent_actions_log DISABLE TRIGGER audit_no_update;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = organization.id
  FROM tanaghom.agent_jobs AS job
  JOIN tanaghom.organizations AS organization
    ON organization.id::text = lower(job.input->>'organization_id')
 WHERE log.organization_id IS NULL
   AND log.job_id = job.id
   AND job.campaign_id IS NULL;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = event.organization_id
  FROM tanaghom.ghl_inbound_events AS event
 WHERE log.organization_id IS NULL
   AND log.entity_type = 'ghl_inbound_event'
   AND log.entity_id = event.id;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = conversation.organization_id
  FROM tanaghom.conversations AS conversation
 WHERE log.organization_id IS NULL
   AND log.entity_type = 'conversation'
   AND log.entity_id = conversation.id;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = action.organization_id
  FROM tanaghom.ghl_action_jobs AS action
 WHERE log.organization_id IS NULL
   AND log.entity_type = 'ghl_action_job'
   AND log.entity_id = action.id;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = job.organization_id
  FROM tanaghom.creative_jobs AS job
 WHERE log.organization_id IS NULL
   AND log.entity_type = 'creative_job'
   AND log.entity_id = job.id;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = asset.organization_id
  FROM tanaghom.creative_asset_versions AS asset_version
  JOIN tanaghom.creative_assets AS asset ON asset.id = asset_version.asset_id
 WHERE log.organization_id IS NULL
   AND log.entity_type = 'creative_asset_version'
   AND log.entity_id = asset_version.id;

ALTER TABLE tanaghom.agent_actions_log ENABLE TRIGGER audit_no_update;

CREATE OR REPLACE FUNCTION tanaghom.assign_agent_action_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tanaghom, pg_temp
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.actor_user_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
      FROM app_users WHERE id = NEW.actor_user_id;
  END IF;

  IF NEW.organization_id IS NULL AND NEW.job_id IS NOT NULL THEN
    SELECT campaign.organization_id INTO NEW.organization_id
      FROM agent_jobs AS job
      JOIN campaigns AS campaign ON campaign.id = job.campaign_id
     WHERE job.id = NEW.job_id;
  END IF;

  -- Webhook/conversation workers use jobs with campaign_id = NULL and put the
  -- tenant in input. The text comparison avoids casting malformed input.
  IF NEW.organization_id IS NULL AND NEW.job_id IS NOT NULL THEN
    SELECT organization.id INTO NEW.organization_id
      FROM agent_jobs AS job
      JOIN organizations AS organization
        ON organization.id::text = lower(job.input->>'organization_id')
     WHERE job.id = NEW.job_id
       AND job.campaign_id IS NULL;
  END IF;

  IF NEW.organization_id IS NULL AND NEW.entity_id IS NOT NULL THEN
    IF NEW.entity_type = 'campaign' THEN
      SELECT organization_id INTO NEW.organization_id
        FROM campaigns WHERE id = NEW.entity_id;
    ELSIF NEW.entity_type = 'content_item' THEN
      SELECT campaign.organization_id INTO NEW.organization_id
        FROM content_items AS item
        JOIN campaigns AS campaign ON campaign.id = item.campaign_id
       WHERE item.id = NEW.entity_id;
    ELSIF NEW.entity_type = 'post' THEN
      SELECT campaign.organization_id INTO NEW.organization_id
        FROM posts AS post
        JOIN content_items AS item ON item.id = post.content_item_id
        JOIN campaigns AS campaign ON campaign.id = item.campaign_id
       WHERE post.id = NEW.entity_id;
    ELSIF NEW.entity_type = 'lead' THEN
      SELECT campaign.organization_id INTO NEW.organization_id
        FROM leads AS lead
        JOIN campaigns AS campaign ON campaign.id = lead.campaign_id
       WHERE lead.id = NEW.entity_id;
    ELSIF NEW.entity_type = 'organization' THEN
      SELECT id INTO NEW.organization_id
        FROM organizations WHERE id = NEW.entity_id;
    ELSIF NEW.entity_type = 'ghl_inbound_event' THEN
      SELECT organization_id INTO NEW.organization_id
        FROM ghl_inbound_events WHERE id = NEW.entity_id;
    ELSIF NEW.entity_type = 'conversation' THEN
      SELECT organization_id INTO NEW.organization_id
        FROM conversations WHERE id = NEW.entity_id;
    ELSIF NEW.entity_type = 'ghl_action_job' THEN
      SELECT organization_id INTO NEW.organization_id
        FROM ghl_action_jobs WHERE id = NEW.entity_id;
    ELSIF NEW.entity_type = 'creative_job' THEN
      SELECT organization_id INTO NEW.organization_id
        FROM creative_jobs WHERE id = NEW.entity_id;
    ELSIF NEW.entity_type = 'creative_asset_version' THEN
      SELECT asset.organization_id INTO NEW.organization_id
        FROM creative_asset_versions AS asset_version
        JOIN creative_assets AS asset ON asset.id = asset_version.asset_id
       WHERE asset_version.id = NEW.entity_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 0051 created the trigger function without removing PostgreSQL's implicit
-- PUBLIC EXECUTE. It is a trigger-only function and no client role needs it.
REVOKE EXECUTE ON FUNCTION tanaghom.assign_agent_action_organization() FROM PUBLIC;

-- The creative kill switch is platform-global. Tenant owners must not be able
-- to disable or reconfigure it for every other tenant through the API role.
REVOKE EXECUTE ON FUNCTION tanaghom.set_creative_control(uuid, boolean, boolean, text)
  FROM tanaghom_api;

INSERT INTO public.schema_migrations(version)
VALUES ('0052_security_hardening');

COMMIT;
