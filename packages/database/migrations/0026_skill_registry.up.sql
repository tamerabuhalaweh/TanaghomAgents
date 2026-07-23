BEGIN;

CREATE FUNCTION tanaghom.skill_permission_manifest_is_safe(p_manifest jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_key text;
  v_value jsonb;
  v_item text;
BEGIN
  IF jsonb_typeof(p_manifest) <> 'object'
    OR NOT (p_manifest ?& ARRAY['data_domains','integrations','channels','operations'])
    OR (p_manifest - ARRAY['data_domains','integrations','channels','operations']) <> '{}'::jsonb
  THEN
    RETURN false;
  END IF;

  FOREACH v_key IN ARRAY ARRAY['data_domains','integrations','channels','operations']
  LOOP
    v_value := p_manifest -> v_key;
    IF jsonb_typeof(v_value) <> 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_value) item WHERE jsonb_typeof(item) <> 'string')
    THEN
      RETURN false;
    END IF;
    FOR v_item IN SELECT jsonb_array_elements_text(v_value)
    LOOP
      IF length(v_item) NOT BETWEEN 1 AND 120
        OR v_item !~ '^[a-z][a-z0-9._-]*$'
        OR v_item ~ '(^|[._-])(all|any)([._-]|$)'
        OR position('*' IN v_item) > 0
      THEN
        RETURN false;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_array_length(p_manifest -> 'data_domains') > 0
     AND jsonb_array_length(p_manifest -> 'operations') > 0;
END;
$$;

