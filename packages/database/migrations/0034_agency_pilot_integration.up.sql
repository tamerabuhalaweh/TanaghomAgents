BEGIN;

DO $$ BEGIN
 IF (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0033_agent_runtime_certification_evidence'
 THEN RAISE EXCEPTION '0034 requires exact 0033 baseline'; END IF;
END $$;

-- A bounded Agent Studio certification lane. No production agent promotion,
-- provider operation, human content approval, or existing queue is modified.
CREATE ROLE tanaghom_agency_pilot_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA tanaghom TO tanaghom_agency_pilot_worker;

CREATE TABLE tanaghom.agency_pilot_controls (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  emergency_stop boolean NOT NULL DEFAULT true,
  model_execution_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO tanaghom.agency_pilot_controls DEFAULT VALUES;

CREATE TABLE tanaghom.agency_pilot_profiles (
  code text PRIMARY KEY,
  binding_id text NOT NULL UNIQUE,
  procedure_hash text NOT NULL CHECK (procedure_hash ~ '^sha256:[a-f0-9]{64}$'),
  platform_skill_version_id uuid REFERENCES tanaghom.skill_versions(id),
  kind text NOT NULL CHECK (kind IN ('existing_proposal','local_proposal')),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object')
);
INSERT INTO tanaghom.agency_pilot_profiles(code,binding_id,procedure_hash,platform_skill_version_id,kind,manifest) VALUES
('social_media_strategist','agency.social_media_strategist.v1','sha256:14ed2a7ada906e13a88991ef1e12855c77d81782f4d53bf2c008335e234168f7','72000000-0000-4000-8000-000000000001'::uuid,'existing_proposal','{"id":"agency.social_media_strategist.v1","code":"social_media_strategist","procedure_hash":"sha256:14ed2a7ada906e13a88991ef1e12855c77d81782f4d53bf2c008335e234168f7","kind":"existing_proposal","role_code":"campaign_strategist","worker_code":"campaign_strategy_generator","skill_code":"create_campaign_strategy","platform_skill_version_id":"72000000-0000-4000-8000-000000000001","input_schema_ref":"packages/contracts/schemas/phase3/strategist-job.v1.schema.json","output_schema_ref":"packages/contracts/schemas/phase3/strategist-output.v1.schema.json","adapter_export":"prepareAgencyInvocation","operating_mode":"simulation","production_installed":false,"certified":false}'::jsonb),
('content_creator','agency.content_creator.v1','sha256:8bd87949c37131a2b412a3b083e1316778d518d3e0b61209c7c162006793a734','72000000-0000-4000-8000-000000000002'::uuid,'existing_proposal','{"id":"agency.content_creator.v1","code":"content_creator","procedure_hash":"sha256:8bd87949c37131a2b412a3b083e1316778d518d3e0b61209c7c162006793a734","kind":"existing_proposal","role_code":"content_producer","worker_code":"campaign_content_generator","skill_code":"generate_content_drafts","platform_skill_version_id":"72000000-0000-4000-8000-000000000002","input_schema_ref":"packages/contracts/schemas/phase3/content-producer-job.v1.schema.json","output_schema_ref":"packages/contracts/schemas/phase3/content-producer-output.v1.schema.json","adapter_export":"prepareAgencyInvocation","operating_mode":"simulation","production_installed":false,"certified":false}'::jsonb),
('brand_guardian','agency.brand_guardian.v1','sha256:341862ac5c3203e3f44545ddcebb69c82e117c9baa133f32d7d7f9d3467f2364',NULL,'local_proposal','{"id":"agency.brand_guardian.v1","code":"brand_guardian","procedure_hash":"sha256:341862ac5c3203e3f44545ddcebb69c82e117c9baa133f32d7d7f9d3467f2364","kind":"local_proposal","role_code":"content_producer","worker_code":null,"skill_code":null,"platform_skill_version_id":null,"input_schema_ref":"packages/contracts/schemas/phase7/agency-brand-input.v1.schema.json","output_schema_ref":"packages/contracts/schemas/phase7/agency-brand-review.v1.schema.json","adapter_export":"reviewBrandContent","operating_mode":"simulation","production_installed":false,"certified":false}'::jsonb),
('discovery_coach','agency.discovery_coach.v1','sha256:0bd361ff06a356c0841e26af1dc61a1f4c180da1bea224be74c900c348294343','72000000-0000-4000-8000-000000000006'::uuid,'existing_proposal','{"id":"agency.discovery_coach.v1","code":"discovery_coach","procedure_hash":"sha256:0bd361ff06a356c0841e26af1dc61a1f4c180da1bea224be74c900c348294343","kind":"existing_proposal","role_code":"sales_crm","worker_code":"conversation_intelligence_worker","skill_code":"propose_conversation_reply","platform_skill_version_id":"72000000-0000-4000-8000-000000000006","input_schema_ref":"packages/contracts/schemas/phase5/conversation-intelligence-request.v1.schema.json","output_schema_ref":"packages/contracts/schemas/phase5/conversation-intelligence-output.v1.schema.json","adapter_export":"prepareAgencyInvocation","operating_mode":"simulation","production_installed":false,"certified":false}'::jsonb),
('support_responder','agency.support_responder.v1','sha256:104550ca53c6caf337ae8daa9633db796a34fcf143225b68ccb27fa6d19f196f','72000000-0000-4000-8000-000000000006'::uuid,'existing_proposal','{"id":"agency.support_responder.v1","code":"support_responder","procedure_hash":"sha256:104550ca53c6caf337ae8daa9633db796a34fcf143225b68ccb27fa6d19f196f","kind":"existing_proposal","role_code":"sales_crm","worker_code":"conversation_intelligence_worker","skill_code":"propose_conversation_reply","platform_skill_version_id":"72000000-0000-4000-8000-000000000006","input_schema_ref":"packages/contracts/schemas/phase5/conversation-intelligence-request.v1.schema.json","output_schema_ref":"packages/contracts/schemas/phase5/conversation-intelligence-output.v1.schema.json","adapter_export":"prepareAgencyInvocation","operating_mode":"simulation","production_installed":false,"certified":false}'::jsonb),
('executive_summary','agency.executive_summary.v1','sha256:b9f715ce74fcf5bfb79e5d8e7c99c98c138288afd6b73bf72c7f7fb0e76ce084',NULL,'local_proposal','{"id":"agency.executive_summary.v1","code":"executive_summary","procedure_hash":"sha256:b9f715ce74fcf5bfb79e5d8e7c99c98c138288afd6b73bf72c7f7fb0e76ce084","kind":"local_proposal","role_code":"publisher_monitor","worker_code":null,"skill_code":null,"platform_skill_version_id":null,"input_schema_ref":"packages/contracts/schemas/phase7/agency-report-input.v1.schema.json","output_schema_ref":"packages/contracts/schemas/phase7/agency-executive-report.v1.schema.json","adapter_export":"buildExecutiveReport","operating_mode":"simulation","production_installed":false,"certified":false}'::jsonb);

CREATE TABLE tanaghom.agency_pilot_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  agent_version_id uuid NOT NULL,
  profile_code text NOT NULL REFERENCES tanaghom.agency_pilot_profiles(code),
  created_by uuid NOT NULL REFERENCES tanaghom.app_users(id),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,agent_version_id) REFERENCES tanaghom.organization_agent_versions(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (organization_id,id), UNIQUE (agent_version_id,profile_code)
);
CREATE TABLE tanaghom.agency_pilot_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('brand_rule','asset_rights','metric')),
  record jsonb NOT NULL CHECK (jsonb_typeof(record)='object' AND octet_length(record::text)<=20000),
  approved_by uuid NOT NULL REFERENCES tanaghom.app_users(id),
  approved_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL CHECK (expires_at>approved_at),
  UNIQUE (organization_id,id)
);
CREATE TABLE tanaghom.agency_pilot_evidence_revocations (
  evidence_id uuid PRIMARY KEY REFERENCES tanaghom.agency_pilot_evidence(id) ON DELETE RESTRICT,
  revoked_by uuid NOT NULL REFERENCES tanaghom.app_users(id),
  revoked_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE tanaghom.agency_pilot_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES tanaghom.app_users(id),
  model_profile_id uuid NOT NULL REFERENCES tanaghom.agent_runtime_profiles(id),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  language text NOT NULL CHECK (language IN ('en','ar')),
  target_id uuid,
  options jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(options)='object'),
  evidence_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(evidence_ids)<=30),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','in_progress','succeeded','failed')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  lease_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  basis_hash text,
  prepared jsonb,
  result jsonb,
  response_hash text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  finished_at timestamptz,
  FOREIGN KEY (organization_id,binding_id) REFERENCES tanaghom.agency_pilot_bindings(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (organization_id,idempotency_key), UNIQUE (organization_id,id)
);
CREATE TABLE tanaghom.agency_pilot_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
  task_id uuid REFERENCES tanaghom.agency_pilot_tasks(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('bound','evidence_approved','evidence_revoked','queued','claimed','prepared','succeeded','failed')),
  reference_id uuid NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TRIGGER agency_profiles_immutable BEFORE UPDATE OR DELETE ON tanaghom.agency_pilot_profiles
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();
CREATE TRIGGER agency_bindings_immutable BEFORE UPDATE OR DELETE ON tanaghom.agency_pilot_bindings
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();
CREATE TRIGGER agency_evidence_immutable BEFORE UPDATE OR DELETE ON tanaghom.agency_pilot_evidence
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();
CREATE TRIGGER agency_revocations_immutable BEFORE UPDATE OR DELETE ON tanaghom.agency_pilot_evidence_revocations
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();
CREATE TRIGGER agency_events_immutable BEFORE UPDATE OR DELETE ON tanaghom.agency_pilot_events
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();

