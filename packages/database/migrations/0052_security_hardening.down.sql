BEGIN;

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

GRANT EXECUTE ON FUNCTION tanaghom.set_creative_control(uuid, boolean, boolean, text)
  TO tanaghom_api;

DELETE FROM public.schema_migrations WHERE version = '0052_security_hardening';

COMMIT;