CREATE FUNCTION tanaghom.skill_schema_ref_is_safe(p_ref text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_ref ~ '^packages/contracts/schemas/phase[0-9a-z]+/[a-z0-9-]+\.v[1-9][0-9]*\.schema\.json$'
     AND position('..' IN p_ref) = 0;
$$;

CREATE TABLE tanaghom.skill_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  owner_scope text NOT NULL CHECK (owner_scope IN ('platform','organization')),
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 3 AND 120),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 20 AND 1000),
  skill_class text NOT NULL CHECK (skill_class IN ('knowledge','read','proposal','action')),
  contract_version text NOT NULL DEFAULT 'tanaghom.skill-registry.v1'
    CHECK (contract_version='tanaghom.skill-registry.v1'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (
    (owner_scope='platform' AND organization_id IS NULL)
    OR (owner_scope='organization' AND organization_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX skill_definitions_platform_code_uidx
  ON tanaghom.skill_definitions(code) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX skill_definitions_organization_code_uidx
  ON tanaghom.skill_definitions(organization_id,code) WHERE organization_id IS NOT NULL;

CREATE TABLE tanaghom.skill_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES tanaghom.skill_definitions(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  lifecycle_state text NOT NULL
    CHECK (lifecycle_state IN ('draft','validated','published','deprecated','retired')),
  instructions text NOT NULL CHECK (length(trim(instructions)) BETWEEN 20 AND 5000),
  input_schema_ref text NOT NULL CHECK (tanaghom.skill_schema_ref_is_safe(input_schema_ref)),
  output_schema_ref text NOT NULL CHECK (tanaghom.skill_schema_ref_is_safe(output_schema_ref)),
  risk_class text NOT NULL CHECK (risk_class IN ('low','medium','high','critical')),
  side_effect_class text NOT NULL
    CHECK (side_effect_class IN ('none','read_only','proposal_only','internal_write','external_write')),
  permission_manifest jsonb NOT NULL
    CHECK (tanaghom.skill_permission_manifest_is_safe(permission_manifest)),
  integration_requirements text[] NOT NULL DEFAULT '{}',
  executor_type text NOT NULL
    CHECK (executor_type IN ('controlled_database_function','private_gateway_operation','pinned_n8n_workflow')),
  executor_ref text NOT NULL CHECK (length(trim(executor_ref)) BETWEEN 3 AND 300),
  executor_version text NOT NULL CHECK (executor_version ~ '^v[1-9][0-9]*$'),
  package_path text NOT NULL
    CHECK (package_path ~ '^skills/platform/[a-z0-9-]+/SKILL\.md$' AND position('..' IN package_path)=0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  tool_schema_hash text NOT NULL CHECK (tool_schema_hash ~ '^[a-f0-9]{64}$'),
  audit_provenance jsonb NOT NULL CHECK (jsonb_typeof(audit_provenance)='object'),
  published_at timestamptz,
  deprecated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (skill_id,version_number),
  UNIQUE (skill_id,id),
  CHECK (
    (lifecycle_state IN ('published','deprecated','retired') AND published_at IS NOT NULL)
    OR (lifecycle_state IN ('draft','validated') AND published_at IS NULL)
  ),
  CHECK (deprecated_at IS NULL OR lifecycle_state IN ('deprecated','retired')),
  CHECK (
    cardinality(integration_requirements)=0
    OR integration_requirements <@ ARRAY['gemma_private_api','ghl_private_gateway','postiz_private_gateway']::text[]
  )
);

CREATE TABLE tanaghom.agent_skill_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  role_code text NOT NULL REFERENCES tanaghom.agent_role_registry(code) ON DELETE RESTRICT,
  worker_code text NOT NULL REFERENCES tanaghom.agent_workflow_registry(code) ON DELETE RESTRICT,
  skill_version_id uuid NOT NULL REFERENCES tanaghom.skill_versions(id) ON DELETE RESTRICT,
  binding_state text NOT NULL DEFAULT 'active' CHECK (binding_state IN ('active','retired')),
  audit_provenance jsonb NOT NULL CHECK (jsonb_typeof(audit_provenance)='object'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id,worker_code,skill_version_id)
);
CREATE UNIQUE INDEX agent_skill_bindings_platform_uidx
  ON tanaghom.agent_skill_bindings(worker_code,skill_version_id)
  WHERE organization_id IS NULL;

CREATE TABLE tanaghom.skill_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  skill_version_id uuid NOT NULL REFERENCES tanaghom.skill_versions(id) ON DELETE RESTRICT,
  reference_type text NOT NULL
    CHECK (reference_type IN ('input_schema','output_schema','instruction_package','documentation','asset')),
  reference_path text NOT NULL CHECK (
    length(reference_path) BETWEEN 3 AND 500
    AND reference_path !~ '(^|/)\.\.(/|$)'
    AND reference_path !~ '^(https?|file)://'
  ),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (skill_version_id,reference_type,reference_path)
);

CREATE TABLE tanaghom.skill_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  skill_id uuid NOT NULL REFERENCES tanaghom.skill_definitions(id) ON DELETE RESTRICT,
  skill_version_id uuid REFERENCES tanaghom.skill_versions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (
    event_type IN ('defined','validated','published','deprecated','retired','bound','unbound')
  ),
  actor_kind text NOT NULL CHECK (actor_kind IN ('migration','platform_operator','organization_owner')),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance)='object'),
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE FUNCTION tanaghom.enforce_skill_version_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.lifecycle_state IN ('published','deprecated','retired') THEN
      RAISE EXCEPTION 'published skill versions are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP='UPDATE' AND OLD.lifecycle_state IN ('published','deprecated','retired') THEN
    IF NEW.skill_id IS DISTINCT FROM OLD.skill_id
      OR NEW.version_number IS DISTINCT FROM OLD.version_number
      OR NEW.instructions IS DISTINCT FROM OLD.instructions
      OR NEW.input_schema_ref IS DISTINCT FROM OLD.input_schema_ref
      OR NEW.output_schema_ref IS DISTINCT FROM OLD.output_schema_ref
      OR NEW.risk_class IS DISTINCT FROM OLD.risk_class
      OR NEW.side_effect_class IS DISTINCT FROM OLD.side_effect_class
      OR NEW.permission_manifest IS DISTINCT FROM OLD.permission_manifest
      OR NEW.integration_requirements IS DISTINCT FROM OLD.integration_requirements
      OR NEW.executor_type IS DISTINCT FROM OLD.executor_type
      OR NEW.executor_ref IS DISTINCT FROM OLD.executor_ref
      OR NEW.executor_version IS DISTINCT FROM OLD.executor_version
      OR NEW.package_path IS DISTINCT FROM OLD.package_path
      OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
      OR NEW.tool_schema_hash IS DISTINCT FROM OLD.tool_schema_hash
      OR NEW.audit_provenance IS DISTINCT FROM OLD.audit_provenance
      OR NEW.published_at IS DISTINCT FROM OLD.published_at
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'published skill version content cannot be mutated';
    END IF;
    IF (OLD.lifecycle_state='published' AND NEW.lifecycle_state NOT IN ('published','deprecated','retired'))
      OR (OLD.lifecycle_state='deprecated' AND NEW.lifecycle_state NOT IN ('deprecated','retired'))
      OR (OLD.lifecycle_state='retired' AND NEW.lifecycle_state<>'retired')
    THEN
      RAISE EXCEPTION 'invalid published skill lifecycle transition';
    END IF;
  END IF;

  IF NEW.executor_type='pinned_n8n_workflow' AND NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_workflow_registry worker
     WHERE worker.code=NEW.executor_ref AND worker.workflow_version=NEW.executor_version
  ) THEN
    RAISE EXCEPTION 'unknown pinned n8n executor % %',NEW.executor_ref,NEW.executor_version;
  ELSIF NEW.executor_type='controlled_database_function'
    AND to_regprocedure(NEW.executor_ref) IS NULL
  THEN
    RAISE EXCEPTION 'unknown controlled database executor %',NEW.executor_ref;
  ELSIF NEW.executor_type='private_gateway_operation'
    AND NEW.executor_ref NOT IN (
      'postiz.draft.create','postiz.performance.read','ghl.contact.upsert','ghl.action.execute'
    )
  THEN
    RAISE EXCEPTION 'unknown private gateway executor %',NEW.executor_ref;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tanaghom.enforce_agent_skill_binding_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_skill_organization uuid;
  v_executor_ref text;
  v_lifecycle text;
  v_worker_role text;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'agent-to-skill bindings are immutable; create a new pinned binding';
  END IF;
  SELECT definition.organization_id,version.executor_ref,version.lifecycle_state
    INTO v_skill_organization,v_executor_ref,v_lifecycle
    FROM tanaghom.skill_versions version
    JOIN tanaghom.skill_definitions definition ON definition.id=version.skill_id
   WHERE version.id=NEW.skill_version_id;
  SELECT role_code INTO v_worker_role
    FROM tanaghom.agent_workflow_registry WHERE code=NEW.worker_code;
  IF NEW.organization_id IS DISTINCT FROM v_skill_organization THEN
    RAISE EXCEPTION 'cross-tenant agent-to-skill binding is forbidden';
  END IF;
  IF v_worker_role IS DISTINCT FROM NEW.role_code OR v_executor_ref IS DISTINCT FROM NEW.worker_code THEN
    RAISE EXCEPTION 'agent-to-skill worker binding does not match the reviewed executor';
  END IF;
  IF v_lifecycle NOT IN ('published','deprecated') THEN
    RAISE EXCEPTION 'only published skill versions may be bound';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tanaghom.enforce_skill_reference_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_skill_organization uuid;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'skill references are immutable';
  END IF;
  SELECT definition.organization_id INTO v_skill_organization
    FROM tanaghom.skill_versions version
    JOIN tanaghom.skill_definitions definition ON definition.id=version.skill_id
   WHERE version.id=NEW.skill_version_id;
  IF NEW.organization_id IS DISTINCT FROM v_skill_organization THEN
    RAISE EXCEPTION 'cross-tenant skill reference is forbidden';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tanaghom.enforce_skill_audit_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_skill_organization uuid;
  v_version_skill uuid;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'skill audit events are append-only';
  END IF;
  SELECT organization_id INTO v_skill_organization
    FROM tanaghom.skill_definitions WHERE id=NEW.skill_id;
  IF NEW.skill_version_id IS NOT NULL THEN
    SELECT skill_id INTO v_version_skill
      FROM tanaghom.skill_versions WHERE id=NEW.skill_version_id;
  END IF;
  IF NEW.organization_id IS DISTINCT FROM v_skill_organization
    OR (NEW.skill_version_id IS NOT NULL AND v_version_skill IS DISTINCT FROM NEW.skill_id)
  THEN
    RAISE EXCEPTION 'cross-tenant or mismatched skill audit event is forbidden';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER skill_versions_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.skill_versions
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_skill_version_integrity();
CREATE TRIGGER agent_skill_bindings_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.agent_skill_bindings
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_agent_skill_binding_integrity();
CREATE TRIGGER skill_references_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.skill_references
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_skill_reference_integrity();
CREATE TRIGGER skill_audit_events_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.skill_audit_events
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_skill_audit_integrity();