CREATE FUNCTION tanaghom.guard_agency_pilot_task() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status IN ('succeeded','failed')
 OR (to_jsonb(OLD)-ARRAY['status','attempt','lease_token','claimed_at','lease_expires_at','basis_hash','prepared','result','response_hash','error_code','finished_at'])
  IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','attempt','lease_token','claimed_at','lease_expires_at','basis_hash','prepared','result','response_hash','error_code','finished_at'])
 THEN RAISE EXCEPTION 'pilot identity and terminal evidence are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agency_task_integrity BEFORE UPDATE OR DELETE ON tanaghom.agency_pilot_tasks
FOR EACH ROW EXECUTE FUNCTION tanaghom.guard_agency_pilot_task();

CREATE FUNCTION tanaghom.bind_agency_pilot(p_actor uuid,p_version uuid,p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_org uuid; v_id uuid; v_skill uuid;
BEGIN
 SELECT organization_id INTO v_org FROM tanaghom.organization_agent_versions WHERE id=p_version AND lifecycle_state IN ('validated','simulation');
 PERFORM tanaghom.assert_organization_agent_owner(v_org,p_actor);
 SELECT platform_skill_version_id INTO v_skill FROM tanaghom.agency_pilot_profiles WHERE code=p_code;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown pilot profile'; END IF;
 IF v_skill IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM tanaghom.organization_agent_skill_bindings WHERE agent_version_id=p_version
    AND organization_id=v_org AND platform_skill_version_id=v_skill AND operating_mode<>'disabled'
 ) THEN RAISE EXCEPTION 'exact assigned platform skill required'; END IF;
 INSERT INTO tanaghom.agency_pilot_bindings(organization_id,agent_version_id,profile_code,created_by)
 VALUES(v_org,p_version,p_code,p_actor) ON CONFLICT(agent_version_id,profile_code) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN SELECT id INTO v_id FROM tanaghom.agency_pilot_bindings WHERE agent_version_id=p_version AND profile_code=p_code;
 ELSE INSERT INTO tanaghom.agency_pilot_events(organization_id,event_type,reference_id,evidence)
 VALUES(v_org,'bound',v_id,jsonb_build_object('actor_id',p_actor,'agent_version_id',p_version,'profile_code',p_code)); END IF;
 RETURN v_id;
