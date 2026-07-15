BEGIN;

ALTER TABLE tanaghom.organization_crm_policies
  ADD COLUMN conversation_emergency_stop boolean NOT NULL DEFAULT true,
  ADD COLUMN conversation_emergency_reason text NOT NULL DEFAULT 'Awaiting supervised conversation activation'
    CHECK (length(trim(conversation_emergency_reason)) BETWEEN 3 AND 500),
  ADD COLUMN conversation_emergency_changed_by uuid REFERENCES tanaghom.app_users(id) ON DELETE SET NULL,
  ADD COLUMN conversation_emergency_changed_at timestamptz;

CREATE TABLE tanaghom.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'ghl' CHECK (provider = 'ghl'),
  provider_conversation_id text NOT NULL CHECK (length(provider_conversation_id) BETWEEN 1 AND 300),
  contact_id text CHECK (contact_id IS NULL OR length(contact_id) BETWEEN 1 AND 300),
  lead_id uuid REFERENCES tanaghom.leads(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES tanaghom.campaigns(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN (
    'queued','ai_owned','awaiting_approval','human_required','human_owned','paused','resolved','failed'
  )),
  reply_authority text NOT NULL DEFAULT 'none' CHECK (reply_authority IN ('none','ai','human')),
  assigned_user_id uuid REFERENCES tanaghom.app_users(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES tanaghom.app_users(id) ON DELETE SET NULL,
  ownership_epoch bigint NOT NULL DEFAULT 0 CHECK (ownership_epoch >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  ownership_reason text CHECK (ownership_reason IS NULL OR length(trim(ownership_reason)) BETWEEN 3 AND 1000),
  emergency_paused boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  sla_due_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  language text CHECK (language IS NULL OR language IN ('en','ar')),
  intent text,
  risk_categories text[] NOT NULL DEFAULT '{}'::text[],
  pipeline_stage text,
  qualification_state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(qualification_state) = 'object'),
  handoff_summary text CHECK (handoff_summary IS NULL OR length(handoff_summary) <= 4000),
  unresolved_questions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(unresolved_questions) = 'array'),
  suggested_response text CHECK (suggested_response IS NULL OR length(suggested_response) <= 5000),
  latest_proposal_id uuid REFERENCES tanaghom.conversation_intelligence_proposals(id) ON DELETE SET NULL,
  last_event_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  conversation_version bigint NOT NULL DEFAULT 1 CHECK (conversation_version > 0),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, provider_conversation_id),
  CHECK (
    (state = 'human_owned' AND reply_authority = 'human' AND owner_user_id IS NOT NULL)
    OR (state = 'ai_owned' AND reply_authority = 'ai' AND owner_user_id IS NULL)
    OR (state NOT IN ('human_owned','ai_owned') AND reply_authority = 'none' AND owner_user_id IS NULL)
  ),
  CHECK ((lease_token IS NULL AND lease_expires_at IS NULL) OR
    (reply_authority = 'ai' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((state = 'resolved' AND resolved_at IS NOT NULL) OR state <> 'resolved')
);

CREATE TRIGGER conversations_updated_at
BEFORE UPDATE ON tanaghom.conversations
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE INDEX conversations_supervisor_queue_idx
  ON tanaghom.conversations(organization_id, state, priority, sla_due_at, last_activity_at DESC);
CREATE INDEX conversations_assignee_idx
  ON tanaghom.conversations(organization_id, assigned_user_id, state)
  WHERE assigned_user_id IS NOT NULL;

CREATE TABLE tanaghom.conversation_ownership_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES tanaghom.conversations(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'created','proposal_ready','human_required','failed','takeover','assign','reassign','pause',
    'resolve','resume_ai','organization_emergency_pause','organization_emergency_resume'
  )),
  actor_user_id uuid REFERENCES tanaghom.app_users(id) ON DELETE SET NULL,
  actor_role text CHECK (actor_role IS NULL OR actor_role IN ('system','owner','reviewer','operator')),
  previous_state text,
  new_state text NOT NULL,
  previous_reply_authority text,
  new_reply_authority text NOT NULL,
  previous_owner_user_id uuid REFERENCES tanaghom.app_users(id) ON DELETE SET NULL,
  new_owner_user_id uuid REFERENCES tanaghom.app_users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  ownership_epoch bigint NOT NULL CHECK (ownership_epoch >= 0),
  result_version bigint NOT NULL CHECK (result_version > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, command_id)
);

CREATE INDEX conversation_ownership_timeline_idx
  ON tanaghom.conversation_ownership_history(conversation_id, occurred_at, id);

CREATE TABLE tanaghom.conversation_ai_lease_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES tanaghom.conversations(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  lease_token uuid NOT NULL,
  ownership_epoch bigint NOT NULL CHECK (ownership_epoch >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, command_id),
  UNIQUE (lease_token)
);