INSERT INTO tanaghom.skill_definitions
  (id,owner_scope,organization_id,code,name,description,skill_class)
VALUES
  ('71000000-0000-4000-8000-000000000001','platform',NULL,'create_campaign_strategy','Create Campaign Strategy',
   'Create a structured campaign strategy from an approved brief without taking an external action.','proposal'),
  ('71000000-0000-4000-8000-000000000002','platform',NULL,'generate_content_drafts','Generate Content Drafts',
   'Create channel-specific content drafts and stop at the existing human approval gate.','proposal'),
  ('71000000-0000-4000-8000-000000000003','platform',NULL,'create_postiz_draft','Create Postiz Draft',
   'Create one Postiz draft after server-side approval and policy checks; automatic publishing is unavailable.','action'),
  ('71000000-0000-4000-8000-000000000004','platform',NULL,'read_postiz_performance','Read Postiz Performance',
   'Read and normalize authorized Postiz metrics without modifying provider content.','read'),
  ('71000000-0000-4000-8000-000000000005','platform',NULL,'upsert_ghl_contact','Upsert GHL Contact',
   'Synchronize one explicitly queued contact to the organization configured GHL location.','action'),
  ('71000000-0000-4000-8000-000000000006','platform',NULL,'propose_conversation_reply','Propose Conversation Reply',
   'Create a grounded and cited reply proposal for an accepted inbound conversation without sending it.','proposal'),
  ('71000000-0000-4000-8000-000000000007','platform',NULL,'execute_governed_ghl_action','Execute Governed GHL Action',
   'Execute one server-authorized GHL action after all policy, approval, consent, and emergency checks.','action'),
  ('71000000-0000-4000-8000-000000000008','platform',NULL,'evaluate_reply_quality','Evaluate Reply Quality',
   'Compare a proposal with approved de-identified human evidence without changing rollout policy or taking an external action.','read');