END $$;

CREATE FUNCTION tanaghom.approve_agency_pilot_evidence(p_actor uuid,p_kind text,p_record jsonb,p_expiry timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
 SELECT organization_id INTO v_org FROM tanaghom.app_users WHERE id=p_actor;
 PERFORM tanaghom.assert_organization_agent_owner(v_org,p_actor);
 IF NOT tanaghom.agent_runtime_json_is_safe(p_record,20000) OR p_expiry>statement_timestamp()+interval '90 days' THEN
   RAISE EXCEPTION 'bounded evidence and expiry required'; END IF;
 INSERT INTO tanaghom.agency_pilot_evidence(organization_id,kind,record,approved_by,expires_at)
 VALUES(v_org,p_kind,p_record,p_actor,p_expiry) RETURNING id INTO v_id;
 INSERT INTO tanaghom.agency_pilot_events(organization_id,event_type,reference_id,evidence)
 VALUES(v_org,'evidence_approved',v_id,jsonb_build_object('actor_id',p_actor,'record_hash',tanaghom.agent_runtime_sha256(p_record)));
 RETURN v_id;
END $$;

CREATE FUNCTION tanaghom.revoke_agency_pilot_evidence(p_actor uuid,p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_org uuid;
BEGIN
 SELECT organization_id INTO v_org FROM tanaghom.agency_pilot_evidence WHERE id=p_id;
 PERFORM tanaghom.assert_organization_agent_owner(v_org,p_actor);
 INSERT INTO tanaghom.agency_pilot_evidence_revocations(evidence_id,revoked_by) VALUES(p_id,p_actor) ON CONFLICT DO NOTHING;
 IF FOUND THEN INSERT INTO tanaghom.agency_pilot_events(organization_id,event_type,reference_id,evidence)
 VALUES(v_org,'evidence_revoked',p_id,jsonb_build_object('actor_id',p_actor)); END IF;
END $$;

CREATE FUNCTION tanaghom.queue_agency_pilot(p_actor uuid,p_binding uuid,p_model uuid,p_language text,p_target uuid,p_options jsonb,p_evidence uuid[],p_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b tanaghom.agency_pilot_bindings%ROWTYPE; v_hash text; v_id uuid; v_existing text;
BEGIN
 SELECT * INTO b FROM tanaghom.agency_pilot_bindings WHERE id=p_binding;
 PERFORM tanaghom.assert_organization_agent_owner(b.organization_id,p_actor);
 IF NOT EXISTS(SELECT 1 FROM tanaghom.agency_pilot_controls WHERE NOT emergency_stop)
 OR NOT EXISTS(SELECT 1 FROM tanaghom.agent_runtime_controls WHERE NOT emergency_stop) THEN RAISE EXCEPTION 'pilot emergency stop'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.organization_agent_versions WHERE id=b.agent_version_id
  AND lifecycle_state IN ('validated','simulation') AND p_language=ANY(languages)) THEN RAISE EXCEPTION 'simulation agent version required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.agent_runtime_profiles WHERE id=p_model AND lifecycle_state='validated') THEN RAISE EXCEPTION 'reviewed model profile required'; END IF;
 IF p_options IS NULL OR jsonb_typeof(p_options)<>'object' OR p_evidence IS NULL
 OR cardinality(p_evidence)>30 OR cardinality(p_evidence)<>(SELECT count(DISTINCT x) FROM unnest(p_evidence) x) THEN RAISE EXCEPTION 'bounded unique evidence required'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_evidence) x WHERE NOT EXISTS(SELECT 1 FROM tanaghom.agency_pilot_evidence e
  WHERE e.id=x AND e.organization_id=b.organization_id AND e.expires_at>statement_timestamp()
  AND NOT EXISTS(SELECT 1 FROM tanaghom.agency_pilot_evidence_revocations r WHERE r.evidence_id=e.id))) THEN RAISE EXCEPTION 'unavailable tenant evidence'; END IF;
 IF b.profile_code IN ('social_media_strategist','content_creator') THEN
   IF p_options<>'{}' OR NOT EXISTS(SELECT 1 FROM tanaghom.campaigns WHERE id=p_target AND organization_id=b.organization_id
    AND status NOT IN ('paused','closed') AND budget_target=0) THEN RAISE EXCEPTION 'tenant zero-budget campaign required'; END IF;
 ELSIF b.profile_code='brand_guardian' THEN
   IF p_options<>'{}' OR NOT EXISTS(SELECT 1 FROM tanaghom.content_items c JOIN tanaghom.campaigns a ON a.id=c.campaign_id
     WHERE c.id=p_target AND a.organization_id=b.organization_id) THEN RAISE EXCEPTION 'tenant content required'; END IF;
 ELSIF b.profile_code IN ('discovery_coach','support_responder') THEN
   IF p_options<>'{}' OR NOT EXISTS(SELECT 1 FROM tanaghom.ghl_inbound_events WHERE id=p_target AND organization_id=b.organization_id
     AND provider_event_type='InboundMessage' AND direction='inbound') THEN RAISE EXCEPTION 'tenant inbound event required'; END IF;
 ELSE
   IF p_target IS NOT NULL OR NOT (p_options ?& ARRAY['window_start','window_end','metric_codes'])
     OR p_options-ARRAY['window_start','window_end','metric_codes']<>'{}'
     OR (p_options->>'window_start')::timestamptz >= (p_options->>'window_end')::timestamptz
     OR (p_options->>'window_end')::timestamptz>statement_timestamp()
     OR (p_options->>'window_end')::timestamptz-(p_options->>'window_start')::timestamptz>interval '90 days'
     THEN RAISE EXCEPTION 'bounded report window required'; END IF;
 END IF;
 v_hash:=tanaghom.agent_runtime_sha256(jsonb_build_array(p_binding,p_model,p_language,p_target,p_options,p_evidence));
 -- Serialize tenant queue admission so concurrent distinct keys cannot exceed capacity.
 PERFORM pg_advisory_xact_lock(hashtextextended('agency-queue:'||b.organization_id::text,0));
 SELECT id,request_hash INTO v_id,v_existing FROM tanaghom.agency_pilot_tasks WHERE organization_id=b.organization_id AND idempotency_key=p_key;
 IF FOUND THEN IF v_existing<>v_hash THEN RAISE EXCEPTION 'idempotency conflict'; END IF; RETURN v_id; END IF;
 IF (SELECT count(*) FROM tanaghom.agency_pilot_tasks WHERE organization_id=b.organization_id AND status IN ('queued','in_progress'))>=20 THEN RAISE EXCEPTION 'pilot queue capacity reached'; END IF;
 INSERT INTO tanaghom.agency_pilot_tasks(organization_id,binding_id,requested_by,model_profile_id,language,target_id,options,evidence_ids,idempotency_key,request_hash)
 VALUES(b.organization_id,p_binding,p_actor,p_model,p_language,p_target,p_options,p_evidence,p_key,v_hash) RETURNING id INTO v_id;
 INSERT INTO tanaghom.agency_pilot_events(organization_id,task_id,event_type,reference_id,evidence)
 VALUES(b.organization_id,v_id,'queued',v_id,jsonb_build_object('actor_id',p_actor,'request_hash',v_hash));
 RETURN v_id;
