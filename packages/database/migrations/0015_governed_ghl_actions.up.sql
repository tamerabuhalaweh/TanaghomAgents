BEGIN;

ALTER TABLE tanaghom.organization_crm_policies
  ADD COLUMN action_mode text NOT NULL DEFAULT 'manual'
    CHECK (action_mode IN ('manual','shadow','assisted','bounded_autonomous')),
  ADD COLUMN proactive_message_mode text NOT NULL DEFAULT 'disabled'
    CHECK (proactive_message_mode IN ('disabled','approved_templates')),
  ADD COLUMN action_emergency_stop boolean NOT NULL DEFAULT true,
  ADD COLUMN action_emergency_reason text NOT NULL DEFAULT 'Awaiting governed GHL action activation'
    CHECK (length(trim(action_emergency_reason)) BETWEEN 3 AND 500),
  ADD COLUMN action_allowed_channels text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (action_allowed_channels <@ ARRAY['whatsapp','sms','email','instagram','facebook','live_chat']::text[]),
  ADD COLUMN action_quiet_hours_start time NOT NULL DEFAULT time '21:00',
  ADD COLUMN action_quiet_hours_end time NOT NULL DEFAULT time '08:00',
  ADD COLUMN action_timezone text NOT NULL DEFAULT 'UTC'
    CHECK (length(action_timezone) BETWEEN 1 AND 80),
  ADD COLUMN action_contact_frequency_cap_24h integer NOT NULL DEFAULT 2
    CHECK (action_contact_frequency_cap_24h BETWEEN 1 AND 20),
  ADD COLUMN action_policy_changed_by uuid REFERENCES tanaghom.app_users(id) ON DELETE SET NULL,
  ADD COLUMN action_policy_changed_at timestamptz;

CREATE TABLE tanaghom.ghl_message_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  template_key text NOT NULL CHECK (template_key ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  version integer NOT NULL CHECK (version > 0),
  channel text NOT NULL CHECK (channel IN ('whatsapp','sms','email','instagram','facebook','live_chat')),
  purpose text NOT NULL CHECK (purpose IN ('proactive','follow_up','inbound_reply')),
  language text NOT NULL CHECK (language IN ('en','ar')),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  variables jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(variables)='array'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  created_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  retired_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  retired_at timestamptz,
  retirement_reason text CHECK (retirement_reason IS NULL OR length(trim(retirement_reason)) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,template_key,version),
  CHECK ((status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR status<>'approved'),
  CHECK ((status='retired' AND retired_by IS NOT NULL AND retired_at IS NOT NULL
    AND retirement_reason IS NOT NULL) OR status<>'retired')
);

CREATE UNIQUE INDEX ghl_message_template_one_approved_uidx
  ON tanaghom.ghl_message_template_versions(organization_id,template_key)
  WHERE status='approved';

CREATE TABLE tanaghom.ghl_contact_channel_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  contact_id text NOT NULL CHECK (length(contact_id) BETWEEN 1 AND 300),
  channel text NOT NULL CHECK (channel IN ('whatsapp','sms','email','instagram','facebook','live_chat')),
  consent_status text NOT NULL DEFAULT 'unknown'
    CHECK (consent_status IN ('unknown','opted_in','opted_out','dnd')),
  evidence text CHECK (evidence IS NULL OR length(trim(evidence)) BETWEEN 3 AND 1000),
  source_event_id uuid REFERENCES tanaghom.ghl_inbound_events(id) ON DELETE SET NULL,
  changed_by uuid REFERENCES tanaghom.app_users(id) ON DELETE SET NULL,
  consent_changed_at timestamptz NOT NULL DEFAULT now(),
  last_outbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,contact_id,channel)
);

CREATE TRIGGER ghl_contact_channel_policies_updated_at
BEFORE UPDATE ON tanaghom.ghl_contact_channel_policies
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE TABLE tanaghom.ghl_action_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES tanaghom.conversations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES tanaghom.leads(id) ON DELETE SET NULL,
  contact_id text NOT NULL CHECK (length(contact_id) BETWEEN 1 AND 300),
  action_type text NOT NULL CHECK (action_type IN (
    'message','qualification','tag','assignment','appointment','opportunity','nurture','won','lost'
  )),
  direction text NOT NULL CHECK (direction IN ('inbound','proactive','internal')),
  channel text CHECK (channel IS NULL OR channel IN (
    'whatsapp','sms','email','instagram','facebook','live_chat','system'
  )),
  contract_version text NOT NULL DEFAULT 'phase5.ghl-action-job.v1'
    CHECK (contract_version='phase5.ghl-action-job.v1'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  policy_snapshot jsonb NOT NULL CHECK (jsonb_typeof(policy_snapshot)='object'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^md5:[0-9a-f]{32}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 300),
  status text NOT NULL CHECK (status IN (
    'shadowed','awaiting_approval','queued','claimed','dispatching','succeeded',
    'failed','canceled','indeterminate'
  )),
  template_version_id uuid REFERENCES tanaghom.ghl_message_template_versions(id) ON DELETE RESTRICT,
  initiating_event_id uuid REFERENCES tanaghom.ghl_inbound_events(id) ON DELETE RESTRICT,
  proposal_id uuid REFERENCES tanaghom.conversation_intelligence_proposals(id) ON DELETE RESTRICT,
  requested_by_user_id uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  requested_by_agent_id uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  ownership_epoch bigint NOT NULL CHECK (ownership_epoch >= 0),
  lease_token uuid,
  external_operation_id uuid REFERENCES tanaghom.external_operations(id) ON DELETE RESTRICT,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  dispatched_at timestamptz,
  finished_at timestamptz,
  provider_reference text,
  result jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,idempotency_key),
  CHECK ((requested_by_user_id IS NOT NULL)::integer + (requested_by_agent_id IS NOT NULL)::integer = 1),
  CHECK ((action_type='message' AND channel IS NOT NULL) OR action_type<>'message'),
  CHECK ((direction='proactive' AND action_type='message' AND template_version_id IS NOT NULL)
    OR direction<>'proactive'),
  CHECK ((status IN ('succeeded','failed','canceled','indeterminate') AND finished_at IS NOT NULL)
    OR status NOT IN ('succeeded','failed','canceled','indeterminate'))
);