INSERT INTO tanaghom.skill_versions
  (id,skill_id,version_number,lifecycle_state,instructions,input_schema_ref,output_schema_ref,
   risk_class,side_effect_class,permission_manifest,integration_requirements,
   executor_type,executor_ref,executor_version,package_path,content_hash,tool_schema_hash,
   audit_provenance,published_at)
VALUES
  ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',1,'published',
   'Produce a contract-valid strategy proposal grounded in the approved brief and stop before content generation.',
   'packages/contracts/schemas/phase3/strategist-job.v1.schema.json','packages/contracts/schemas/phase3/strategist-output.v1.schema.json',
   'medium','proposal_only',
   '{"data_domains":["campaign_brief","campaign_strategy"],"integrations":["gemma_private_api"],"channels":[],"operations":["campaign.strategy.propose"]}',
   ARRAY['gemma_private_api'],'pinned_n8n_workflow','campaign_strategy_generator','v1',
   'skills/platform/create-campaign-strategy/SKILL.md',
   '6fc30a74e8ab9672d96b329491f3a08b59c40f693874399a3811c0a8dc89a2b7',
   'a373a8cf4f6cd188e4ec7a95c9b995c642a36970ecdb0c4ad830cf287efbef78',
   '{"source":"phase7a-reconciliation","issue":132,"worker_code":"campaign_strategy_generator"}',
   timestamptz '2026-07-23 00:00:00+00'),
  ('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000002',1,'published',
   'Produce only contract-valid draft content from an approved strategy and never approve or publish it.',
   'packages/contracts/schemas/phase3/content-producer-job.v1.schema.json','packages/contracts/schemas/phase3/content-producer-output.v1.schema.json',
   'medium','proposal_only',
   '{"data_domains":["campaign_strategy","content_item"],"integrations":["gemma_private_api"],"channels":["email","facebook","instagram","linkedin","tiktok","x","youtube"],"operations":["campaign.content.propose"]}',
   ARRAY['gemma_private_api'],'pinned_n8n_workflow','campaign_content_generator','v1',
   'skills/platform/generate-content-drafts/SKILL.md',
   '80b06ef7be51c32c1889ac56cb03736ac3e88460a368558b67b50b1abbd65907',
   '09a7ff6bb9fdadc55456ce087bee6adafe8afea24b32f27cc8cd6e4177b5513e',
   '{"source":"phase7a-reconciliation","issue":132,"worker_code":"campaign_content_generator"}',
   timestamptz '2026-07-23 00:00:00+00'),
  ('72000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000003',1,'published',
   'Create one approved Postiz draft through the private gateway and stop on an indeterminate outcome.',
   'packages/contracts/schemas/phase7/postiz-draft-command.v1.schema.json','packages/contracts/schemas/phase7/postiz-draft-result.v1.schema.json',
   'high','external_write',
   '{"data_domains":["approval_evidence","content_item","publishing_channel"],"integrations":["postiz_private_gateway"],"channels":["facebook","instagram","linkedin","tiktok","x","youtube"],"operations":["postiz.draft.create"]}',
   ARRAY['postiz_private_gateway'],'pinned_n8n_workflow','postiz_draft_publisher','v1',
   'skills/platform/create-postiz-draft/SKILL.md',
   '0f14d2470e1197a2122e778ecaffd0ed3d08a4e13f4d7732ef874236e272c696',
   '1fa8b5181def098f65e879a37fdfe3b206fd47ec63b142429d09156fd5282832',
   '{"source":"phase7a-reconciliation","issue":132,"worker_code":"postiz_draft_publisher"}',
   timestamptz '2026-07-23 00:00:00+00'),
  ('72000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000004',1,'published',
   'Read only authorized Postiz metrics and return normalized, attributable, and truthful observations.',
   'packages/contracts/schemas/phase4/postiz-performance-job.v1.schema.json','packages/contracts/schemas/phase4/postiz-performance-result.v1.schema.json',
   'low','read_only',
   '{"data_domains":["post_record","postiz_analytics","lead_attribution"],"integrations":["postiz_private_gateway"],"channels":["facebook","instagram","linkedin","tiktok","x","youtube"],"operations":["postiz.performance.read"]}',
   ARRAY['postiz_private_gateway'],'pinned_n8n_workflow','postiz_performance_monitor','v1',
   'skills/platform/read-postiz-performance/SKILL.md',
   '0d3110cd85d4a3c93d9bde6a6f2cdd56bf879414ef841497c51826cd22dad549',
   'e716b86de3cff8666cd7ec443c3ab7dcaa348664ccdfe4cca6f424355a223e43',
   '{"source":"phase7a-reconciliation","issue":132,"worker_code":"postiz_performance_monitor"}',
   timestamptz '2026-07-23 00:00:00+00'),
  ('72000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000005',1,'published',
   'Upsert only the server-prepared contact through the private gateway and preserve duplicate and idempotency policy.',
   'packages/contracts/schemas/phase5/ghl-contact-upsert-job.v1.schema.json','packages/contracts/schemas/phase5/ghl-contact-upsert-result.v1.schema.json',
   'high','external_write',
   '{"data_domains":["lead_contact","crm_sync_state"],"integrations":["ghl_private_gateway"],"channels":[],"operations":["ghl.contact.upsert"]}',
   ARRAY['ghl_private_gateway'],'pinned_n8n_workflow','ghl_contact_sync','v1',
   'skills/platform/upsert-ghl-contact/SKILL.md',
   'af85685adf443e6ab7027e4cb7fe0837cbb6fe358c7f63e7975e700770da6401',
   '8edfadcf0f1be1fcde8822114a1108eb20eb0dfc44619ca82c89bd7774c61531',
   '{"source":"phase7a-reconciliation","issue":132,"worker_code":"ghl_contact_sync"}',
   timestamptz '2026-07-23 00:00:00+00'),
  ('72000000-0000-4000-8000-000000000006','71000000-0000-4000-8000-000000000006',1,'published',
   'Return a grounded cited reply proposal with escalation signals and never send a provider message.',
   'packages/contracts/schemas/phase5/conversation-intelligence-request.v1.schema.json','packages/contracts/schemas/phase5/conversation-intelligence-output.v1.schema.json',
   'high','proposal_only',
   '{"data_domains":["conversation_context","knowledge_base","conversation_policy"],"integrations":["gemma_private_api"],"channels":["email","facebook","instagram","live_chat","sms","whatsapp"],"operations":["conversation.reply.propose"]}',
   ARRAY['gemma_private_api'],'pinned_n8n_workflow','conversation_intelligence_worker','v1',
   'skills/platform/propose-conversation-reply/SKILL.md',
   '2fef589ae17a755e2e1c93e66568eaac825ec4c12e7d9a2f6f328192dee5793e',
   'd1b44e976bbf33d6071c42876eca0842f4dbd0b3b6724d888ac72fd1c35a23c5',
   '{"source":"phase7a-reconciliation","issue":132,"worker_code":"conversation_intelligence_worker"}',
   timestamptz '2026-07-23 00:00:00+00'),
  ('72000000-0000-4000-8000-000000000007','71000000-0000-4000-8000-000000000007',1,'published',
   'Execute one prepared and authorized GHL action through the private gateway; stop on any indeterminate outcome.',
   'packages/contracts/schemas/phase5/ghl-action-job.v1.schema.json','packages/contracts/schemas/phase5/ghl-action-result.v1.schema.json',
   'critical','external_write',
   '{"data_domains":["action_authorization","conversation_context","lead_contact","crm_state"],"integrations":["ghl_private_gateway"],"channels":["email","facebook","instagram","live_chat","sms","system","whatsapp"],"operations":["ghl.appointment.execute","ghl.assignment.execute","ghl.message.execute","ghl.nurture.execute","ghl.opportunity.execute","ghl.qualification.execute","ghl.status.execute","ghl.tag.execute"]}',
   ARRAY['ghl_private_gateway'],'pinned_n8n_workflow','governed_ghl_actions','v1',
   'skills/platform/execute-governed-ghl-action/SKILL.md',
   'f89bdc5b0241f30523b01aab53481be2f8e399630eff2f4a0301cd7326869733',
   '9c2f7f7b275c8972f51869d0659227a0a152601c20b456d6bfe73e3b7039542a',
   '{"source":"phase7a-reconciliation","issue":132,"worker_code":"governed_ghl_actions"}',
   timestamptz '2026-07-23 00:00:00+00'),
  ('72000000-0000-4000-8000-000000000008','71000000-0000-4000-8000-000000000008',1,'published',
   'Evaluate a proposal against the pinned baseline and rubric and return evidence without advancing rollout.',
   'packages/contracts/schemas/phase5g/quality-shadow-job.v1.schema.json','packages/contracts/schemas/phase5g/quality-shadow-result.v1.schema.json',
   'medium','read_only',
   '{"data_domains":["deidentified_baseline","quality_evaluation","rollout_policy"],"integrations":["gemma_private_api"],"channels":[],"operations":["quality.reply.evaluate"]}',
   ARRAY['gemma_private_api'],'pinned_n8n_workflow','quality_shadow_evaluator','v1',
   'skills/platform/evaluate-reply-quality/SKILL.md',
   '8bddf4a27186e327b58030882017faa248fd85ad109e48c57ec17c42784ed444',
   '2285c2822b04e2bc0db4c07e92294a8aa51488231112c058abf3b875e76eec26',
   '{"source":"phase7a-reconciliation","issue":132,"worker_code":"quality_shadow_evaluator"}',
   timestamptz '2026-07-23 00:00:00+00');