CREATE TABLE tanaghom.conversation_human_reply_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES tanaghom.conversations(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  ownership_epoch bigint NOT NULL CHECK (ownership_epoch >= 0),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  language text NOT NULL CHECK (language IN ('en','ar')),
  status text NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, command_id)
);

CREATE TABLE tanaghom.conversation_notification_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES tanaghom.conversations(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('urgent','sla_breached','failed','high_value')),
  conversation_version bigint NOT NULL CHECK (conversation_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id,alert_type,conversation_version)
);

CREATE VIEW tanaghom.conversation_supervisor_inbox AS
SELECT conversation.organization_id, conversation.id, conversation.provider,
  conversation.provider_conversation_id, conversation.contact_id, conversation.lead_id,
  conversation.campaign_id, campaign.name AS campaign_name, lead.name AS lead_name,
  conversation.state, conversation.reply_authority, conversation.assigned_user_id,
  assignee.display_name AS assigned_user_name, conversation.owner_user_id,
  owner_user.display_name AS owner_user_name, conversation.ownership_epoch,
  conversation.lease_expires_at, conversation.ownership_reason,
  conversation.emergency_paused, conversation.priority, conversation.sla_due_at,
  (conversation.state NOT IN ('resolved','paused') AND conversation.sla_due_at < statement_timestamp()) AS sla_breached,
  greatest(0, extract(epoch FROM statement_timestamp() - conversation.last_activity_at))::bigint AS age_seconds,
  conversation.language, conversation.intent, conversation.risk_categories,
  coalesce(conversation.pipeline_stage, lead.status) AS pipeline_stage,
  (lead.temperature='hot' OR conversation.qualification_state->>'high_value'='true') AS high_value,
  conversation.qualification_state, conversation.handoff_summary,
  conversation.unresolved_questions, conversation.suggested_response,
  conversation.latest_proposal_id, conversation.last_event_at, conversation.last_activity_at,
  conversation.conversation_version, conversation.updated_at
FROM tanaghom.conversations conversation
LEFT JOIN tanaghom.leads lead ON lead.id=conversation.lead_id
LEFT JOIN tanaghom.campaigns campaign ON campaign.id=conversation.campaign_id
LEFT JOIN tanaghom.app_users assignee ON assignee.id=conversation.assigned_user_id
LEFT JOIN tanaghom.app_users owner_user ON owner_user.id=conversation.owner_user_id;

CREATE FUNCTION tanaghom.sync_supervised_conversation_from_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_conversation tanaghom.conversations%ROWTYPE;
  v_lead_id uuid;
  v_campaign_id uuid;