CREATE TRIGGER ghl_action_jobs_updated_at
BEFORE UPDATE ON tanaghom.ghl_action_jobs
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE INDEX ghl_action_claim_idx
  ON tanaghom.ghl_action_jobs(status,available_at,created_at)
  WHERE status='queued';
CREATE INDEX ghl_action_contact_history_idx
  ON tanaghom.ghl_action_jobs(organization_id,contact_id,created_at DESC);

CREATE TABLE tanaghom.ghl_action_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  action_job_id uuid NOT NULL REFERENCES tanaghom.ghl_action_jobs(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  decided_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  command_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,command_id),
  UNIQUE (action_job_id)
);

CREATE TABLE tanaghom.ghl_action_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  action_job_id uuid NOT NULL REFERENCES tanaghom.ghl_action_jobs(id) ON DELETE CASCADE,
  outcome_type text NOT NULL CHECK (outcome_type IN (
    'shadowed','approved','rejected','dispatched','delivered','read','failed','canceled','indeterminate','reconciled'
  )),
  provider_event_id text,
  provider_reference text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (action_job_id,outcome_type,provider_event_id)
);

CREATE FUNCTION tanaghom.prevent_ghl_action_outcome_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'GHL action outcomes are append-only'; END;
$$;
CREATE TRIGGER ghl_action_outcome_no_update BEFORE UPDATE ON tanaghom.ghl_action_outcomes
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_ghl_action_outcome_mutation();
CREATE TRIGGER ghl_action_outcome_no_delete BEFORE DELETE ON tanaghom.ghl_action_outcomes
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_ghl_action_outcome_mutation();

CREATE VIEW tanaghom.ghl_action_automation_status AS
SELECT policy.organization_id,policy.action_mode,policy.proactive_message_mode,
  policy.action_emergency_stop,policy.action_emergency_reason,policy.action_allowed_channels,
  policy.action_quiet_hours_start,policy.action_quiet_hours_end,policy.action_timezone,
  policy.action_contact_frequency_cap_24h,policy.action_policy_changed_by,policy.action_policy_changed_at,
  coalesce(control.emergency_stop,true) AS platform_emergency_stop,
  EXISTS (SELECT 1 FROM tanaghom.integration_connections connection
    WHERE connection.organization_id=policy.organization_id AND connection.provider='ghl'
      AND connection.status='connected') AS connection_ready,
  NOT EXISTS (SELECT 1 FROM tanaghom.ghl_action_jobs job
    WHERE job.organization_id=policy.organization_id AND job.status='indeterminate') AS operations_clear
FROM tanaghom.organization_crm_policies policy
LEFT JOIN tanaghom.automation_platform_controls control ON control.provider='ghl';

