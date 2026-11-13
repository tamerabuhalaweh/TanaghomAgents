BEGIN;

-- Issue #281: audit rows written by a service agent have no human actor, so the
-- actor join hid them from every tenant. Store the owning organisation on the
-- row itself, backfill existing rows from their actor/job/entity, and derive it
-- automatically for inserts that do not provide it explicitly.

DO $$ BEGIN
  IF (SELECT count(*) FROM public.schema_migrations) <> 47
     OR (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0050_tenant_onboarding' THEN
    RAISE EXCEPTION '0051 requires the exact 0050 ledger (47 migrations)';
  END IF;
END $$;

ALTER TABLE tanaghom.agent_actions_log
  ADD COLUMN organization_id uuid REFERENCES tanaghom.organizations(id);

-- The audit table rejects every UPDATE by design. This backfill is the one
-- controlled migration exception; the trigger is restored before commit and
-- the down migration never uses this path.
ALTER TABLE tanaghom.agent_actions_log DISABLE TRIGGER audit_no_update;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = actor.organization_id
  FROM tanaghom.app_users AS actor
 WHERE log.organization_id IS NULL
   AND log.actor_user_id = actor.id;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = campaign.organization_id
  FROM tanaghom.agent_jobs AS job
  JOIN tanaghom.campaigns AS campaign ON campaign.id = job.campaign_id
 WHERE log.organization_id IS NULL
   AND log.job_id = job.id;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = campaign.organization_id
  FROM tanaghom.campaigns AS campaign
 WHERE log.organization_id IS NULL
   AND log.entity_type = 'campaign'
   AND log.entity_id = campaign.id;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = campaign.organization_id
  FROM tanaghom.content_items AS item
  JOIN tanaghom.campaigns AS campaign ON campaign.id = item.campaign_id
 WHERE log.organization_id IS NULL
   AND log.entity_type = 'content_item'
   AND log.entity_id = item.id;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = campaign.organization_id
  FROM tanaghom.posts AS post
  JOIN tanaghom.content_items AS item ON item.id = post.content_item_id
  JOIN tanaghom.campaigns AS campaign ON campaign.id = item.campaign_id
 WHERE log.organization_id IS NULL
   AND log.entity_type = 'post'
   AND log.entity_id = post.id;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = campaign.organization_id
  FROM tanaghom.leads AS lead
  JOIN tanaghom.campaigns AS campaign ON campaign.id = lead.campaign_id
 WHERE log.organization_id IS NULL
   AND log.entity_type = 'lead'
   AND log.entity_id = lead.id;

UPDATE tanaghom.agent_actions_log AS log
   SET organization_id = organization.id
  FROM tanaghom.organizations AS organization
 WHERE log.organization_id IS NULL
   AND log.entity_type = 'organization'
   AND log.entity_id = organization.id;

ALTER TABLE tanaghom.agent_actions_log ENABLE TRIGGER audit_no_update;

CREATE INDEX agent_actions_log_organization_time_idx
  ON tanaghom.agent_actions_log(organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

-- New rows: an explicit organization_id wins; otherwise derive it from the
-- actor, the job's campaign, or the audited entity. SECURITY DEFINER is needed
-- because workers only hold EXECUTE on their controlled functions, not direct
-- SELECT on app_users/campaigns.
CREATE FUNCTION tanaghom.assign_agent_action_organization()
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
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER assign_agent_action_organization
  BEFORE INSERT ON tanaghom.agent_actions_log
  FOR EACH ROW EXECUTE FUNCTION tanaghom.assign_agent_action_organization();

INSERT INTO public.schema_migrations(version)
VALUES ('0051_agent_audit_organization');

COMMIT;