BEGIN
  IF NEW.conversation_id IS NULL THEN RETURN NEW; END IF;
  SELECT lead.id, lead.campaign_id INTO v_lead_id, v_campaign_id
    FROM tanaghom.leads lead
    JOIN tanaghom.campaigns campaign ON campaign.id=lead.campaign_id
   WHERE campaign.organization_id=NEW.organization_id AND lead.ghl_contact_id=NEW.contact_id
   ORDER BY lead.updated_at DESC LIMIT 1;

  INSERT INTO tanaghom.conversations (
    organization_id, provider_conversation_id, contact_id, lead_id, campaign_id,
    state, reply_authority, last_event_at, last_activity_at
  ) VALUES (
    NEW.organization_id, NEW.conversation_id, NEW.contact_id, v_lead_id, v_campaign_id,
    'queued', 'none', NEW.occurred_at, NEW.occurred_at
  ) ON CONFLICT (organization_id, provider, provider_conversation_id) DO UPDATE SET
    contact_id=coalesce(EXCLUDED.contact_id,tanaghom.conversations.contact_id),
    lead_id=coalesce(EXCLUDED.lead_id,tanaghom.conversations.lead_id),
    campaign_id=coalesce(EXCLUDED.campaign_id,tanaghom.conversations.campaign_id),
    last_event_at=greatest(tanaghom.conversations.last_event_at,EXCLUDED.last_event_at),
    last_activity_at=greatest(tanaghom.conversations.last_activity_at,EXCLUDED.last_activity_at),
    conversation_version=tanaghom.conversations.conversation_version+1
  RETURNING * INTO v_conversation;

  IF NOT EXISTS (SELECT 1 FROM tanaghom.conversation_ownership_history history
    WHERE history.conversation_id=v_conversation.id) THEN
    INSERT INTO tanaghom.conversation_ownership_history (
      organization_id,conversation_id,command_id,action,actor_role,new_state,
      new_reply_authority,reason,ownership_epoch,result_version
    ) VALUES (
      v_conversation.organization_id,v_conversation.id,gen_random_uuid(),'created','system',
      v_conversation.state,v_conversation.reply_authority,'First authenticated provider event',
      v_conversation.ownership_epoch,v_conversation.conversation_version
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ghl_event_sync_supervised_conversation
AFTER INSERT ON tanaghom.ghl_inbound_events
FOR EACH ROW EXECUTE FUNCTION tanaghom.sync_supervised_conversation_from_event();

INSERT INTO tanaghom.conversations (
  organization_id,provider_conversation_id,contact_id,lead_id,campaign_id,
  state,reply_authority,last_event_at,last_activity_at
)
SELECT DISTINCT ON (event.organization_id,event.conversation_id)
  event.organization_id,event.conversation_id,event.contact_id,lead.id,lead.campaign_id,
  'queued','none',event.occurred_at,event.occurred_at
FROM tanaghom.ghl_inbound_events event
LEFT JOIN tanaghom.campaigns campaign ON campaign.organization_id=event.organization_id
LEFT JOIN tanaghom.leads lead ON lead.campaign_id=campaign.id AND lead.ghl_contact_id=event.contact_id
WHERE event.conversation_id IS NOT NULL
ORDER BY event.organization_id,event.conversation_id,event.occurred_at DESC
ON CONFLICT DO NOTHING;

INSERT INTO tanaghom.conversation_ownership_history (
  organization_id,conversation_id,command_id,action,actor_role,new_state,
  new_reply_authority,reason,ownership_epoch,result_version,occurred_at
)
SELECT organization_id,id,gen_random_uuid(),'created','system',state,reply_authority,
  'Backfilled from authenticated provider history',ownership_epoch,conversation_version,created_at
FROM tanaghom.conversations;

CREATE FUNCTION tanaghom.apply_conversation_intelligence_to_supervisor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_conversation tanaghom.conversations%ROWTYPE;
  v_previous_state text;
  v_previous_authority text;
  v_previous_owner uuid;
  v_new_state text;
  v_priority text;
  v_summary text;
BEGIN
  SELECT * INTO v_conversation FROM tanaghom.conversations
   WHERE organization_id=NEW.organization_id AND provider='ghl'
     AND provider_conversation_id=NEW.conversation_id FOR UPDATE;
  IF v_conversation.id IS NULL THEN RETURN NEW; END IF;
  v_previous_state := v_conversation.state;
  v_previous_authority := v_conversation.reply_authority;
  v_previous_owner := v_conversation.owner_user_id;
  v_priority := CASE WHEN NEW.urgency='critical' THEN 'urgent'
    WHEN NEW.urgency='high' OR NEW.escalation_required THEN 'high' ELSE v_conversation.priority END;
  v_new_state := CASE
    WHEN v_conversation.state IN ('human_owned','paused','resolved') THEN v_conversation.state
    WHEN NEW.escalation_required THEN 'human_required' ELSE 'awaiting_approval' END;
  SELECT summary.summary INTO v_summary FROM tanaghom.conversation_summary_versions summary
   WHERE summary.id=NEW.summary_version_id;

  UPDATE tanaghom.conversations SET
    state=v_new_state,
    reply_authority=CASE WHEN v_new_state='human_owned' THEN 'human' ELSE 'none' END,
    language=NEW.language,intent=NEW.intent,risk_categories=NEW.risk_categories,
    priority=v_priority,latest_proposal_id=NEW.id,
    handoff_summary=coalesce(v_summary,handoff_summary),
    suggested_response=NEW.proposed_reply,
    ownership_reason=coalesce(NEW.escalation_reason,'AI proposal requires human review'),
    lease_token=NULL,lease_expires_at=NULL,
    ownership_epoch=ownership_epoch+CASE WHEN v_new_state<>v_previous_state THEN 1 ELSE 0 END,
    conversation_version=conversation_version+1,last_activity_at=greatest(last_activity_at,NEW.created_at)
  WHERE id=v_conversation.id RETURNING * INTO v_conversation;

  INSERT INTO tanaghom.conversation_ownership_history (
    organization_id,conversation_id,command_id,action,actor_role,previous_state,new_state,
    previous_reply_authority,new_reply_authority,previous_owner_user_id,new_owner_user_id,
    reason,ownership_epoch,result_version
  ) VALUES (
    v_conversation.organization_id,v_conversation.id,gen_random_uuid(),
    CASE WHEN NEW.escalation_required THEN 'human_required' ELSE 'proposal_ready' END,'system',
    v_previous_state,v_conversation.state,v_previous_authority,v_conversation.reply_authority,v_previous_owner,
    v_conversation.owner_user_id,coalesce(NEW.escalation_reason,'AI proposal ready for human review'),
    v_conversation.ownership_epoch,v_conversation.conversation_version
  );

  IF NEW.escalation_required OR NEW.urgency IN ('high','critical') THEN
    INSERT INTO tanaghom.notifications (user_id,severity,title,body,entity_type,entity_id)
    SELECT app.id,CASE WHEN NEW.urgency='critical' THEN 'critical' ELSE 'warning' END,
      'Conversation needs human review',
      coalesce(NEW.escalation_reason,'A governed AI proposal requires supervisor review.'),
      'conversation',v_conversation.id
    FROM tanaghom.app_users app WHERE app.organization_id=NEW.organization_id
      AND app.kind='human' AND app.role IN ('owner','reviewer','operator') AND app.is_active;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversation_proposal_supervisor_state
AFTER INSERT ON tanaghom.conversation_intelligence_proposals
FOR EACH ROW EXECUTE FUNCTION tanaghom.apply_conversation_intelligence_to_supervisor();

CREATE FUNCTION tanaghom.apply_conversation_failure_to_supervisor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_conversation tanaghom.conversations%ROWTYPE; v_previous_state text; v_previous_authority text;
BEGIN
  IF NEW.status<>'dead_letter' OR OLD.status='dead_letter' OR NEW.conversation_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_conversation FROM tanaghom.conversations
   WHERE organization_id=NEW.organization_id AND provider_conversation_id=NEW.conversation_id FOR UPDATE;
  IF v_conversation.id IS NULL THEN RETURN NEW; END IF;
  v_previous_state:=v_conversation.state; v_previous_authority:=v_conversation.reply_authority;
  UPDATE tanaghom.conversations conversation SET
    state=CASE WHEN conversation.state IN ('human_owned','paused','resolved') THEN conversation.state ELSE 'failed' END,
    reply_authority=CASE WHEN conversation.state='human_owned' THEN 'human' ELSE 'none' END,
    owner_user_id=CASE WHEN conversation.state='human_owned' THEN conversation.owner_user_id ELSE NULL END,
    priority='urgent',ownership_reason=coalesce(NEW.last_error_message,'Provider event processing failed'),
    lease_token=NULL,lease_expires_at=NULL,
    ownership_epoch=conversation.ownership_epoch+1,conversation_version=conversation.conversation_version+1
  WHERE id=v_conversation.id RETURNING conversation.* INTO v_conversation;
  INSERT INTO tanaghom.conversation_ownership_history (
    organization_id,conversation_id,command_id,action,actor_role,previous_state,new_state,
    previous_reply_authority,new_reply_authority,reason,ownership_epoch,result_version
  ) VALUES (
    v_conversation.organization_id,v_conversation.id,gen_random_uuid(),'failed','system',v_previous_state,
    v_conversation.state,v_previous_authority,v_conversation.reply_authority,
    coalesce(NEW.last_error_message,'Provider event processing failed'),v_conversation.ownership_epoch,
    v_conversation.conversation_version
  );
  INSERT INTO tanaghom.notifications (user_id,severity,title,body,entity_type,entity_id)
  SELECT app.id,'critical','Conversation processing failed',
    coalesce(NEW.last_error_message,'A provider conversation entered the dead-letter queue.'),
    'conversation',v_conversation.id FROM tanaghom.app_users app
   WHERE app.organization_id=NEW.organization_id AND app.kind='human'
     AND app.role IN ('owner','reviewer','operator') AND app.is_active;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ghl_event_failure_supervisor_state
AFTER UPDATE OF status ON tanaghom.ghl_inbound_events
FOR EACH ROW EXECUTE FUNCTION tanaghom.apply_conversation_failure_to_supervisor();

CREATE FUNCTION tanaghom.sweep_conversation_supervisor_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  WITH candidates AS (
    SELECT conversation.organization_id,conversation.id AS conversation_id,
      conversation.conversation_version,alert_type
    FROM tanaghom.conversations conversation
    LEFT JOIN tanaghom.leads lead ON lead.id=conversation.lead_id
    CROSS JOIN LATERAL unnest(ARRAY[
      CASE WHEN conversation.priority='urgent' AND conversation.state<>'resolved' THEN 'urgent' END,
      CASE WHEN conversation.sla_due_at<statement_timestamp() AND conversation.state NOT IN ('resolved','paused') THEN 'sla_breached' END,
      CASE WHEN conversation.state='failed' THEN 'failed' END,
      CASE WHEN (lead.temperature='hot' OR conversation.qualification_state->>'high_value'='true')
        AND conversation.state<>'resolved' THEN 'high_value' END
    ]) alert_type
    WHERE alert_type IS NOT NULL
  ), inserted AS (
    INSERT INTO tanaghom.conversation_notification_receipts (
      organization_id,conversation_id,alert_type,conversation_version
    ) SELECT organization_id,conversation_id,alert_type,conversation_version FROM candidates
    ON CONFLICT DO NOTHING RETURNING *
  ), delivered AS (
    INSERT INTO tanaghom.notifications (user_id,severity,title,body,entity_type,entity_id)
    SELECT app.id,CASE WHEN receipt.alert_type IN ('urgent','failed') THEN 'critical' ELSE 'warning' END,
      CASE receipt.alert_type WHEN 'urgent' THEN 'Urgent conversation handoff'
        WHEN 'sla_breached' THEN 'Conversation SLA breached'
        WHEN 'failed' THEN 'Conversation processing failed'
        ELSE 'High-value conversation needs review' END,
      CASE receipt.alert_type WHEN 'urgent' THEN 'An urgent conversation is waiting in the supervisor inbox.'
        WHEN 'sla_breached' THEN 'A conversation exceeded its configured supervisor response window.'
        WHEN 'failed' THEN 'A conversation requires recovery after a processing failure.'
        ELSE 'A high-value conversation is waiting for supervised action.' END,
      'conversation',receipt.conversation_id
    FROM inserted receipt JOIN tanaghom.app_users app ON app.organization_id=receipt.organization_id
    WHERE app.kind='human' AND app.role IN ('owner','reviewer','operator') AND app.is_active
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

CREATE FUNCTION tanaghom.transition_supervised_conversation(
  p_conversation_id uuid,
  p_action text,
  p_actor_user_id uuid,
  p_assignee_user_id uuid,
  p_reason text,
  p_expected_version bigint,
  p_command_id uuid
)
RETURNS TABLE (
  conversation_id uuid,state text,reply_authority text,assigned_user_id uuid,
  owner_user_id uuid,ownership_epoch bigint,conversation_version bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor tanaghom.app_users%ROWTYPE;
  v_assignee tanaghom.app_users%ROWTYPE;
  v_conversation tanaghom.conversations%ROWTYPE;
  v_previous tanaghom.conversations%ROWTYPE;
  v_history tanaghom.conversation_ownership_history%ROWTYPE;
BEGIN
  IF p_command_id IS NULL OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'conversation command and reason are required';
  END IF;
  SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_user_id
    AND kind='human' AND role IN ('owner','reviewer','operator') AND is_active AND accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'authorized active supervisor required'; END IF;

  SELECT * INTO v_history FROM tanaghom.conversation_ownership_history
   WHERE organization_id=v_actor.organization_id AND command_id=p_command_id;
  IF v_history.id IS NOT NULL THEN
    SELECT * INTO v_conversation FROM tanaghom.conversations WHERE id=v_history.conversation_id;
    RETURN QUERY SELECT v_conversation.id,v_history.new_state,v_history.new_reply_authority,
      v_history.new_owner_user_id,v_history.new_owner_user_id,v_history.ownership_epoch,v_history.result_version;
    RETURN;
  END IF;

  SELECT * INTO v_conversation FROM tanaghom.conversations
   WHERE id=p_conversation_id AND organization_id=v_actor.organization_id FOR UPDATE;
  IF v_conversation.id IS NULL THEN RAISE EXCEPTION 'organization conversation not found'; END IF;
  IF v_conversation.conversation_version<>p_expected_version THEN RAISE EXCEPTION 'stale conversation version'; END IF;
  v_previous := v_conversation;

  IF p_action IN ('assign','reassign') THEN
    IF v_actor.role NOT IN ('owner','operator') THEN RAISE EXCEPTION 'owner or operator assignment required'; END IF;
    SELECT * INTO v_assignee FROM tanaghom.app_users WHERE id=p_assignee_user_id
      AND organization_id=v_actor.organization_id AND kind='human'
      AND role IN ('owner','reviewer','operator') AND is_active AND accepted_at IS NOT NULL;
    IF v_assignee.id IS NULL THEN RAISE EXCEPTION 'same-organization active assignee required'; END IF;
  END IF;

  IF p_action='takeover' THEN
    IF v_conversation.state='resolved' THEN RAISE EXCEPTION 'resolved conversation cannot be taken over'; END IF;
    UPDATE tanaghom.conversations conversation SET state='human_owned',reply_authority='human',
      assigned_user_id=v_actor.id,owner_user_id=v_actor.id,ownership_epoch=conversation.ownership_epoch+1,
      lease_token=NULL,lease_expires_at=NULL,ownership_reason=trim(p_reason),emergency_paused=false,
      conversation_version=conversation.conversation_version+1,resolved_at=NULL WHERE id=v_conversation.id RETURNING conversation.* INTO v_conversation;
  ELSIF p_action IN ('assign','reassign') THEN
    IF p_action='reassign' AND v_conversation.state<>'human_owned' THEN RAISE EXCEPTION 'reassign requires human ownership'; END IF;
    UPDATE tanaghom.conversations conversation SET state='human_owned',reply_authority='human',
      assigned_user_id=v_assignee.id,owner_user_id=v_assignee.id,ownership_epoch=conversation.ownership_epoch+1,
      lease_token=NULL,lease_expires_at=NULL,ownership_reason=trim(p_reason),emergency_paused=false,
      conversation_version=conversation.conversation_version+1,resolved_at=NULL WHERE id=v_conversation.id RETURNING conversation.* INTO v_conversation;
  ELSIF p_action='pause' THEN
    IF v_actor.role NOT IN ('owner','operator') THEN RAISE EXCEPTION 'owner or operator pause required'; END IF;
    IF v_conversation.state='resolved' THEN RAISE EXCEPTION 'resolved conversation cannot be paused'; END IF;
    UPDATE tanaghom.conversations conversation SET state='paused',reply_authority='none',owner_user_id=NULL,
      ownership_epoch=conversation.ownership_epoch+1,lease_token=NULL,lease_expires_at=NULL,
      ownership_reason=trim(p_reason),emergency_paused=true,conversation_version=conversation.conversation_version+1
      WHERE id=v_conversation.id RETURNING conversation.* INTO v_conversation;
  ELSIF p_action='resolve' THEN
    IF v_actor.role='reviewer' AND (v_conversation.state<>'human_owned' OR v_conversation.owner_user_id<>v_actor.id) THEN
      RAISE EXCEPTION 'reviewer must own conversation before resolving';
    END IF;
    UPDATE tanaghom.conversations conversation SET state='resolved',reply_authority='none',owner_user_id=NULL,
      ownership_epoch=conversation.ownership_epoch+1,lease_token=NULL,lease_expires_at=NULL,
      ownership_reason=trim(p_reason),conversation_version=conversation.conversation_version+1,resolved_at=statement_timestamp()
      WHERE id=v_conversation.id RETURNING conversation.* INTO v_conversation;
  ELSIF p_action='resume_ai' THEN
    IF v_actor.role NOT IN ('owner','operator') THEN RAISE EXCEPTION 'owner or operator AI resume required'; END IF;
    IF v_conversation.state NOT IN ('human_owned','paused','failed','awaiting_approval','human_required') THEN
      RAISE EXCEPTION 'conversation cannot return to AI from current state';
    END IF;
    UPDATE tanaghom.conversations conversation SET state='ai_owned',reply_authority='ai',assigned_user_id=NULL,
      owner_user_id=NULL,ownership_epoch=conversation.ownership_epoch+1,lease_token=NULL,lease_expires_at=NULL,
      ownership_reason=trim(p_reason),emergency_paused=false,conversation_version=conversation.conversation_version+1,
      resolved_at=NULL WHERE id=v_conversation.id RETURNING conversation.* INTO v_conversation;
  ELSE
    RAISE EXCEPTION 'unsupported conversation action';
  END IF;

  INSERT INTO tanaghom.conversation_ownership_history (
    organization_id,conversation_id,command_id,action,actor_user_id,actor_role,
    previous_state,new_state,previous_reply_authority,new_reply_authority,
    previous_owner_user_id,new_owner_user_id,reason,ownership_epoch,result_version
  ) VALUES (
    v_actor.organization_id,v_conversation.id,p_command_id,p_action,v_actor.id,v_actor.role,
    v_previous.state,v_conversation.state,v_previous.reply_authority,v_conversation.reply_authority,
    v_previous.owner_user_id,v_conversation.owner_user_id,trim(p_reason),
    v_conversation.ownership_epoch,v_conversation.conversation_version
  );
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result
  ) VALUES (
    p_command_id,v_actor.id,'conversation.'||p_action,'conversation',v_conversation.id,
    jsonb_build_object('previous_state',v_previous.state,'new_state',v_conversation.state,
      'previous_authority',v_previous.reply_authority,'new_authority',v_conversation.reply_authority,
      'ownership_epoch',v_conversation.ownership_epoch,'reason',trim(p_reason)),'success'
  );
  IF v_conversation.assigned_user_id IS NOT NULL AND v_conversation.assigned_user_id<>v_actor.id THEN
    INSERT INTO tanaghom.notifications (user_id,severity,title,body,entity_type,entity_id)
    VALUES (v_conversation.assigned_user_id,'warning','Conversation assigned to you',trim(p_reason),'conversation',v_conversation.id);
  END IF;
  RETURN QUERY SELECT v_conversation.id,v_conversation.state,v_conversation.reply_authority,
    v_conversation.assigned_user_id,v_conversation.owner_user_id,v_conversation.ownership_epoch,
    v_conversation.conversation_version;
END;
$$;

CREATE FUNCTION tanaghom.claim_conversation_ai_lease(
  p_conversation_id uuid,p_expected_epoch bigint,p_lease_seconds integer,p_command_id uuid
)
RETURNS TABLE (conversation_id uuid,lease_token uuid,ownership_epoch bigint,expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_conversation tanaghom.conversations%ROWTYPE;
  v_existing tanaghom.conversation_ai_lease_claims%ROWTYPE;
  v_token uuid := gen_random_uuid();
  v_expires timestamptz;
  v_policy tanaghom.organization_crm_policies%ROWTYPE;
  v_platform_stop boolean;
BEGIN
  IF p_command_id IS NULL OR p_lease_seconds NOT BETWEEN 15 AND 300 THEN RAISE EXCEPTION 'invalid AI lease command'; END IF;
  SELECT claim.* INTO v_existing FROM tanaghom.conversation_ai_lease_claims claim
   WHERE claim.command_id=p_command_id AND claim.conversation_id=p_conversation_id;
  IF v_existing.id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing.conversation_id,v_existing.lease_token,v_existing.ownership_epoch,v_existing.expires_at;
    RETURN;
  END IF;
  SELECT * INTO v_conversation FROM tanaghom.conversations WHERE id=p_conversation_id FOR UPDATE;
  IF v_conversation.id IS NULL THEN RAISE EXCEPTION 'conversation not found'; END IF;
  SELECT * INTO v_policy FROM tanaghom.organization_crm_policies WHERE organization_id=v_conversation.organization_id;
  SELECT emergency_stop INTO v_platform_stop FROM tanaghom.automation_platform_controls WHERE provider='ghl';
  IF v_platform_stop OR v_policy.conversation_emergency_stop OR v_policy.conversation_processing_mode<>'shadow'
     OR v_conversation.emergency_paused OR v_conversation.state<>'ai_owned'
     OR v_conversation.reply_authority<>'ai' OR v_conversation.ownership_epoch<>p_expected_epoch
     OR (v_conversation.lease_expires_at IS NOT NULL AND v_conversation.lease_expires_at>statement_timestamp()) THEN
    RAISE EXCEPTION 'AI reply authority unavailable';
  END IF;
  v_expires := statement_timestamp()+make_interval(secs=>p_lease_seconds);
  UPDATE tanaghom.conversations SET lease_token=v_token,lease_expires_at=v_expires,
    conversation_version=conversation_version+1 WHERE id=v_conversation.id;
  INSERT INTO tanaghom.conversation_ai_lease_claims (
    organization_id,conversation_id,command_id,lease_token,ownership_epoch,expires_at
  ) VALUES (v_conversation.organization_id,v_conversation.id,p_command_id,v_token,v_conversation.ownership_epoch,v_expires);
  RETURN QUERY SELECT v_conversation.id,v_token,v_conversation.ownership_epoch,v_expires;
END;
$$;

CREATE FUNCTION tanaghom.assert_conversation_ai_reply_authority(
  p_conversation_id uuid,p_lease_token uuid,p_ownership_epoch bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_allowed boolean;
BEGIN
  SELECT NOT platform.emergency_stop AND NOT policy.conversation_emergency_stop
    AND policy.conversation_processing_mode='shadow' AND NOT conversation.emergency_paused
    AND conversation.state='ai_owned' AND conversation.reply_authority='ai'
    AND conversation.lease_token=p_lease_token AND conversation.ownership_epoch=p_ownership_epoch
    AND conversation.lease_expires_at>statement_timestamp()
  INTO v_allowed
  FROM tanaghom.conversations conversation
  JOIN tanaghom.organization_crm_policies policy ON policy.organization_id=conversation.organization_id
  JOIN tanaghom.automation_platform_controls platform ON platform.provider='ghl'
  WHERE conversation.id=p_conversation_id FOR UPDATE OF conversation;
  IF NOT coalesce(v_allowed,false) THEN RAISE EXCEPTION 'AI reply authority lost before dispatch'; END IF;
END;
$$;

CREATE FUNCTION tanaghom.create_conversation_human_reply_draft(
  p_conversation_id uuid,p_actor_user_id uuid,p_expected_epoch bigint,
  p_body text,p_language text,p_command_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor tanaghom.app_users%ROWTYPE;
  v_conversation tanaghom.conversations%ROWTYPE;
  v_existing uuid;
  v_id uuid;
BEGIN
  SELECT id INTO v_existing FROM tanaghom.conversation_human_reply_drafts
   WHERE command_id=p_command_id AND conversation_id=p_conversation_id;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_user_id AND kind='human'
    AND role IN ('owner','reviewer','operator') AND is_active AND accepted_at IS NOT NULL;
  SELECT * INTO v_conversation FROM tanaghom.conversations WHERE id=p_conversation_id
    AND organization_id=v_actor.organization_id FOR UPDATE;
  IF v_actor.id IS NULL OR v_conversation.id IS NULL OR v_conversation.state<>'human_owned'
     OR v_conversation.reply_authority<>'human' OR v_conversation.owner_user_id<>v_actor.id
     OR v_conversation.ownership_epoch<>p_expected_epoch THEN
    RAISE EXCEPTION 'current human reply authority required';
  END IF;
  IF p_language NOT IN ('en','ar') OR length(trim(coalesce(p_body,''))) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'invalid supervised reply draft';
  END IF;
  INSERT INTO tanaghom.conversation_human_reply_drafts (
    organization_id,conversation_id,author_user_id,command_id,ownership_epoch,body,language
  ) VALUES (
    v_actor.organization_id,v_conversation.id,v_actor.id,p_command_id,p_expected_epoch,trim(p_body),p_language
  ) RETURNING id INTO v_id;
  UPDATE tanaghom.conversations SET last_activity_at=statement_timestamp(),
    conversation_version=conversation_version+1 WHERE id=v_conversation.id;
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result
  ) VALUES (p_command_id,v_actor.id,'conversation.reply_drafted','conversation',v_conversation.id,
    jsonb_build_object('draft_id',v_id,'ownership_epoch',p_expected_epoch,'external_action_count',0),'success');
  RETURN v_id;
END;
$$;

CREATE FUNCTION tanaghom.set_organization_conversation_emergency_stop(
  p_active boolean,p_reason text,p_actor_user_id uuid,p_command_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_actor tanaghom.app_users%ROWTYPE; v_count integer;
BEGIN
  SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_user_id AND kind='human'
    AND role='owner' AND is_active AND accepted_at IS NOT NULL;
  IF v_actor.id IS NULL OR p_command_id IS NULL OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'active owner, command, and emergency reason required';
  END IF;
  UPDATE tanaghom.organization_crm_policies SET conversation_emergency_stop=p_active,
    conversation_emergency_reason=trim(p_reason),conversation_emergency_changed_by=v_actor.id,
    conversation_emergency_changed_at=statement_timestamp() WHERE organization_id=v_actor.organization_id;
  IF p_active THEN
    WITH prior AS (
      SELECT * FROM tanaghom.conversations WHERE organization_id=v_actor.organization_id
        AND state NOT IN ('resolved','paused') FOR UPDATE
    ), changed AS (
      UPDATE tanaghom.conversations conversation SET state='paused',reply_authority='none',
        owner_user_id=NULL,ownership_epoch=conversation.ownership_epoch+1,lease_token=NULL,
        lease_expires_at=NULL,ownership_reason=trim(p_reason),emergency_paused=true,
        conversation_version=conversation.conversation_version+1
      FROM prior WHERE conversation.id=prior.id
      RETURNING conversation.*,prior.state AS previous_state,
        prior.reply_authority AS previous_authority,prior.owner_user_id AS previous_owner
    )
    INSERT INTO tanaghom.conversation_ownership_history (
      organization_id,conversation_id,command_id,action,actor_user_id,actor_role,
      previous_state,new_state,previous_reply_authority,new_reply_authority,
      previous_owner_user_id,new_owner_user_id,reason,ownership_epoch,result_version
    ) SELECT organization_id,id,gen_random_uuid(),'organization_emergency_pause',v_actor.id,'owner',
      previous_state,state,previous_authority,reply_authority,previous_owner,owner_user_id,
      trim(p_reason),ownership_epoch,conversation_version FROM changed;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE v_count := 0;
  END IF;
  INSERT INTO tanaghom.agent_actions_log (
    correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result
  ) VALUES (p_command_id,v_actor.id,
    CASE WHEN p_active THEN 'conversation.organization_emergency_pause' ELSE 'conversation.organization_emergency_resume' END,
    'organization',v_actor.organization_id,jsonb_build_object('reason',trim(p_reason),'affected',v_count),'success');
  RETURN v_count;
END;
$$;

REVOKE ALL ON tanaghom.conversations FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker;
REVOKE ALL ON tanaghom.conversation_ownership_history FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker;
REVOKE ALL ON tanaghom.conversation_ai_lease_claims FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker;
REVOKE ALL ON tanaghom.conversation_human_reply_drafts FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker;
REVOKE ALL ON tanaghom.conversation_notification_receipts FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker;
REVOKE ALL ON tanaghom.conversation_supervisor_inbox FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker;
REVOKE ALL ON FUNCTION tanaghom.sync_supervised_conversation_from_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.apply_conversation_intelligence_to_supervisor() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.apply_conversation_failure_to_supervisor() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.sweep_conversation_supervisor_alerts() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.transition_supervised_conversation(uuid,text,uuid,uuid,text,bigint,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.claim_conversation_ai_lease(uuid,bigint,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.assert_conversation_ai_reply_authority(uuid,uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.create_conversation_human_reply_draft(uuid,uuid,bigint,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.set_organization_conversation_emergency_stop(boolean,text,uuid,uuid) FROM PUBLIC;

GRANT SELECT ON tanaghom.conversations,tanaghom.conversation_ownership_history,
  tanaghom.conversation_ai_lease_claims,tanaghom.conversation_human_reply_drafts,
  tanaghom.conversation_supervisor_inbox TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.transition_supervised_conversation(uuid,text,uuid,uuid,text,bigint,uuid) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.create_conversation_human_reply_draft(uuid,uuid,bigint,text,text,uuid) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.set_organization_conversation_emergency_stop(boolean,text,uuid,uuid) TO tanaghom_api;
GRANT SELECT ON tanaghom.conversation_supervisor_inbox,tanaghom.conversation_ownership_history,
  tanaghom.conversation_human_reply_drafts TO tanaghom_readonly;
GRANT EXECUTE ON FUNCTION tanaghom.claim_conversation_ai_lease(uuid,bigint,integer,uuid) TO tanaghom_conversation_worker;
GRANT EXECUTE ON FUNCTION tanaghom.assert_conversation_ai_reply_authority(uuid,uuid,bigint) TO tanaghom_conversation_worker;
GRANT EXECUTE ON FUNCTION tanaghom.sweep_conversation_supervisor_alerts() TO tanaghom_conversation_worker;

INSERT INTO public.schema_migrations(version) VALUES ('0014_supervised_conversation_ownership');
COMMIT;