CREATE FUNCTION tanaghom.set_ghl_action_automation_mode(
  p_actor_user_id uuid,p_mode text,p_runtime_ready boolean,p_command_id uuid
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_actor tanaghom.app_users%ROWTYPE; v_status tanaghom.ghl_action_automation_status%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_user_id AND kind='human'
    AND role='owner' AND is_active AND accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active owner required'; END IF;
  IF p_mode NOT IN ('manual','shadow','assisted','bounded_autonomous') OR p_command_id IS NULL THEN
    RAISE EXCEPTION 'valid GHL action mode and command required';
  END IF;
  PERFORM 1 FROM tanaghom.organization_crm_policies
   WHERE organization_id=v_actor.organization_id FOR UPDATE;
  SELECT * INTO v_status FROM tanaghom.ghl_action_automation_status
   WHERE organization_id=v_actor.organization_id;
  IF p_mode<>'manual' AND NOT p_runtime_ready THEN RAISE EXCEPTION 'GHL action runtime is not ready'; END IF;
  IF p_mode<>'manual' AND (v_status.platform_emergency_stop OR v_status.action_emergency_stop) THEN
    RAISE EXCEPTION 'GHL action emergency stop is active';
  END IF;
  IF p_mode<>'manual' AND NOT v_status.connection_ready THEN RAISE EXCEPTION 'connected GHL integration required'; END IF;
  IF p_mode<>'manual' AND NOT v_status.operations_clear THEN RAISE EXCEPTION 'indeterminate GHL action exists'; END IF;
  UPDATE tanaghom.organization_crm_policies SET action_mode=p_mode,
    action_policy_changed_by=v_actor.id,action_policy_changed_at=statement_timestamp()
    WHERE organization_id=v_actor.organization_id;
  INSERT INTO tanaghom.agent_actions_log
    (correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
  VALUES (p_command_id,v_actor.id,'ghl.action_mode_changed','organization',v_actor.organization_id,
    jsonb_build_object('mode',p_mode,'runtime_ready',p_runtime_ready),'success');
  RETURN p_mode;
END;
$$;

CREATE FUNCTION tanaghom.set_ghl_action_emergency_stop(
  p_actor_user_id uuid,p_active boolean,p_reason text,p_runtime_ready boolean,p_command_id uuid
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_actor tanaghom.app_users%ROWTYPE; v_status tanaghom.ghl_action_automation_status%ROWTYPE; v_count integer;
BEGIN
  SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_user_id AND kind='human'
    AND role='owner' AND is_active AND accepted_at IS NOT NULL;
  IF v_actor.id IS NULL OR p_command_id IS NULL
     OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'active owner, command, and emergency reason required';
  END IF;
  PERFORM 1 FROM tanaghom.organization_crm_policies
   WHERE organization_id=v_actor.organization_id FOR UPDATE;
  SELECT * INTO v_status FROM tanaghom.ghl_action_automation_status
   WHERE organization_id=v_actor.organization_id;
  IF NOT p_active AND (NOT p_runtime_ready OR v_status.platform_emergency_stop
      OR NOT v_status.connection_ready OR NOT v_status.operations_clear) THEN
    RAISE EXCEPTION 'GHL action runtime is not ready for emergency resume';
  END IF;
  UPDATE tanaghom.organization_crm_policies SET action_emergency_stop=p_active,
    action_emergency_reason=trim(p_reason),action_policy_changed_by=v_actor.id,
    action_policy_changed_at=statement_timestamp() WHERE organization_id=v_actor.organization_id;
  IF p_active THEN
    UPDATE tanaghom.ghl_action_jobs SET status='canceled',finished_at=statement_timestamp(),
      error_code='emergency_stopped',error_message=trim(p_reason)
    WHERE organization_id=v_actor.organization_id AND status IN ('queued','awaiting_approval');
    GET DIAGNOSTICS v_count=ROW_COUNT;
    INSERT INTO tanaghom.ghl_action_outcomes (organization_id,action_job_id,outcome_type,details)
    SELECT organization_id,id,'canceled',jsonb_build_object('reason',trim(p_reason),'scope','organization')
    FROM tanaghom.ghl_action_jobs WHERE organization_id=v_actor.organization_id
      AND status='canceled' AND error_code='emergency_stopped'
    ON CONFLICT DO NOTHING;
  ELSE v_count:=0;
  END IF;
  INSERT INTO tanaghom.agent_actions_log
    (correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
  VALUES (p_command_id,v_actor.id,CASE WHEN p_active THEN 'ghl.action_emergency_stopped'
    ELSE 'ghl.action_emergency_resumed' END,'organization',v_actor.organization_id,
    jsonb_build_object('reason',trim(p_reason),'canceled_jobs',v_count),'success');
  RETURN v_count;
END;
$$;

CREATE FUNCTION tanaghom.queue_ghl_action(
  p_conversation_id uuid,p_action_type text,p_direction text,p_channel text,p_payload jsonb,
  p_template_version_id uuid,p_initiating_event_id uuid,p_actor_user_id uuid,
  p_expected_epoch bigint,p_lease_token uuid,p_idempotency_key text
)
RETURNS TABLE (job_id uuid,status text,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_conversation tanaghom.conversations%ROWTYPE;
  v_policy tanaghom.organization_crm_policies%ROWTYPE;
  v_actor tanaghom.app_users%ROWTYPE;
  v_template tanaghom.ghl_message_template_versions%ROWTYPE;
  v_contact_policy tanaghom.ghl_contact_channel_policies%ROWTYPE;
  v_existing tanaghom.ghl_action_jobs%ROWTYPE;
  v_job tanaghom.ghl_action_jobs%ROWTYPE;
  v_platform_stop boolean;
  v_status text;
  v_local_time time;
  v_quiet boolean;
  v_frequency integer;
  v_fingerprint text;
  v_agent_id uuid;
BEGIN
  IF p_action_type NOT IN ('message','qualification','tag','assignment','appointment','opportunity','nurture','won','lost')
     OR p_direction NOT IN ('inbound','proactive','internal') OR p_payload IS NULL
     OR jsonb_typeof(p_payload)<>'object' OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 300
     OR p_expected_epoch IS NULL OR p_expected_epoch<0 THEN RAISE EXCEPTION 'invalid GHL action contract'; END IF;
  IF p_action_type='message' AND p_channel NOT IN ('whatsapp','sms','email','instagram','facebook','live_chat') THEN
    RAISE EXCEPTION 'valid message channel required';
  END IF;
  IF p_action_type='message' AND length(trim(coalesce(p_payload->>'message',''))) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'bounded message body required';
  END IF;
  IF p_action_type='qualification' AND (
      p_payload->>'temperature' NOT IN ('hot','warm','cold')
      OR length(trim(coalesce(p_payload->>'reason',''))) NOT BETWEEN 3 AND 1000
      OR length(trim(coalesce(p_payload->>'next_action',''))) NOT BETWEEN 3 AND 500
      OR jsonb_typeof(p_payload->'confidence')<>'number'
      OR (p_payload->>'confidence')::numeric NOT BETWEEN 0 AND 1
    ) THEN RAISE EXCEPTION 'valid qualification payload required'; END IF;
  IF p_action_type IN ('won','lost') AND length(trim(coalesce(p_payload->>'opportunity_id',''))) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'opportunity reference required';
  END IF;
  SELECT * INTO v_conversation FROM tanaghom.conversations WHERE id=p_conversation_id FOR UPDATE;
  IF v_conversation.id IS NULL OR v_conversation.contact_id IS NULL THEN RAISE EXCEPTION 'conversation contact required'; END IF;
  SELECT * INTO v_policy FROM tanaghom.organization_crm_policies
   WHERE organization_id=v_conversation.organization_id FOR UPDATE;
  SELECT emergency_stop INTO v_platform_stop FROM tanaghom.automation_platform_controls WHERE provider='ghl';
  IF coalesce(v_platform_stop,true) OR v_policy.action_emergency_stop OR v_conversation.emergency_paused
     OR v_conversation.state IN ('paused','resolved','failed') THEN RAISE EXCEPTION 'GHL action emergency or conversation stop is active'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tanaghom.integration_connections connection
    WHERE connection.organization_id=v_conversation.organization_id AND connection.provider='ghl'
      AND connection.status='connected') THEN RAISE EXCEPTION 'connected GHL integration required'; END IF;
  IF EXISTS (SELECT 1 FROM tanaghom.ghl_action_jobs uncertain
    WHERE uncertain.organization_id=v_conversation.organization_id AND uncertain.status='indeterminate') THEN
    RAISE EXCEPTION 'indeterminate GHL action exists';
  END IF;
  v_fingerprint:='md5:'||md5(p_payload::text);
  SELECT * INTO v_existing FROM tanaghom.ghl_action_jobs
   WHERE organization_id=v_conversation.organization_id AND idempotency_key=p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.request_fingerprint<>v_fingerprint OR v_existing.action_type<>p_action_type THEN
      RAISE EXCEPTION 'GHL action idempotency conflict';
    END IF;
    RETURN QUERY SELECT v_existing.id,v_existing.status,true; RETURN;
  END IF;
  IF p_actor_user_id IS NOT NULL THEN
    SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_user_id AND kind='human'
      AND role IN ('owner','reviewer','operator') AND is_active AND accepted_at IS NOT NULL
      AND organization_id=v_conversation.organization_id;
    IF v_actor.id IS NULL THEN RAISE EXCEPTION 'authorized human actor required'; END IF;
    IF p_action_type='message' AND (v_conversation.state<>'human_owned'
       OR v_conversation.reply_authority<>'human' OR v_conversation.owner_user_id<>v_actor.id
       OR v_conversation.ownership_epoch<>p_expected_epoch) THEN
      RAISE EXCEPTION 'current human reply authority required';
    END IF;
  ELSE
    SELECT id INTO v_agent_id FROM tanaghom.app_users WHERE kind='service' AND role='service'
      AND organization_id=v_conversation.organization_id AND is_active ORDER BY created_at LIMIT 1;
    IF v_agent_id IS NULL THEN RAISE EXCEPTION 'active organization service actor required'; END IF;
    IF p_action_type='message' AND (v_conversation.state<>'ai_owned' OR v_conversation.reply_authority<>'ai'
       OR v_conversation.ownership_epoch<>p_expected_epoch OR v_conversation.lease_token IS DISTINCT FROM p_lease_token
       OR v_conversation.lease_expires_at<=statement_timestamp()) THEN
      RAISE EXCEPTION 'current AI reply authority required';
    END IF;
  END IF;
  IF p_direction='proactive' THEN
    IF p_action_type<>'message' OR v_policy.proactive_message_mode<>'approved_templates'
       OR NOT (p_channel=ANY(v_policy.action_allowed_channels)) THEN
      RAISE EXCEPTION 'proactive messaging policy denied';
    END IF;
    SELECT template.* INTO v_template FROM tanaghom.ghl_message_template_versions template
     WHERE template.id=p_template_version_id AND template.organization_id=v_conversation.organization_id
       AND template.channel=p_channel AND template.purpose IN ('proactive','follow_up')
       AND template.status='approved';
    IF v_template.id IS NULL THEN RAISE EXCEPTION 'active approved message template required'; END IF;
    SELECT * INTO v_contact_policy FROM tanaghom.ghl_contact_channel_policies
     WHERE organization_id=v_conversation.organization_id AND contact_id=v_conversation.contact_id
       AND channel=p_channel FOR UPDATE;
    IF v_contact_policy.id IS NULL OR v_contact_policy.consent_status<>'opted_in' THEN
      RAISE EXCEPTION 'explicit channel consent required';
    END IF;
    v_local_time:=(statement_timestamp() AT TIME ZONE v_policy.action_timezone)::time;
    v_quiet:=CASE WHEN v_policy.action_quiet_hours_start<v_policy.action_quiet_hours_end
      THEN v_local_time>=v_policy.action_quiet_hours_start AND v_local_time<v_policy.action_quiet_hours_end
      ELSE v_local_time>=v_policy.action_quiet_hours_start OR v_local_time<v_policy.action_quiet_hours_end END;
    IF v_quiet THEN RAISE EXCEPTION 'organization quiet hours block proactive messaging'; END IF;
    SELECT count(*) INTO v_frequency FROM tanaghom.ghl_action_jobs prior
     WHERE prior.organization_id=v_conversation.organization_id AND prior.contact_id=v_conversation.contact_id
       AND prior.action_type='message' AND prior.status='succeeded'
       AND prior.created_at>statement_timestamp()-interval '24 hours';
    IF v_frequency>=v_policy.action_contact_frequency_cap_24h THEN RAISE EXCEPTION 'contact frequency cap reached'; END IF;
  ELSIF p_action_type='message' THEN
    IF p_direction<>'inbound' OR v_conversation.latest_proposal_id IS NULL THEN
      RAISE EXCEPTION 'grounded inbound proposal required';
    END IF;
  END IF;
  IF v_policy.action_mode='manual' AND v_actor.id IS NULL THEN RAISE EXCEPTION 'manual mode requires human action'; END IF;
  v_status:=CASE
    WHEN v_policy.action_mode='shadow' AND v_actor.id IS NULL THEN 'shadowed'
    WHEN v_actor.id IS NULL AND (v_policy.action_mode='assisted'
      OR p_action_type IN ('appointment','opportunity','won','lost') OR p_direction='proactive') THEN 'awaiting_approval'
    ELSE 'queued' END;
  INSERT INTO tanaghom.ghl_action_jobs (
    correlation_id,organization_id,conversation_id,lead_id,contact_id,action_type,direction,channel,
    payload,policy_snapshot,request_fingerprint,idempotency_key,status,template_version_id,
    initiating_event_id,proposal_id,requested_by_user_id,requested_by_agent_id,ownership_epoch,
    lease_token,finished_at,result
  ) VALUES (
    gen_random_uuid(),v_conversation.organization_id,v_conversation.id,v_conversation.lead_id,
    v_conversation.contact_id,p_action_type,p_direction,CASE WHEN p_action_type='message' THEN p_channel ELSE 'system' END,
    p_payload,jsonb_build_object('mode',v_policy.action_mode,'proactive_mode',v_policy.proactive_message_mode,
      'channel',p_channel,'frequency_cap_24h',v_policy.action_contact_frequency_cap_24h),
    v_fingerprint,p_idempotency_key,v_status,p_template_version_id,p_initiating_event_id,
    v_conversation.latest_proposal_id,v_actor.id,CASE WHEN v_actor.id IS NULL THEN v_agent_id END,
    p_expected_epoch,p_lease_token,CASE WHEN v_status='shadowed' THEN statement_timestamp() END,
    CASE WHEN v_status='shadowed' THEN jsonb_build_object('contract_version','phase5.ghl-action-result.v1',
      'outcome','shadowed','provider_reference',NULL) END
  ) RETURNING * INTO v_job;
  IF v_status='shadowed' THEN
    INSERT INTO tanaghom.ghl_action_outcomes (organization_id,action_job_id,outcome_type,details)
    VALUES (v_job.organization_id,v_job.id,'shadowed',jsonb_build_object('external_action_count',0));
  END IF;
  INSERT INTO tanaghom.agent_actions_log
    (correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
  VALUES (v_job.correlation_id,v_actor.id,'ghl.action_queued','conversation',v_conversation.id,
    jsonb_build_object('job_id',v_job.id,'action_type',p_action_type,'direction',p_direction,
      'status',v_status,'policy',v_job.policy_snapshot),CASE WHEN v_status='shadowed' THEN 'skipped' ELSE 'success' END);
  RETURN QUERY SELECT v_job.id,v_job.status,false;
END;
$$;

CREATE FUNCTION tanaghom.decide_ghl_action(
  p_job_id uuid,p_actor_user_id uuid,p_decision text,p_reason text,p_command_id uuid
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_actor tanaghom.app_users%ROWTYPE; v_job tanaghom.ghl_action_jobs%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_user_id AND kind='human'
    AND role IN ('owner','reviewer') AND is_active AND accepted_at IS NOT NULL;
  SELECT * INTO v_job FROM tanaghom.ghl_action_jobs WHERE id=p_job_id
    AND organization_id=v_actor.organization_id FOR UPDATE;
  IF v_actor.id IS NULL OR v_job.id IS NULL OR v_job.status<>'awaiting_approval'
     OR p_decision NOT IN ('approved','rejected') OR p_command_id IS NULL
     OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'valid human GHL action decision required';
  END IF;
  IF p_decision='approved' AND EXISTS (SELECT 1 FROM tanaghom.ghl_action_automation_status status
    WHERE status.organization_id=v_actor.organization_id AND (status.platform_emergency_stop
      OR status.action_emergency_stop OR NOT status.connection_ready OR NOT status.operations_clear)) THEN
    RAISE EXCEPTION 'GHL action policy no longer permits approval';
  END IF;
  v_status:=CASE WHEN p_decision='approved' THEN 'queued' ELSE 'canceled' END;
  INSERT INTO tanaghom.ghl_action_approvals
    (organization_id,action_job_id,decision,decided_by,reason,command_id)
  VALUES (v_actor.organization_id,v_job.id,p_decision,v_actor.id,trim(p_reason),p_command_id);
  UPDATE tanaghom.ghl_action_jobs SET status=v_status,
    finished_at=CASE WHEN v_status='canceled' THEN statement_timestamp() END,
    error_code=CASE WHEN v_status='canceled' THEN 'human_rejected' END,
    error_message=CASE WHEN v_status='canceled' THEN trim(p_reason) END WHERE id=v_job.id;
  INSERT INTO tanaghom.ghl_action_outcomes (organization_id,action_job_id,outcome_type,details)
  VALUES (v_actor.organization_id,v_job.id,p_decision,jsonb_build_object('reason',trim(p_reason),'actor',v_actor.id));
  INSERT INTO tanaghom.agent_actions_log
    (correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
  VALUES (p_command_id,v_actor.id,'ghl.action_'||p_decision,'ghl_action_job',v_job.id,
    jsonb_build_object('reason',trim(p_reason),'next_status',v_status),'success');
  RETURN v_status;
END;
$$;

CREATE FUNCTION tanaghom.claim_ghl_action_job()
RETURNS TABLE (job_id uuid,action_type text,attempt integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_job tanaghom.ghl_action_jobs%ROWTYPE;
BEGIN
  SELECT job.* INTO v_job FROM tanaghom.ghl_action_jobs job
  JOIN tanaghom.organization_crm_policies policy ON policy.organization_id=job.organization_id
  JOIN tanaghom.automation_platform_controls control ON control.provider='ghl'
  JOIN tanaghom.integration_connections connection ON connection.organization_id=job.organization_id
    AND connection.provider='ghl' AND connection.status='connected'
  WHERE job.status='queued' AND job.available_at<=statement_timestamp()
    AND NOT control.emergency_stop AND NOT policy.action_emergency_stop
    AND NOT EXISTS (SELECT 1 FROM tanaghom.ghl_action_jobs uncertain
      WHERE uncertain.organization_id=job.organization_id AND uncertain.status='indeterminate')
  ORDER BY job.available_at,job.created_at FOR UPDATE OF job SKIP LOCKED LIMIT 1;
  IF v_job.id IS NULL THEN RETURN; END IF;
  UPDATE tanaghom.ghl_action_jobs claimed SET status='claimed',attempt=claimed.attempt+1,
    claimed_at=statement_timestamp()
   WHERE id=v_job.id RETURNING * INTO v_job;
  RETURN QUERY SELECT v_job.id,v_job.action_type,v_job.attempt;
END;
$$;

CREATE FUNCTION tanaghom.prepare_ghl_action_dispatch(p_job_id uuid)
RETURNS TABLE (job_id uuid,operation_id uuid,action_type text,idempotency_key text,request_body jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_job tanaghom.ghl_action_jobs%ROWTYPE; v_conversation tanaghom.conversations%ROWTYPE;
  v_operation tanaghom.external_operations%ROWTYPE; v_request jsonb;
BEGIN
  SELECT * INTO v_job FROM tanaghom.ghl_action_jobs WHERE id=p_job_id AND status='claimed' FOR UPDATE;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'claimed GHL action job required'; END IF;
  SELECT * INTO v_conversation FROM tanaghom.conversations WHERE id=v_job.conversation_id FOR UPDATE;
  IF v_conversation.id IS NULL OR v_conversation.emergency_paused OR v_conversation.state IN ('paused','resolved','failed')
     OR v_conversation.ownership_epoch<>v_job.ownership_epoch THEN RAISE EXCEPTION 'GHL action ownership changed before dispatch'; END IF;
  IF v_job.requested_by_user_id IS NOT NULL AND v_job.action_type='message' AND
     (v_conversation.state<>'human_owned' OR v_conversation.reply_authority<>'human'
      OR v_conversation.owner_user_id<>v_job.requested_by_user_id) THEN
    RAISE EXCEPTION 'human reply authority lost before dispatch';
  END IF;
  IF v_job.requested_by_agent_id IS NOT NULL AND v_job.action_type='message' THEN
    PERFORM tanaghom.assert_conversation_ai_reply_authority(v_conversation.id,v_job.lease_token,v_job.ownership_epoch);
  END IF;
  IF EXISTS (SELECT 1 FROM tanaghom.ghl_action_automation_status status
    WHERE status.organization_id=v_job.organization_id AND (status.platform_emergency_stop
      OR status.action_emergency_stop OR NOT status.connection_ready OR NOT status.operations_clear)) THEN
    RAISE EXCEPTION 'GHL action policy changed before dispatch';
  END IF;
  IF v_job.direction='proactive' AND NOT EXISTS (
    SELECT 1 FROM tanaghom.ghl_contact_channel_policies contact_policy
    JOIN tanaghom.ghl_message_template_versions template ON template.id=v_job.template_version_id
    WHERE contact_policy.organization_id=v_job.organization_id AND contact_policy.contact_id=v_job.contact_id
      AND contact_policy.channel=v_job.channel AND contact_policy.consent_status='opted_in'
      AND template.organization_id=v_job.organization_id AND template.status='approved'
  ) THEN RAISE EXCEPTION 'proactive consent or template was revoked before dispatch'; END IF;
  v_request:=jsonb_build_object('contract_version','phase5.ghl-action-dispatch.v1',
    'action_type',v_job.action_type,'contact_id',v_job.contact_id,
    'conversation_id',v_conversation.provider_conversation_id,'channel',v_job.channel,
    'payload',v_job.payload);
  SELECT * INTO v_operation FROM tanaghom.external_operations operation
   WHERE operation.provider='ghl' AND operation.operation_type='action.'||v_job.action_type
     AND operation.idempotency_key=v_job.idempotency_key FOR UPDATE;
  IF v_operation.id IS NULL THEN
    INSERT INTO tanaghom.external_operations
      (correlation_id,provider,operation_type,idempotency_key,status,request_fingerprint,attempt)
    VALUES (v_job.correlation_id,'ghl','action.'||v_job.action_type,v_job.idempotency_key,
      'in_progress','md5:'||md5(v_request::text),v_job.attempt) RETURNING * INTO v_operation;
  ELSIF v_operation.status='failed' AND v_operation.request_fingerprint='md5:'||md5(v_request::text) THEN
    UPDATE tanaghom.external_operations SET status='in_progress',response_summary=NULL,attempt=v_job.attempt
     WHERE id=v_operation.id RETURNING * INTO v_operation;
  ELSE RAISE EXCEPTION 'GHL provider operation cannot be replayed'; END IF;
  UPDATE tanaghom.ghl_action_jobs SET status='dispatching',external_operation_id=v_operation.id,
    dispatched_at=statement_timestamp() WHERE id=v_job.id;
  INSERT INTO tanaghom.ghl_action_outcomes (organization_id,action_job_id,outcome_type,details)
  VALUES (v_job.organization_id,v_job.id,'dispatched',jsonb_build_object('operation_id',v_operation.id));
  RETURN QUERY SELECT v_job.id,v_operation.id,v_job.action_type,v_job.idempotency_key,v_request;
END;
$$;

CREATE FUNCTION tanaghom.complete_ghl_action(p_job_id uuid,p_result jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_job tanaghom.ghl_action_jobs%ROWTYPE; v_reference text;
BEGIN
  IF p_result IS NULL OR jsonb_typeof(p_result)<>'object'
     OR p_result->>'contract_version'<>'phase5.ghl-action-result.v1'
     OR p_result->>'outcome'<>'succeeded' THEN RAISE EXCEPTION 'invalid GHL action result contract'; END IF;
  SELECT * INTO v_job FROM tanaghom.ghl_action_jobs WHERE id=p_job_id AND status='dispatching' FOR UPDATE;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'dispatching GHL action job required'; END IF;
  v_reference=nullif(trim(coalesce(p_result->>'provider_reference','')),'');
  UPDATE tanaghom.external_operations SET status='succeeded',provider_reference=v_reference,
    response_summary=jsonb_build_object('outcome','succeeded') WHERE id=v_job.external_operation_id AND status='in_progress';
  IF NOT FOUND THEN RAISE EXCEPTION 'matching GHL provider operation is not in progress'; END IF;
  UPDATE tanaghom.ghl_action_jobs SET status='succeeded',provider_reference=v_reference,result=p_result,
    finished_at=statement_timestamp(),error_code=NULL,error_message=NULL WHERE id=v_job.id;
  IF v_job.action_type='message' THEN
    UPDATE tanaghom.ghl_contact_channel_policies SET last_outbound_at=statement_timestamp()
     WHERE organization_id=v_job.organization_id AND contact_id=v_job.contact_id AND channel=v_job.channel;
  ELSIF v_job.action_type='qualification' THEN
    UPDATE tanaghom.leads SET status='qualified',temperature=v_job.payload->>'temperature',
      last_touch_at=statement_timestamp() WHERE id=v_job.lead_id;
    UPDATE tanaghom.conversations SET qualification_state=jsonb_build_object(
      'temperature',v_job.payload->>'temperature','reason',v_job.payload->>'reason',
      'confidence',v_job.payload->'confidence','next_action',v_job.payload->>'next_action',
      'action_job_id',v_job.id),conversation_version=conversation_version+1
      WHERE id=v_job.conversation_id;
  ELSIF v_job.action_type='won' THEN UPDATE tanaghom.leads SET status='won',last_touch_at=statement_timestamp() WHERE id=v_job.lead_id;
  ELSIF v_job.action_type='lost' THEN UPDATE tanaghom.leads SET status='lost',last_touch_at=statement_timestamp() WHERE id=v_job.lead_id;
  ELSIF v_job.action_type='nurture' THEN UPDATE tanaghom.leads SET status='nurture',last_touch_at=statement_timestamp() WHERE id=v_job.lead_id;
  END IF;
  INSERT INTO tanaghom.ghl_action_outcomes (organization_id,action_job_id,outcome_type,provider_reference,details)
  VALUES (v_job.organization_id,v_job.id,'delivered',v_reference,p_result);
  INSERT INTO tanaghom.agent_actions_log
    (correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
  VALUES (v_job.correlation_id,v_job.requested_by_user_id,'ghl.action_succeeded','ghl_action_job',v_job.id,
    jsonb_build_object('action_type',v_job.action_type,'provider_reference',v_reference),'success');
  RETURN coalesce(v_reference,'succeeded');
END;
$$;

CREATE FUNCTION tanaghom.record_ghl_action_failure(
  p_job_id uuid,p_error_code text,p_error_message text,p_http_status integer,p_retry_after_seconds integer DEFAULT 300
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_job tanaghom.ghl_action_jobs%ROWTYPE; v_status text;
BEGIN
  IF length(trim(coalesce(p_error_code,'')))<1 OR length(trim(coalesce(p_error_message,'')))<1
     OR p_http_status NOT BETWEEN 0 AND 599 OR p_retry_after_seconds NOT BETWEEN 0 AND 86400 THEN
    RAISE EXCEPTION 'valid bounded GHL action failure required';
  END IF;
  SELECT * INTO v_job FROM tanaghom.ghl_action_jobs WHERE id=p_job_id AND status='dispatching' FOR UPDATE;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'dispatching GHL action job required'; END IF;
  v_status:=CASE WHEN p_http_status=0 OR p_http_status=408 OR p_http_status>=500 THEN 'indeterminate'
    WHEN p_http_status=429 AND v_job.attempt<v_job.max_attempts THEN 'queued' ELSE 'failed' END;
  UPDATE tanaghom.external_operations SET status=CASE WHEN v_status='indeterminate' THEN 'indeterminate' ELSE 'failed' END,
    response_summary=jsonb_build_object('error_code',left(trim(p_error_code),120),'http_status',p_http_status)
    WHERE id=v_job.external_operation_id AND status='in_progress';
  IF NOT FOUND THEN RAISE EXCEPTION 'matching GHL provider operation is not in progress'; END IF;
  UPDATE tanaghom.ghl_action_jobs SET status=v_status,error_code=left(trim(p_error_code),120),
    error_message=left(trim(p_error_message),4000),available_at=CASE WHEN v_status='queued'
      THEN statement_timestamp()+make_interval(secs=>p_retry_after_seconds) ELSE available_at END,
    finished_at=CASE WHEN v_status IN ('failed','indeterminate') THEN statement_timestamp() END WHERE id=v_job.id;
  INSERT INTO tanaghom.ghl_action_outcomes (organization_id,action_job_id,outcome_type,details)
  VALUES (v_job.organization_id,v_job.id,CASE WHEN v_status='queued' THEN 'failed' ELSE v_status END,
    jsonb_build_object('error_code',left(trim(p_error_code),120),
    'http_status',p_http_status,'blind_retry_allowed',v_status='queued'));
  IF v_status='indeterminate' THEN
    INSERT INTO tanaghom.notifications (user_id,severity,title,body,entity_type,entity_id)
    SELECT app.id,'critical','GHL action requires reconciliation',
      'A provider operation timed out after dispatch. Automation is blocked until a human reconciles the outcome.',
      'ghl_action_job',v_job.id FROM tanaghom.app_users app WHERE app.organization_id=v_job.organization_id
      AND app.kind='human' AND app.role='owner' AND app.is_active AND app.accepted_at IS NOT NULL;
  END IF;
  RETURN v_status;
END;
$$;

CREATE FUNCTION tanaghom.cancel_ghl_actions_on_contact_restriction()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.consent_status NOT IN ('opted_out','dnd') OR NEW.consent_status IS NOT DISTINCT FROM OLD.consent_status THEN
    RETURN NEW;
  END IF;
  WITH changed AS (
    UPDATE tanaghom.ghl_action_jobs SET status='canceled',finished_at=statement_timestamp(),
      error_code='contact_restricted',error_message='Contact opted out or enabled DND before dispatch'
    WHERE organization_id=NEW.organization_id AND contact_id=NEW.contact_id AND channel=NEW.channel
      AND status IN ('queued','awaiting_approval') RETURNING id,organization_id
  ) INSERT INTO tanaghom.ghl_action_outcomes (organization_id,action_job_id,outcome_type,details)
    SELECT organization_id,id,'canceled',jsonb_build_object('reason','contact_restricted') FROM changed;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ghl_contact_restriction_cancels_actions
AFTER UPDATE OF consent_status ON tanaghom.ghl_contact_channel_policies
FOR EACH ROW EXECUTE FUNCTION tanaghom.cancel_ghl_actions_on_contact_restriction();

REVOKE ALL ON tanaghom.ghl_message_template_versions,tanaghom.ghl_contact_channel_policies,
  tanaghom.ghl_action_jobs,tanaghom.ghl_action_approvals,tanaghom.ghl_action_outcomes,
  tanaghom.ghl_action_automation_status FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker;
REVOKE ALL ON FUNCTION tanaghom.prevent_ghl_action_outcome_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.set_ghl_action_automation_mode(uuid,text,boolean,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.set_ghl_action_emergency_stop(uuid,boolean,text,boolean,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.queue_ghl_action(uuid,text,text,text,jsonb,uuid,uuid,uuid,bigint,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.decide_ghl_action(uuid,uuid,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.claim_ghl_action_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.prepare_ghl_action_dispatch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.complete_ghl_action(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.record_ghl_action_failure(uuid,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.cancel_ghl_actions_on_contact_restriction() FROM PUBLIC;

GRANT SELECT ON tanaghom.ghl_message_template_versions,tanaghom.ghl_contact_channel_policies,
  tanaghom.ghl_action_jobs,tanaghom.ghl_action_approvals,tanaghom.ghl_action_outcomes,
  tanaghom.ghl_action_automation_status TO tanaghom_api,tanaghom_readonly;
GRANT EXECUTE ON FUNCTION tanaghom.set_ghl_action_automation_mode(uuid,text,boolean,uuid) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.set_ghl_action_emergency_stop(uuid,boolean,text,boolean,uuid) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.queue_ghl_action(uuid,text,text,text,jsonb,uuid,uuid,uuid,bigint,uuid,text)
  TO tanaghom_api,tanaghom_conversation_worker;
GRANT EXECUTE ON FUNCTION tanaghom.decide_ghl_action(uuid,uuid,text,text,uuid) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.claim_ghl_action_job() TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.prepare_ghl_action_dispatch(uuid) TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.complete_ghl_action(uuid,jsonb) TO tanaghom_n8n_worker;
GRANT EXECUTE ON FUNCTION tanaghom.record_ghl_action_failure(uuid,text,text,integer,integer) TO tanaghom_n8n_worker;

INSERT INTO public.schema_migrations(version) VALUES ('0015_governed_ghl_actions');
COMMIT;