INSERT INTO tanaghom.agent_skill_bindings
  (id,role_code,worker_code,skill_version_id,audit_provenance)
VALUES
  ('73000000-0000-4000-8000-000000000001','campaign_strategist','campaign_strategy_generator','72000000-0000-4000-8000-000000000001','{"source":"phase7a-reconciliation","issue":132}'),
  ('73000000-0000-4000-8000-000000000002','content_producer','campaign_content_generator','72000000-0000-4000-8000-000000000002','{"source":"phase7a-reconciliation","issue":132}'),
  ('73000000-0000-4000-8000-000000000003','publisher_monitor','postiz_draft_publisher','72000000-0000-4000-8000-000000000003','{"source":"phase7a-reconciliation","issue":132}'),
  ('73000000-0000-4000-8000-000000000004','publisher_monitor','postiz_performance_monitor','72000000-0000-4000-8000-000000000004','{"source":"phase7a-reconciliation","issue":132}'),
  ('73000000-0000-4000-8000-000000000005','sales_crm','ghl_contact_sync','72000000-0000-4000-8000-000000000005','{"source":"phase7a-reconciliation","issue":132}'),
  ('73000000-0000-4000-8000-000000000006','sales_crm','conversation_intelligence_worker','72000000-0000-4000-8000-000000000006','{"source":"phase7a-reconciliation","issue":132}'),
  ('73000000-0000-4000-8000-000000000007','sales_crm','governed_ghl_actions','72000000-0000-4000-8000-000000000007','{"source":"phase7a-reconciliation","issue":132}'),
  ('73000000-0000-4000-8000-000000000008','sales_crm','quality_shadow_evaluator','72000000-0000-4000-8000-000000000008','{"source":"phase7a-reconciliation","issue":132}');