END $$;

CREATE FUNCTION tanaghom.claim_agency_pilot()
RETURNS TABLE(task_id uuid,lease_token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE t tanaghom.agency_pilot_tasks%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tanaghom.agency_pilot_controls WHERE NOT emergency_stop)
 OR NOT EXISTS(SELECT 1 FROM tanaghom.agent_runtime_controls WHERE NOT emergency_stop) THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('agency-pilot-claim',0));
 -- Bounded recovery: exhausted leases become durable failures, never silent losses.
 FOR t IN SELECT task.* FROM tanaghom.agency_pilot_tasks task
   JOIN tanaghom.agency_pilot_bindings b ON b.id=task.binding_id
   JOIN tanaghom.organization_agent_policies p ON p.agent_version_id=b.agent_version_id
   WHERE task.status='in_progress' AND task.lease_expires_at<=statement_timestamp()
     AND task.attempt>=least(3,p.max_retries+1) FOR UPDATE OF task LOOP
   UPDATE tanaghom.agency_pilot_tasks SET status='failed',finished_at=statement_timestamp(),error_code='pilot_validation_failed',
     response_hash=tanaghom.agent_runtime_sha256(jsonb_build_object('error','lease_exhausted')) WHERE id=t.id;
   INSERT INTO tanaghom.agency_pilot_events(organization_id,task_id,event_type,reference_id,evidence)
    VALUES(t.organization_id,t.id,'failed',t.id,'{"reason":"lease_exhausted","external_action_count":0}');
 END LOOP;
 IF (SELECT count(*) FROM tanaghom.agency_pilot_tasks WHERE status='in_progress' AND lease_expires_at>statement_timestamp())
   >=(SELECT max_global_concurrency FROM tanaghom.agent_runtime_controls) THEN RETURN; END IF;
 SELECT task.* INTO t FROM tanaghom.agency_pilot_tasks task
 JOIN tanaghom.agency_pilot_bindings b ON b.id=task.binding_id
 JOIN tanaghom.organization_agent_versions a ON a.id=b.agent_version_id
 JOIN tanaghom.organization_agent_policies p ON p.agent_version_id=a.id
 WHERE (task.status='queued' OR (task.status='in_progress' AND task.lease_expires_at<statement_timestamp()))
  AND task.attempt<least(3,p.max_retries+1) AND a.lifecycle_state IN ('validated','simulation')
  AND (SELECT count(*) FROM tanaghom.agency_pilot_tasks running JOIN tanaghom.agency_pilot_bindings rb ON rb.id=running.binding_id
    WHERE rb.agent_version_id=a.id AND running.status='in_progress' AND running.lease_expires_at>statement_timestamp())<p.max_concurrency
  AND (b.profile_code='executive_summary' OR EXISTS(SELECT 1 FROM tanaghom.agency_pilot_controls WHERE model_execution_enabled))
 ORDER BY task.created_at,task.id FOR UPDATE OF task SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE tanaghom.agency_pilot_tasks SET status='in_progress',attempt=attempt+1,lease_token=gen_random_uuid(),
 claimed_at=statement_timestamp(),lease_expires_at=statement_timestamp()+make_interval(secs=>least(300,
   (SELECT p.max_runtime_seconds FROM tanaghom.organization_agent_policies p JOIN tanaghom.agency_pilot_bindings b ON b.agent_version_id=p.agent_version_id WHERE b.id=t.binding_id))),basis_hash=NULL,prepared=NULL
 WHERE id=t.id RETURNING * INTO t;
 INSERT INTO tanaghom.agency_pilot_events(organization_id,task_id,event_type,reference_id,evidence)
 VALUES(t.organization_id,t.id,'claimed',t.id,jsonb_build_object('attempt',t.attempt));
 RETURN QUERY SELECT t.id,t.lease_token;
