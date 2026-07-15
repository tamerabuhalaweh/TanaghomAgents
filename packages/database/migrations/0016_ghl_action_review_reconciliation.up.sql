BEGIN;

CREATE FUNCTION tanaghom.attach_ghl_service_actor_to_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,pg_temp
AS $$
BEGIN
  IF NEW.actor_user_id IS NULL AND NEW.agent_id IS NULL
     AND NEW.action_type='ghl.action_queued'
     AND jsonb_typeof(NEW.payload->'job_id')='string' THEN
    BEGIN
      SELECT job.requested_by_agent_id INTO NEW.actor_user_id
      FROM tanaghom.ghl_action_jobs job
      WHERE job.id=(NEW.payload->>'job_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tanaghom.attach_ghl_service_actor_to_audit() FROM PUBLIC;

CREATE TRIGGER agent_actions_log_ghl_service_actor
BEFORE INSERT ON tanaghom.agent_actions_log
FOR EACH ROW EXECUTE FUNCTION tanaghom.attach_ghl_service_actor_to_audit();

CREATE TABLE tanaghom.ghl_action_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  action_job_id uuid NOT NULL REFERENCES tanaghom.ghl_action_jobs(id) ON DELETE RESTRICT,
  resolution text NOT NULL CHECK (resolution IN ('confirmed_succeeded','confirmed_not_applied')),
  resulting_status text NOT NULL CHECK (resulting_status IN ('succeeded','failed')),
  provider_reference text CHECK (provider_reference IS NULL OR length(provider_reference) BETWEEN 1 AND 300),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  reconciled_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_job_id),
  UNIQUE (organization_id,command_id)
);

CREATE FUNCTION tanaghom.prevent_ghl_action_reconciliation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'GHL action reconciliations are append-only'; END;
$$;
REVOKE ALL ON FUNCTION tanaghom.prevent_ghl_action_reconciliation_mutation() FROM PUBLIC;
CREATE TRIGGER ghl_action_reconciliation_no_update
BEFORE UPDATE ON tanaghom.ghl_action_reconciliations
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_ghl_action_reconciliation_mutation();
CREATE TRIGGER ghl_action_reconciliation_no_delete
BEFORE DELETE ON tanaghom.ghl_action_reconciliations
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_ghl_action_reconciliation_mutation();