INSERT INTO tanaghom.skill_references
  (organization_id,skill_version_id,reference_type,reference_path,content_hash)
VALUES
  (NULL,'72000000-0000-4000-8000-000000000001','input_schema','packages/contracts/schemas/phase3/strategist-job.v1.schema.json','4dbf855fc7a4056b1189e009096381a664d2d61e7d755f01682de7994a0db8d6'),
  (NULL,'72000000-0000-4000-8000-000000000001','output_schema','packages/contracts/schemas/phase3/strategist-output.v1.schema.json','5e423f5d686017116c44d2cc58250c9384c1f04a9d245ee329c78462cf619978'),
  (NULL,'72000000-0000-4000-8000-000000000001','instruction_package','skills/platform/create-campaign-strategy/SKILL.md','6fc30a74e8ab9672d96b329491f3a08b59c40f693874399a3811c0a8dc89a2b7'),
  (NULL,'72000000-0000-4000-8000-000000000002','input_schema','packages/contracts/schemas/phase3/content-producer-job.v1.schema.json','bbc39875b82bcaad11e03fc6eabe0b89dd5a9ca2ed695ac809f73f90bd1d5e0d'),
  (NULL,'72000000-0000-4000-8000-000000000002','output_schema','packages/contracts/schemas/phase3/content-producer-output.v1.schema.json','65ad69f9d38aeca0773de5f484b569e75458a0d61de2065aad39b460248347ef'),
  (NULL,'72000000-0000-4000-8000-000000000002','instruction_package','skills/platform/generate-content-drafts/SKILL.md','80b06ef7be51c32c1889ac56cb03736ac3e88460a368558b67b50b1abbd65907'),
  (NULL,'72000000-0000-4000-8000-000000000003','input_schema','packages/contracts/schemas/phase7/postiz-draft-command.v1.schema.json','a21eba71895a1e36cda586c84e77b299ce6c1c2837c98ad4ebc188d05b18a59c'),
  (NULL,'72000000-0000-4000-8000-000000000003','output_schema','packages/contracts/schemas/phase7/postiz-draft-result.v1.schema.json','addb4ae5aa020d6caa015c1cb14b23d9b83fde7d4e4f14898553d356878c6573'),
  (NULL,'72000000-0000-4000-8000-000000000003','instruction_package','skills/platform/create-postiz-draft/SKILL.md','0f14d2470e1197a2122e778ecaffd0ed3d08a4e13f4d7732ef874236e272c696'),
  (NULL,'72000000-0000-4000-8000-000000000004','input_schema','packages/contracts/schemas/phase4/postiz-performance-job.v1.schema.json','6e1219fa5553ae3300998039758f04b74e238cb903606f41933e72147c2d216a'),
  (NULL,'72000000-0000-4000-8000-000000000004','output_schema','packages/contracts/schemas/phase4/postiz-performance-result.v1.schema.json','4f47ab5da2661fc7041ede4cadd8afe51b51a8f8324f75a78263f6f038827e71'),
  (NULL,'72000000-0000-4000-8000-000000000004','instruction_package','skills/platform/read-postiz-performance/SKILL.md','0d3110cd85d4a3c93d9bde6a6f2cdd56bf879414ef841497c51826cd22dad549'),
  (NULL,'72000000-0000-4000-8000-000000000005','input_schema','packages/contracts/schemas/phase5/ghl-contact-upsert-job.v1.schema.json','a121c419cba4d968ab3a74af2dd5d09f0d8f279c670f9f1bbb3872aeb1a38a4f'),
  (NULL,'72000000-0000-4000-8000-000000000005','output_schema','packages/contracts/schemas/phase5/ghl-contact-upsert-result.v1.schema.json','822ebded2a35206f3eff2ac36eae0f911f4eba33029fc0f22ae987f8e870bafb'),
  (NULL,'72000000-0000-4000-8000-000000000005','instruction_package','skills/platform/upsert-ghl-contact/SKILL.md','af85685adf443e6ab7027e4cb7fe0837cbb6fe358c7f63e7975e700770da6401'),
  (NULL,'72000000-0000-4000-8000-000000000006','input_schema','packages/contracts/schemas/phase5/conversation-intelligence-request.v1.schema.json','5bcc863c5216638a6a42148b9f9e3af3bbac84481bfd191a3eabff99b027ad37'),
  (NULL,'72000000-0000-4000-8000-000000000006','output_schema','packages/contracts/schemas/phase5/conversation-intelligence-output.v1.schema.json','1d04a03c6992a1974c0d4caa8ff4d6e43b25deefe8ba5233e62b2bc8bcb2256d'),
  (NULL,'72000000-0000-4000-8000-000000000006','instruction_package','skills/platform/propose-conversation-reply/SKILL.md','2fef589ae17a755e2e1c93e66568eaac825ec4c12e7d9a2f6f328192dee5793e'),
  (NULL,'72000000-0000-4000-8000-000000000007','input_schema','packages/contracts/schemas/phase5/ghl-action-job.v1.schema.json','072a89f07213b0d4318ff58eb6d3958a3a0f8122fe675b488859c9d4b7669b4c'),
  (NULL,'72000000-0000-4000-8000-000000000007','output_schema','packages/contracts/schemas/phase5/ghl-action-result.v1.schema.json','83177223fea1e39149a2ff202ba9dfe142207c8bc1da8e64369d70a4609f1c16'),
  (NULL,'72000000-0000-4000-8000-000000000007','instruction_package','skills/platform/execute-governed-ghl-action/SKILL.md','f89bdc5b0241f30523b01aab53481be2f8e399630eff2f4a0301cd7326869733'),
  (NULL,'72000000-0000-4000-8000-000000000008','input_schema','packages/contracts/schemas/phase5g/quality-shadow-job.v1.schema.json','ca280816045b09a65005249379ca7cb450765ce0390f2391caf0297b3d68b522'),
  (NULL,'72000000-0000-4000-8000-000000000008','output_schema','packages/contracts/schemas/phase5g/quality-shadow-result.v1.schema.json','e4c5dfc3f32f5ea107c7c86f20b68822afd4f0d4f90ff7ee6b33f8d9665736c4'),
  (NULL,'72000000-0000-4000-8000-000000000008','instruction_package','skills/platform/evaluate-reply-quality/SKILL.md','8bddf4a27186e327b58030882017faa248fd85ad109e48c57ec17c42784ed444');