END $$;

-- One bounded, server-resolved bundle. Used in a SERIALIZABLE gateway transaction
-- both before inference and immediately before completion. No caller snapshots.
CREATE FUNCTION tanaghom.resolve_agency_pilot(p_task uuid,p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE t tanaghom.agency_pilot_tasks%ROWTYPE; b tanaghom.agency_pilot_bindings%ROWTYPE;
 a tanaghom.organization_agent_versions%ROWTYPE; v_data jsonb; v_records jsonb:='{}'; v_event tanaghom.ghl_inbound_events%ROWTYPE;
 v_conversation jsonb; v_policy jsonb; v_knowledge jsonb; v_evidence jsonb; v_campaign jsonb; v_strategy jsonb;
BEGIN
 SELECT * INTO t FROM tanaghom.agency_pilot_tasks WHERE id=p_task AND lease_token=p_lease AND status='in_progress'
   AND lease_expires_at>statement_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'valid pilot lease required'; END IF;
 SELECT * INTO b FROM tanaghom.agency_pilot_bindings WHERE id=t.binding_id;
 SELECT * INTO a FROM tanaghom.organization_agent_versions WHERE id=b.agent_version_id AND organization_id=t.organization_id;
 PERFORM tanaghom.assert_organization_agent_owner(t.organization_id,t.requested_by);
 IF a.lifecycle_state NOT IN ('validated','simulation') THEN RAISE EXCEPTION 'pilot agent paused or unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.agency_pilot_controls WHERE NOT emergency_stop
  AND (b.profile_code='executive_summary' OR model_execution_enabled))
 OR NOT EXISTS(SELECT 1 FROM tanaghom.agent_runtime_controls WHERE NOT emergency_stop) THEN RAISE EXCEPTION 'pilot stopped'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.agent_runtime_profiles WHERE id=t.model_profile_id AND lifecycle_state='validated') THEN RAISE EXCEPTION 'model profile retired'; END IF;
 IF EXISTS(SELECT 1 FROM tanaghom.agency_pilot_profiles p WHERE p.code=b.profile_code AND p.platform_skill_version_id IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM tanaghom.organization_agent_skill_bindings s JOIN tanaghom.skill_versions v ON v.id=s.platform_skill_version_id
    WHERE s.agent_version_id=a.id AND s.organization_id=t.organization_id AND s.platform_skill_version_id=p.platform_skill_version_id
     AND s.operating_mode<>'disabled' AND v.lifecycle_state='published')) THEN RAISE EXCEPTION 'published assigned skill required'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') INTO v_evidence FROM tanaghom.agency_pilot_evidence e
 WHERE e.id=ANY(t.evidence_ids) AND e.organization_id=t.organization_id AND e.expires_at>statement_timestamp()
 AND NOT EXISTS(SELECT 1 FROM tanaghom.agency_pilot_evidence_revocations r WHERE r.evidence_id=e.id);
 IF jsonb_array_length(v_evidence)<>cardinality(t.evidence_ids) THEN RAISE EXCEPTION 'pilot evidence revoked or expired'; END IF;
 IF b.profile_code IN ('social_media_strategist','content_creator') THEN
   SELECT to_jsonb(c) INTO v_campaign FROM tanaghom.campaigns c WHERE id=t.target_id AND organization_id=t.organization_id
     AND status NOT IN ('paused','closed') AND budget_target=0;
   IF v_campaign IS NULL THEN RAISE EXCEPTION 'pilot campaign unavailable'; END IF;
   SELECT to_jsonb(s) INTO v_strategy FROM tanaghom.campaign_strategies s WHERE campaign_id=t.target_id ORDER BY version DESC LIMIT 1;
   v_records:=jsonb_build_object('campaign',v_campaign,'strategy',v_strategy);
 ELSIF b.profile_code='brand_guardian' THEN
   SELECT to_jsonb(c) INTO v_records FROM tanaghom.content_items c JOIN tanaghom.campaigns p ON p.id=c.campaign_id
     WHERE c.id=t.target_id AND p.organization_id=t.organization_id;
   IF v_records IS NULL THEN RAISE EXCEPTION 'pilot content unavailable'; END IF;
   v_records:=jsonb_build_object('content',v_records);
 ELSIF b.profile_code IN ('discovery_coach','support_responder') THEN
   SELECT * INTO v_event FROM tanaghom.ghl_inbound_events WHERE id=t.target_id AND organization_id=t.organization_id
      AND provider_event_type='InboundMessage' AND direction='inbound';
   SELECT to_jsonb(c) INTO v_conversation FROM tanaghom.conversations c
    WHERE c.organization_id=t.organization_id AND c.provider_conversation_id=v_event.conversation_id
      AND NOT c.emergency_paused AND c.state NOT IN ('human_owned','human_required','paused','resolved','failed');
   IF v_event.id IS NULL OR v_conversation IS NULL THEN RAISE EXCEPTION 'pilot conversation unavailable or human takeover'; END IF;
   IF NOT EXISTS(SELECT 1 FROM tanaghom.ghl_contact_channel_policies WHERE organization_id=t.organization_id
      AND contact_id=v_event.contact_id AND channel=v_event.channel AND consent_status='opted_in') THEN RAISE EXCEPTION 'explicit consent required or DND'; END IF;
   IF NOT EXISTS(SELECT 1 FROM tanaghom.organization_crm_policies WHERE organization_id=t.organization_id
      AND conversation_emergency_stop=false) THEN RAISE EXCEPTION 'conversation emergency stop'; END IF;
   SELECT to_jsonb(p) INTO v_policy FROM tanaghom.organization_conversation_policy_versions p
     WHERE organization_id=t.organization_id AND status='active';
   SELECT coalesce(jsonb_agg(item ORDER BY item->>'source_id'),'[]') INTO v_knowledge FROM (
     SELECT jsonb_build_object('source_id',s.id,'source_version_id',v.id,'source_key',s.source_key,'title',s.title,
       'category',s.category,'version',v.version_number,'language',v.language,'content',v.content,'structured_facts',v.structured_facts,
       'content_fingerprint',v.content_fingerprint,'provenance_type',s.provenance_type,'provenance_ref',s.provenance_ref) AS item
     FROM tanaghom.sales_knowledge_sources s JOIN tanaghom.sales_knowledge_versions v ON v.source_id=s.id AND v.organization_id=s.organization_id
     WHERE s.organization_id=t.organization_id AND format('knowledge/%s/v%s',s.source_key,v.version_number)=ANY(a.knowledge_keys)
       AND v.status='active' AND v.approved_at IS NOT NULL AND v.language IN (t.language,'und') ORDER BY s.id LIMIT 8
   ) knowledge;
   IF v_policy IS NULL THEN RAISE EXCEPTION 'conversation policy required'; END IF;
   v_records:=jsonb_build_object('event',to_jsonb(v_event),'conversation',v_conversation,'conversation_policy',v_policy,'knowledge',v_knowledge);
 END IF;
 v_data:=jsonb_build_object('binding',to_jsonb(b),'agent',to_jsonb(a),'records',v_records,'evidence',v_evidence,
   'profile',(SELECT manifest FROM tanaghom.agency_pilot_profiles WHERE code=b.profile_code),
   'policy',(SELECT to_jsonb(p) FROM tanaghom.organization_agent_policies p WHERE agent_version_id=a.id AND organization_id=t.organization_id),
   'model',(SELECT to_jsonb(m) FROM tanaghom.agent_runtime_profiles m WHERE id=t.model_profile_id),
   'assigned_skills',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM tanaghom.organization_agent_skill_bindings s WHERE agent_version_id=a.id AND organization_id=t.organization_id));
 RETURN jsonb_build_object('task',to_jsonb(t),'data',v_data,'basis_hash',tanaghom.agent_runtime_sha256(v_data),'clock',statement_timestamp());