CREATE FUNCTION tanaghom.reconcile_ghl_action(
  p_job_id uuid,p_actor_user_id uuid,p_resolution text,p_reason text,
  p_provider_reference text,p_command_id uuid
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_actor tanaghom.app_users%ROWTYPE;
  v_job tanaghom.ghl_action_jobs%ROWTYPE;
  v_existing tanaghom.ghl_action_reconciliations%ROWTYPE;
  v_status text;
  v_reference text:=nullif(trim(coalesce(p_provider_reference,'')),'');
BEGIN
  SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_user_id AND kind='human'
    AND role IN ('owner','reviewer') AND is_active AND accepted_at IS NOT NULL;
  IF v_actor.id IS NULL OR p_command_id IS NULL
     OR p_resolution NOT IN ('confirmed_succeeded','confirmed_not_applied')
     OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 1000
     OR length(coalesce(v_reference,''))>300 THEN
    RAISE EXCEPTION 'valid human GHL reconciliation required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor.organization_id::text||':'||p_command_id::text,0));
  SELECT * INTO v_existing FROM tanaghom.ghl_action_reconciliations
   WHERE organization_id=v_actor.organization_id AND command_id=p_command_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.action_job_id<>p_job_id OR v_existing.resolution<>p_resolution
       OR v_existing.provider_reference IS DISTINCT FROM v_reference THEN
      RAISE EXCEPTION 'GHL reconciliation command conflict';
    END IF;
    RETURN v_existing.resulting_status;
  END IF;
  SELECT * INTO v_job FROM tanaghom.ghl_action_jobs WHERE id=p_job_id
    AND organization_id=v_actor.organization_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status<>'indeterminate' OR v_job.external_operation_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM tanaghom.external_operations operation
       WHERE operation.id=v_job.external_operation_id AND operation.provider='ghl'
         AND operation.status='indeterminate') THEN
    RAISE EXCEPTION 'indeterminate organization GHL action required';
  END IF;
  v_status:=CASE WHEN p_resolution='confirmed_succeeded' THEN 'succeeded' ELSE 'failed' END;
  UPDATE tanaghom.external_operations SET status=v_status,
    provider_reference=CASE WHEN v_status='succeeded' THEN v_reference ELSE provider_reference END,
    response_summary=coalesce(response_summary,'{}'::jsonb)||jsonb_build_object(
      'reconciled',true,'resolution',p_resolution,'reason',trim(p_reason),
      'reconciled_at',statement_timestamp())
    WHERE id=v_job.external_operation_id AND status='indeterminate';
  IF NOT FOUND THEN RAISE EXCEPTION 'indeterminate provider operation changed during reconciliation'; END IF;
  UPDATE tanaghom.ghl_action_jobs SET status=v_status,
    provider_reference=CASE WHEN v_status='succeeded' THEN v_reference ELSE provider_reference END,
    result=CASE WHEN v_status='succeeded' THEN jsonb_build_object(
      'contract_version','phase5.ghl-action-result.v1','outcome','succeeded',
      'provider_reference',v_reference,'provider_payload',jsonb_build_object('reconciled',true)) ELSE result END,
    error_code=CASE WHEN v_status='failed' THEN 'reconciled_not_applied' ELSE NULL END,
    error_message=CASE WHEN v_status='failed' THEN trim(p_reason) ELSE NULL END,
    finished_at=statement_timestamp() WHERE id=v_job.id;
  IF v_status='succeeded' AND v_job.action_type='message' THEN
    UPDATE tanaghom.ghl_contact_channel_policies SET last_outbound_at=statement_timestamp()
     WHERE organization_id=v_job.organization_id AND contact_id=v_job.contact_id AND channel=v_job.channel;
  ELSIF v_status='succeeded' AND v_job.action_type='qualification' THEN
    UPDATE tanaghom.leads SET status='qualified',temperature=v_job.payload->>'temperature',
      last_touch_at=statement_timestamp() WHERE id=v_job.lead_id;
    UPDATE tanaghom.conversations SET qualification_state=jsonb_build_object(
      'temperature',v_job.payload->>'temperature','reason',v_job.payload->>'reason',
      'confidence',v_job.payload->'confidence','next_action',v_job.payload->>'next_action',
      'action_job_id',v_job.id,'reconciled',true),conversation_version=conversation_version+1
      WHERE id=v_job.conversation_id;
  ELSIF v_status='succeeded' AND v_job.action_type='won' THEN
    UPDATE tanaghom.leads SET status='won',last_touch_at=statement_timestamp() WHERE id=v_job.lead_id;
  ELSIF v_status='succeeded' AND v_job.action_type='lost' THEN
    UPDATE tanaghom.leads SET status='lost',last_touch_at=statement_timestamp() WHERE id=v_job.lead_id;
  ELSIF v_status='succeeded' AND v_job.action_type='nurture' THEN
    UPDATE tanaghom.leads SET status='nurture',last_touch_at=statement_timestamp() WHERE id=v_job.lead_id;
  END IF;
  INSERT INTO tanaghom.ghl_action_reconciliations
    (organization_id,action_job_id,resolution,resulting_status,provider_reference,reason,reconciled_by,command_id)
  VALUES (v_actor.organization_id,v_job.id,p_resolution,v_status,v_reference,trim(p_reason),v_actor.id,p_command_id);
  INSERT INTO tanaghom.ghl_action_outcomes
    (organization_id,action_job_id,outcome_type,provider_reference,details)
  VALUES (v_actor.organization_id,v_job.id,'reconciled',v_reference,
    jsonb_build_object('resolution',p_resolution,'resulting_status',v_status,
      'reason',trim(p_reason),'actor_user_id',v_actor.id));
  INSERT INTO tanaghom.agent_actions_log
    (correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
  VALUES (p_command_id,v_actor.id,'ghl.action_reconciled','ghl_action_job',v_job.id,
    jsonb_build_object('resolution',p_resolution,'resulting_status',v_status,
      'provider_reference',v_reference,'reason',trim(p_reason)),'success');
  RETURN v_status;
END;
$$;

REVOKE ALL ON tanaghom.ghl_action_reconciliations FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker;
REVOKE ALL ON FUNCTION tanaghom.reconcile_ghl_action(uuid,uuid,text,text,text,uuid) FROM PUBLIC;
GRANT SELECT ON tanaghom.ghl_action_reconciliations TO tanaghom_api,tanaghom_readonly;
GRANT EXECUTE ON FUNCTION tanaghom.reconcile_ghl_action(uuid,uuid,text,text,text,uuid) TO tanaghom_api;

INSERT INTO public.schema_migrations(version) VALUES ('0016_ghl_action_review_reconciliation');
COMMIT;