INSERT INTO tanaghom.skill_audit_events
  (organization_id,skill_id,skill_version_id,event_type,actor_kind,provenance)
SELECT NULL,definition.id,version.id,'published','migration',
       jsonb_build_object('source','phase7a-reconciliation','issue',132,'worker_code',version.executor_ref)
  FROM tanaghom.skill_definitions definition
  JOIN tanaghom.skill_versions version ON version.skill_id=definition.id;

REVOKE ALL ON
  tanaghom.skill_definitions,tanaghom.skill_versions,tanaghom.agent_skill_bindings,
  tanaghom.skill_references,tanaghom.skill_audit_events
FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker,tanaghom_readonly,tanaghom_api;
GRANT SELECT ON
  tanaghom.skill_definitions,tanaghom.skill_versions,tanaghom.agent_skill_bindings,
  tanaghom.skill_references,tanaghom.skill_audit_events
TO tanaghom_api,tanaghom_readonly;
REVOKE EXECUTE ON FUNCTION
  tanaghom.skill_permission_manifest_is_safe(jsonb),
  tanaghom.skill_schema_ref_is_safe(text),
  tanaghom.enforce_skill_version_integrity(),
  tanaghom.enforce_agent_skill_binding_integrity(),
  tanaghom.enforce_skill_reference_integrity(),
  tanaghom.enforce_skill_audit_integrity()
FROM PUBLIC,tanaghom_api,tanaghom_n8n_worker,tanaghom_conversation_worker,tanaghom_readonly;

INSERT INTO public.schema_migrations(version)
VALUES ('0026_skill_registry');

COMMIT;