END $$;

CREATE FUNCTION tanaghom.seal_agency_pilot(p_task uuid,p_lease uuid,p_basis text,p_prepared jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE t tanaghom.agency_pilot_tasks%ROWTYPE; v_basis text;
BEGIN
 v_basis:=tanaghom.resolve_agency_pilot(p_task,p_lease)->>'basis_hash';
 IF p_basis IS DISTINCT FROM v_basis OR jsonb_typeof(p_prepared) IS DISTINCT FROM 'object'
   OR octet_length(p_prepared::text)>350000 THEN RAISE EXCEPTION 'pilot preparation mismatch'; END IF;
 UPDATE tanaghom.agency_pilot_tasks SET basis_hash=p_basis,prepared=p_prepared WHERE id=p_task AND prepared IS NULL RETURNING * INTO t;
 IF NOT FOUND THEN RAISE EXCEPTION 'pilot already prepared'; END IF;
 INSERT INTO tanaghom.agency_pilot_events(organization_id,task_id,event_type,reference_id,evidence)
 VALUES(t.organization_id,t.id,'prepared',t.id,jsonb_build_object('basis_hash',p_basis,'binding_id',t.binding_id));
END $$;

CREATE FUNCTION tanaghom.finish_agency_pilot(p_task uuid,p_lease uuid,p_response_hash text,p_result jsonb,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE t tanaghom.agency_pilot_tasks%ROWTYPE; v_basis text;
BEGIN
 SELECT * INTO t FROM tanaghom.agency_pilot_tasks WHERE id=p_task AND lease_token=p_lease FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'pilot lease mismatch'; END IF;
 IF t.status IN ('succeeded','failed') THEN
   IF t.response_hash IS DISTINCT FROM p_response_hash THEN RAISE EXCEPTION 'pilot completion conflict'; END IF;
   RETURN jsonb_build_object('task_id',t.id,'status',t.status); END IF;
 IF t.status<>'in_progress' OR t.lease_expires_at<=statement_timestamp() OR p_response_hash IS NULL OR p_response_hash !~ '^sha256:[a-f0-9]{64}$'
   THEN RAISE EXCEPTION 'valid completion lease required'; END IF;
 IF p_error IS NULL THEN
   v_basis:=tanaghom.resolve_agency_pilot(p_task,p_lease)->>'basis_hash';
   IF t.prepared IS NULL OR t.basis_hash IS DISTINCT FROM v_basis OR p_result->>'external_action_count' IS DISTINCT FROM '0'
     OR p_result->>'human_approval_granted' IS DISTINCT FROM 'false' OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'
     OR octet_length(p_result::text)>200000 THEN RAISE EXCEPTION 'pilot completion invalid or stale'; END IF;
 ELSIF p_error NOT IN ('pilot_validation_failed','pilot_model_failed') OR p_result IS NOT NULL THEN RAISE EXCEPTION 'bounded error without a result required'; END IF;
 UPDATE tanaghom.agency_pilot_tasks SET status=CASE WHEN p_error IS NULL THEN 'succeeded' ELSE 'failed' END,
  result=p_result,response_hash=p_response_hash,error_code=p_error,finished_at=statement_timestamp() WHERE id=p_task RETURNING * INTO t;
 INSERT INTO tanaghom.agency_pilot_events(organization_id,task_id,event_type,reference_id,evidence)
 VALUES(t.organization_id,t.id,t.status,t.id,jsonb_build_object('response_hash',p_response_hash,'basis_hash',t.basis_hash,
   'result_hash',tanaghom.agent_runtime_sha256(coalesce(p_result,'{}')),'error_code',p_error,'external_action_count',0));
 RETURN jsonb_build_object('task_id',t.id,'status',t.status);
END $$;

CREATE FUNCTION tanaghom.read_agency_pilot_completion(p_task uuid,p_lease uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('task_id',id,'status',status,'response_hash',response_hash) FROM tanaghom.agency_pilot_tasks
 WHERE id=p_task AND lease_token=p_lease AND status IN ('succeeded','failed');
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA tanaghom FROM tanaghom_agency_pilot_worker;
REVOKE ALL ON FUNCTION tanaghom.guard_agency_pilot_task() FROM PUBLIC;
REVOKE ALL ON tanaghom.agency_pilot_controls,tanaghom.agency_pilot_profiles,tanaghom.agency_pilot_bindings,
 tanaghom.agency_pilot_evidence,tanaghom.agency_pilot_evidence_revocations,tanaghom.agency_pilot_tasks,tanaghom.agency_pilot_events FROM PUBLIC,tanaghom_api;
GRANT SELECT ON tanaghom.agency_pilot_profiles,tanaghom.agency_pilot_bindings,tanaghom.agency_pilot_evidence,
 tanaghom.agency_pilot_evidence_revocations,tanaghom.agency_pilot_tasks,tanaghom.agency_pilot_events TO tanaghom_api;
REVOKE ALL ON FUNCTION tanaghom.bind_agency_pilot(uuid,uuid,text),tanaghom.approve_agency_pilot_evidence(uuid,text,jsonb,timestamptz),
 tanaghom.revoke_agency_pilot_evidence(uuid,uuid),tanaghom.queue_agency_pilot(uuid,uuid,uuid,text,uuid,jsonb,uuid[],text),
 tanaghom.claim_agency_pilot(),tanaghom.resolve_agency_pilot(uuid,uuid),tanaghom.seal_agency_pilot(uuid,uuid,text,jsonb),
 tanaghom.finish_agency_pilot(uuid,uuid,text,jsonb,text),tanaghom.read_agency_pilot_completion(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.bind_agency_pilot(uuid,uuid,text),tanaghom.approve_agency_pilot_evidence(uuid,text,jsonb,timestamptz),
 tanaghom.revoke_agency_pilot_evidence(uuid,uuid),tanaghom.queue_agency_pilot(uuid,uuid,uuid,text,uuid,jsonb,uuid[],text) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.claim_agency_pilot(),tanaghom.resolve_agency_pilot(uuid,uuid),tanaghom.seal_agency_pilot(uuid,uuid,text,jsonb),
 tanaghom.finish_agency_pilot(uuid,uuid,text,jsonb,text),tanaghom.read_agency_pilot_completion(uuid,uuid) TO tanaghom_agency_pilot_worker;
INSERT INTO public.schema_migrations(version) VALUES('0034_agency_pilot_integration');
COMMIT;
