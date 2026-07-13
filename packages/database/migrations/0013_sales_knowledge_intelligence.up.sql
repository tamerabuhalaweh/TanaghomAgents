BEGIN;

CREATE TABLE tanaghom.sales_knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  source_key text NOT NULL CHECK (source_key ~ '^[a-z][a-z0-9_-]{2,79}$'),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 200),
  category text NOT NULL CHECK (category IN (
    'product', 'service', 'pricing', 'faq', 'policy', 'offer',
    'objection', 'qualification', 'location', 'hours',
    'escalation_rule', 'disclaimer', 'dialect_example'
  )),
  provenance_type text NOT NULL CHECK (provenance_type IN (
    'customer_document', 'customer_entry', 'approved_url', 'legal_policy', 'operator_note'
  )),
  provenance_ref text CHECK (provenance_ref IS NULL OR length(provenance_ref) <= 1000),
  created_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_key)
);

CREATE TRIGGER sales_knowledge_sources_updated_at
BEFORE UPDATE ON tanaghom.sales_knowledge_sources
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE TABLE tanaghom.sales_knowledge_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES tanaghom.sales_knowledge_sources(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'reviewed', 'approved', 'active', 'superseded', 'revoked'
  )),
  language text NOT NULL CHECK (language IN ('en', 'ar', 'und')),
  content text NOT NULL CHECK (length(trim(content)) BETWEEN 3 AND 30000),
  structured_facts jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(structured_facts) = 'array' AND jsonb_array_length(structured_facts) <= 100),
  content_fingerprint text NOT NULL CHECK (content_fingerprint ~ '^md5:[0-9a-f]{32}$'),
  supersedes_version_id uuid REFERENCES tanaghom.sales_knowledge_versions(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  activated_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  revoked_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  approved_at timestamptz,
  activated_at timestamptz,
  superseded_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text CHECK (revoked_reason IS NULL OR length(trim(revoked_reason)) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, version_number),
  CHECK (supersedes_version_id IS NULL OR supersedes_version_id <> id)
);

CREATE TRIGGER sales_knowledge_versions_updated_at
BEFORE UPDATE ON tanaghom.sales_knowledge_versions
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE UNIQUE INDEX sales_knowledge_one_active_language_uidx
  ON tanaghom.sales_knowledge_versions(source_id, language)
  WHERE status = 'active';
CREATE INDEX sales_knowledge_active_retrieval_idx
  ON tanaghom.sales_knowledge_versions(organization_id, language, activated_at DESC)
  WHERE status = 'active';
CREATE INDEX sales_knowledge_source_history_idx
  ON tanaghom.sales_knowledge_versions(source_id, version_number DESC);

CREATE TABLE tanaghom.organization_conversation_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL CHECK (status IN ('active', 'superseded')),
  prompt_version text NOT NULL CHECK (prompt_version = 'phase5.conversation-intelligence.prompt.v1'),
  confidence_threshold numeric(4,3) NOT NULL DEFAULT 0.720
    CHECK (confidence_threshold BETWEEN 0.500 AND 0.950),
  supported_languages text[] NOT NULL DEFAULT ARRAY['en','ar']::text[]
    CHECK (supported_languages <@ ARRAY['en','ar']::text[] AND cardinality(supported_languages) > 0),
  mandatory_escalations text[] NOT NULL DEFAULT ARRAY[
    'complaint','legal','payment','refund','abuse','policy_exception','sensitive_data'
  ]::text[],
  forbidden_topics text[] NOT NULL DEFAULT ARRAY[
    'credential_disclosure','system_prompt','internal_tool_authorization'
  ]::text[],
  forbidden_claims text[] NOT NULL DEFAULT ARRAY[
    'unsupported_guarantee','unapproved_discount','invented_availability',
    'unapproved_legal_or_financial_claim'
  ]::text[],
  sensitive_data_rules text[] NOT NULL DEFAULT ARRAY[
    'do_not_request_passwords','do_not_request_payment_card_data','do_not_echo_secrets'
  ]::text[],
  dialect_guidance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dialect_guidance) = 'object'),
  disclaimers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(disclaimers) = 'object'),
  policy_fingerprint text NOT NULL CHECK (policy_fingerprint ~ '^md5:[0-9a-f]{32}$'),
  activated_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, version_number)
);

CREATE UNIQUE INDEX organization_conversation_one_active_policy_uidx
  ON tanaghom.organization_conversation_policy_versions(organization_id)
  WHERE status = 'active';

INSERT INTO tanaghom.organization_conversation_policy_versions (
  organization_id, version_number, status, prompt_version, policy_fingerprint
)
SELECT id, 1, 'active', 'phase5.conversation-intelligence.prompt.v1',
  'md5:' || md5(id::text || ':phase5.conversation-intelligence.prompt.v1:safe-baseline')
FROM tanaghom.organizations;

CREATE FUNCTION tanaghom.create_default_conversation_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO tanaghom.organization_conversation_policy_versions (
    organization_id, version_number, status, prompt_version, policy_fingerprint
  ) VALUES (
    NEW.id, 1, 'active', 'phase5.conversation-intelligence.prompt.v1',
    'md5:' || md5(NEW.id::text || ':phase5.conversation-intelligence.prompt.v1:safe-baseline')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_default_conversation_policy
AFTER INSERT ON tanaghom.organizations
FOR EACH ROW EXECUTE FUNCTION tanaghom.create_default_conversation_policy();

CREATE TABLE tanaghom.conversation_summary_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  conversation_id text NOT NULL CHECK (length(conversation_id) BETWEEN 1 AND 300),
  version_number integer NOT NULL CHECK (version_number > 0),
  language text NOT NULL CHECK (language IN ('en', 'ar')),
  summary text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 4000),
  input_event_ids uuid[] NOT NULL CHECK (
    cardinality(input_event_ids) BETWEEN 1 AND 12
    AND array_position(input_event_ids, NULL) IS NULL
  ),
  input_fingerprint text NOT NULL CHECK (input_fingerprint ~ '^md5:[0-9a-f]{32}$'),
  prompt_version text NOT NULL CHECK (prompt_version = 'phase5.conversation-summary.prompt.v1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, conversation_id, version_number),
  UNIQUE (organization_id, conversation_id, input_fingerprint, prompt_version)
);

CREATE INDEX conversation_summary_latest_idx
  ON tanaghom.conversation_summary_versions(organization_id, conversation_id, version_number DESC);

CREATE TABLE tanaghom.conversation_intelligence_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL UNIQUE REFERENCES tanaghom.ghl_inbound_events(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL UNIQUE REFERENCES tanaghom.agent_jobs(id) ON DELETE RESTRICT,
  conversation_id text CHECK (conversation_id IS NULL OR length(conversation_id) BETWEEN 1 AND 300),
  contract_version text NOT NULL CHECK (contract_version = 'phase5.conversation-intelligence-output.v1'),
  prompt_version text NOT NULL CHECK (prompt_version = 'phase5.conversation-intelligence.prompt.v1'),
  language text NOT NULL CHECK (language IN ('en', 'ar')),
  intent text NOT NULL CHECK (intent IN (
    'product_question','pricing','availability','objection','purchase_intent','booking',
    'complaint','refund','payment','legal','abuse','policy_exception','sensitive_data',
    'greeting','unknown'
  )),
  urgency text NOT NULL CHECK (urgency IN ('low','normal','high','critical')),
  sentiment text NOT NULL CHECK (sentiment IN ('positive','neutral','negative','mixed')),
  sales_stage text NOT NULL CHECK (sales_stage IN (
    'discovery','qualification','consideration','decision','customer_support','unknown'
  )),
  next_best_action text NOT NULL CHECK (next_best_action IN (
    'respond','ask_clarifying_question','escalate_to_human','no_action'
  )),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  answer_status text NOT NULL CHECK (answer_status IN ('proposal','escalate','no_approved_answer')),
  proposed_reply text CHECK (proposed_reply IS NULL OR length(proposed_reply) <= 5000),
  citations jsonb NOT NULL CHECK (jsonb_typeof(citations) = 'array' AND jsonb_array_length(citations) <= 12),
  risk_categories text[] NOT NULL DEFAULT '{}'::text[],
  escalation_required boolean NOT NULL,
  escalation_category text,
  escalation_reason text,
  policy_version_id uuid NOT NULL REFERENCES tanaghom.organization_conversation_policy_versions(id) ON DELETE RESTRICT,
  summary_version_id uuid REFERENCES tanaghom.conversation_summary_versions(id) ON DELETE RESTRICT,
  model_name text NOT NULL CHECK (length(model_name) BETWEEN 1 AND 120),
  model_output jsonb NOT NULL CHECK (jsonb_typeof(model_output) = 'object'),
  external_action_count integer NOT NULL DEFAULT 0 CHECK (external_action_count = 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (answer_status = 'proposal' AND proposed_reply IS NOT NULL AND jsonb_array_length(citations) > 0)
    OR (answer_status = 'escalate' AND escalation_required AND proposed_reply IS NOT NULL)
    OR (answer_status = 'no_approved_answer' AND escalation_required AND jsonb_array_length(citations) = 0)
  )
);

CREATE INDEX conversation_intelligence_org_time_idx
  ON tanaghom.conversation_intelligence_proposals(organization_id, created_at DESC);
CREATE INDEX conversation_intelligence_conversation_idx
  ON tanaghom.conversation_intelligence_proposals(organization_id, conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

CREATE VIEW tanaghom.sales_knowledge_catalog AS
SELECT source.organization_id, source.id AS source_id, source.source_key,
  source.title, source.category, source.provenance_type, source.provenance_ref,
  version.id AS version_id, version.version_number, version.status, version.language,
  version.content_fingerprint, version.created_by, version.reviewed_by,
  version.approved_by, version.activated_by, version.revoked_by,
  version.reviewed_at, version.approved_at, version.activated_at,
  version.superseded_at, version.revoked_at, version.revoked_reason,
  version.created_at, version.updated_at
FROM tanaghom.sales_knowledge_sources source
JOIN tanaghom.sales_knowledge_versions version ON version.source_id = source.id;

CREATE FUNCTION tanaghom.create_sales_knowledge_draft(
  p_source_key text,
  p_title text,
  p_category text,
  p_language text,
  p_content text,
  p_structured_facts jsonb,
  p_provenance_type text,
  p_provenance_ref text,
  p_actor_user_id uuid
)
RETURNS TABLE (source_id uuid, version_id uuid, version_number integer, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor tanaghom.app_users%ROWTYPE;
  v_source tanaghom.sales_knowledge_sources%ROWTYPE;
  v_version tanaghom.sales_knowledge_versions%ROWTYPE;
  v_facts jsonb := coalesce(p_structured_facts, '[]'::jsonb);
BEGIN
  SELECT * INTO v_actor FROM tanaghom.app_users
   WHERE id = p_actor_user_id AND kind = 'human' AND role = 'owner'
     AND is_active AND accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active organization owner required'; END IF;
  IF coalesce(p_source_key, '') !~ '^[a-z][a-z0-9_-]{2,79}$'
     OR length(trim(coalesce(p_title, ''))) NOT BETWEEN 3 AND 200
     OR coalesce(p_category, '') NOT IN (
       'product','service','pricing','faq','policy','offer','objection','qualification',
       'location','hours','escalation_rule','disclaimer','dialect_example'
     )
     OR coalesce(p_language, '') NOT IN ('en','ar','und')
     OR length(trim(coalesce(p_content, ''))) NOT BETWEEN 3 AND 30000
     OR jsonb_typeof(v_facts) <> 'array' OR jsonb_array_length(v_facts) > 100
     OR coalesce(p_provenance_type, '') NOT IN (
       'customer_document','customer_entry','approved_url','legal_policy','operator_note'
     )
     OR length(coalesce(p_provenance_ref, '')) > 1000 THEN
    RAISE EXCEPTION 'invalid sales knowledge draft';
  END IF;

  SELECT * INTO v_source FROM tanaghom.sales_knowledge_sources
   WHERE organization_id = v_actor.organization_id AND source_key = p_source_key
   FOR UPDATE;
  IF v_source.id IS NULL THEN
    INSERT INTO tanaghom.sales_knowledge_sources (
      organization_id, source_key, title, category, provenance_type, provenance_ref, created_by
    ) VALUES (
      v_actor.organization_id, p_source_key, trim(p_title), p_category,
      p_provenance_type, nullif(trim(coalesce(p_provenance_ref, '')), ''), v_actor.id
    ) RETURNING * INTO v_source;
  ELSIF v_source.category <> p_category THEN
    RAISE EXCEPTION 'knowledge source category is immutable';
  ELSE
    UPDATE tanaghom.sales_knowledge_sources SET
      title = trim(p_title), provenance_type = p_provenance_type,
      provenance_ref = nullif(trim(coalesce(p_provenance_ref, '')), '')
    WHERE id = v_source.id RETURNING * INTO v_source;
  END IF;

  INSERT INTO tanaghom.sales_knowledge_versions (
    source_id, organization_id, version_number, status, language, content,
    structured_facts, content_fingerprint, supersedes_version_id, created_by
  ) SELECT
    v_source.id, v_actor.organization_id, coalesce(max(existing.version_number), 0) + 1,
    'draft', p_language, trim(p_content), v_facts,
    'md5:' || md5(p_language || ':' || trim(p_content) || ':' || v_facts::text),
    (SELECT active.id FROM tanaghom.sales_knowledge_versions active
      WHERE active.source_id = v_source.id AND active.language = p_language
        AND active.status = 'active'),
    v_actor.id
  FROM tanaghom.sales_knowledge_versions existing
  WHERE existing.source_id = v_source.id
  RETURNING * INTO v_version;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
  ) VALUES (
    gen_random_uuid(), v_actor.id, 'knowledge.draft_created', 'sales_knowledge_version',
    v_version.id, jsonb_build_object('source_id', v_source.id, 'version', v_version.version_number,
      'language', v_version.language, 'fingerprint', v_version.content_fingerprint), 'success'
  );
  RETURN QUERY SELECT v_source.id, v_version.id, v_version.version_number, v_version.status;
END;
$$;

CREATE FUNCTION tanaghom.transition_sales_knowledge_version(
  p_version_id uuid,
  p_action text,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (version_id uuid, new_status text, replaced_version_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor tanaghom.app_users%ROWTYPE;
  v_version tanaghom.sales_knowledge_versions%ROWTYPE;
  v_replaced uuid;
BEGIN
  SELECT * INTO v_actor FROM tanaghom.app_users
   WHERE id = p_actor_user_id AND kind = 'human' AND role IN ('owner','reviewer')
     AND is_active AND accepted_at IS NOT NULL;
  SELECT version.* INTO v_version FROM tanaghom.sales_knowledge_versions version
   WHERE version.id = p_version_id AND version.organization_id = v_actor.organization_id
   FOR UPDATE;
  IF v_actor.id IS NULL OR v_version.id IS NULL THEN
    RAISE EXCEPTION 'active knowledge operator and organization version required';
  END IF;

  IF p_action = 'review' THEN
    IF v_version.status <> 'draft' THEN RAISE EXCEPTION 'only draft knowledge can be reviewed'; END IF;
    UPDATE tanaghom.sales_knowledge_versions SET status='reviewed', reviewed_by=v_actor.id,
      reviewed_at=statement_timestamp() WHERE id=v_version.id RETURNING * INTO v_version;
  ELSIF p_action = 'approve' THEN
    IF v_actor.role <> 'owner' THEN RAISE EXCEPTION 'owner approval required'; END IF;
    IF v_version.status <> 'reviewed' THEN RAISE EXCEPTION 'only reviewed knowledge can be approved'; END IF;
    UPDATE tanaghom.sales_knowledge_versions SET status='approved', approved_by=v_actor.id,
      approved_at=statement_timestamp() WHERE id=v_version.id RETURNING * INTO v_version;
  ELSIF p_action = 'activate' THEN
    IF v_actor.role <> 'owner' THEN RAISE EXCEPTION 'owner activation required'; END IF;
    IF v_version.status <> 'approved' THEN RAISE EXCEPTION 'only approved knowledge can be activated'; END IF;
    SELECT id INTO v_replaced FROM tanaghom.sales_knowledge_versions
     WHERE source_id=v_version.source_id AND language=v_version.language AND status='active'
     FOR UPDATE;
    IF v_replaced IS NOT NULL THEN
      UPDATE tanaghom.sales_knowledge_versions SET status='superseded', superseded_at=statement_timestamp()
       WHERE id=v_replaced;
    END IF;
    UPDATE tanaghom.sales_knowledge_versions SET status='active', activated_by=v_actor.id,
      activated_at=statement_timestamp(), superseded_at=NULL WHERE id=v_version.id RETURNING * INTO v_version;
  ELSIF p_action = 'revoke' THEN
    IF v_actor.role <> 'owner' THEN RAISE EXCEPTION 'owner revocation required'; END IF;
    IF v_version.status NOT IN ('reviewed','approved','active') THEN
      RAISE EXCEPTION 'knowledge cannot be revoked from its current state';
    END IF;
    IF length(trim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'revocation reason required';
    END IF;
    UPDATE tanaghom.sales_knowledge_versions SET status='revoked', revoked_by=v_actor.id,
      revoked_at=statement_timestamp(), revoked_reason=trim(p_reason)
     WHERE id=v_version.id RETURNING * INTO v_version;
  ELSIF p_action = 'rollback' THEN
    IF v_actor.role <> 'owner' THEN RAISE EXCEPTION 'owner rollback required'; END IF;
    IF v_version.status <> 'superseded' THEN RAISE EXCEPTION 'only superseded knowledge can be restored'; END IF;
    SELECT id INTO v_replaced FROM tanaghom.sales_knowledge_versions
     WHERE source_id=v_version.source_id AND language=v_version.language AND status='active'
     FOR UPDATE;
    IF v_replaced IS NULL THEN RAISE EXCEPTION 'rollback requires a current active version'; END IF;
    UPDATE tanaghom.sales_knowledge_versions SET status='superseded', superseded_at=statement_timestamp()
     WHERE id=v_replaced;
    UPDATE tanaghom.sales_knowledge_versions SET status='active', activated_by=v_actor.id,
      activated_at=statement_timestamp(), superseded_at=NULL WHERE id=v_version.id RETURNING * INTO v_version;
  ELSE
    RAISE EXCEPTION 'unsupported knowledge transition';
  END IF;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
  ) VALUES (
    gen_random_uuid(), v_actor.id, 'knowledge.' || p_action, 'sales_knowledge_version',
    v_version.id, jsonb_build_object('status', v_version.status, 'replaced_version_id', v_replaced,
      'reason', nullif(trim(coalesce(p_reason, '')), '')), 'success'
  );
  RETURN QUERY SELECT v_version.id, v_version.status, v_replaced;
END;
$$;

CREATE FUNCTION tanaghom.prepare_conversation_intelligence(p_job_id uuid)
RETURNS TABLE (job_id uuid, event_id uuid, organization_id uuid, request_body jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_event tanaghom.ghl_inbound_events%ROWTYPE;
  v_policy tanaghom.organization_conversation_policy_versions%ROWTYPE;
  v_language text;
  v_message text;
  v_knowledge jsonb;
  v_turns jsonb;
  v_summary jsonb;
BEGIN
  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'running'
     OR v_job.job_type <> 'conversation.ghl.inbound_event' THEN
    RAISE EXCEPTION 'running conversation intelligence job required';
  END IF;
  SELECT * INTO v_event FROM tanaghom.ghl_inbound_events
   WHERE id=(v_job.input->>'event_id')::uuid AND status='processing' FOR UPDATE;
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'processing GHL event required'; END IF;
  SELECT policy.* INTO v_policy FROM tanaghom.organization_conversation_policy_versions policy
   WHERE policy.organization_id=v_event.organization_id AND policy.status='active';
  IF v_policy.id IS NULL THEN RAISE EXCEPTION 'active conversation policy required'; END IF;

  v_message := coalesce(v_event.payload->'details'->>'body', '');
  v_language := CASE WHEN v_message ~ '[ء-ي]' THEN 'ar' ELSE 'en' END;

  WITH query_tokens AS (
    SELECT DISTINCT token FROM regexp_split_to_table(lower(v_message), '[^[:alnum:]ء-ي]+') token
     WHERE length(token) >= 2 LIMIT 40
  ), ranked AS (
    SELECT source.id AS source_id, version.id AS version_id, source.source_key,
      source.title, source.category, source.provenance_type, source.provenance_ref,
      version.version_number, version.language, version.content, version.structured_facts,
      version.content_fingerprint,
      coalesce((SELECT sum(CASE WHEN position(token IN lower(version.content)) > 0 THEN 1 ELSE 0 END)
        FROM query_tokens), 0) AS lexical_score
    FROM tanaghom.sales_knowledge_sources source
    JOIN tanaghom.sales_knowledge_versions version ON version.source_id=source.id
    WHERE version.organization_id=v_event.organization_id AND version.status='active'
      AND version.language IN (v_language, 'und')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'source_id', source_id, 'source_version_id', version_id, 'source_key', source_key,
    'title', title, 'category', category, 'version', version_number, 'language', language,
    'content', content, 'structured_facts', structured_facts,
    'content_fingerprint', content_fingerprint, 'provenance_type', provenance_type,
    'provenance_ref', provenance_ref
  ) ORDER BY lexical_score DESC, category, title), '[]'::jsonb) INTO v_knowledge
  FROM (SELECT * FROM ranked WHERE lexical_score > 0 OR category IN ('policy','escalation_rule','disclaimer')
    ORDER BY lexical_score DESC, category, title LIMIT 8) selected;

  SELECT coalesce(jsonb_agg(turn ORDER BY occurred_at), '[]'::jsonb) INTO v_turns FROM (
    SELECT event.occurred_at, jsonb_build_object(
      'event_id', event.id, 'direction', event.direction, 'channel', event.channel,
      'occurred_at', event.occurred_at, 'body', left(coalesce(event.payload->'details'->>'body',''), 4000)
    ) AS turn
    FROM tanaghom.ghl_inbound_events event
    WHERE event.organization_id=v_event.organization_id
      AND event.conversation_id=v_event.conversation_id AND event.id<>v_event.id
      AND event.provider_event_type IN ('InboundMessage','OutboundMessage')
    ORDER BY event.occurred_at DESC LIMIT 12
  ) recent;

  SELECT jsonb_build_object('version', version_number, 'language', language,
    'summary', summary, 'input_event_ids', input_event_ids,
    'input_fingerprint', input_fingerprint, 'prompt_version', prompt_version)
  INTO v_summary FROM tanaghom.conversation_summary_versions summary
   WHERE summary.organization_id=v_event.organization_id AND summary.conversation_id=v_event.conversation_id
   ORDER BY version_number DESC LIMIT 1;

  RETURN QUERY SELECT v_job.id, v_event.id, v_event.organization_id, jsonb_build_object(
    'contract_version', 'phase5.conversation-intelligence-request.v1',
    'prompt_version', v_policy.prompt_version,
    'summary_prompt_version', 'phase5.conversation-summary.prompt.v1',
    'system_policy', jsonb_build_object(
      'policy_version_id', v_policy.id, 'confidence_threshold', v_policy.confidence_threshold,
      'supported_languages', v_policy.supported_languages,
      'mandatory_escalations', v_policy.mandatory_escalations,
      'forbidden_topics', v_policy.forbidden_topics,
      'forbidden_claims', v_policy.forbidden_claims,
      'sensitive_data_rules', v_policy.sensitive_data_rules,
      'dialect_guidance', v_policy.dialect_guidance, 'disclaimers', v_policy.disclaimers,
      'external_actions_allowed', false
    ),
    'provider_message', jsonb_build_object(
      'trust', 'untrusted_customer_input', 'event_id', v_event.id,
      'conversation_id', v_event.conversation_id, 'channel', v_event.channel,
      'language_hint', v_language, 'body', v_message
    ),
    'retrieved_knowledge', v_knowledge,
    'conversation_context', jsonb_build_object(
      'latest_summary', coalesce(v_summary, 'null'::jsonb), 'recent_turns', v_turns,
      'maximum_recent_turns', 12
    ),
    'tool_results', '[]'::jsonb,
    'output_contract', 'phase5.conversation-intelligence-output.v1'
  );
END;
$$;

CREATE FUNCTION tanaghom.persist_conversation_intelligence_proposal(
  p_job_id uuid,
  p_result jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job tanaghom.agent_jobs%ROWTYPE;
  v_event tanaghom.ghl_inbound_events%ROWTYPE;
  v_policy tanaghom.organization_conversation_policy_versions%ROWTYPE;
  v_proposal_id uuid;
  v_summary_id uuid;
  v_summary jsonb;
  v_input_ids uuid[];
  v_input_fingerprint text;
  v_confidence numeric;
  v_escalation boolean;
  v_mandatory boolean;
  v_citation_count integer;
  v_valid_citation_count integer;
BEGIN
  IF jsonb_typeof(p_result) <> 'object'
     OR p_result->>'contract_version' <> 'phase5.conversation-intelligence-output.v1'
     OR p_result->>'prompt_version' <> 'phase5.conversation-intelligence.prompt.v1'
     OR p_result->>'language' NOT IN ('en','ar')
     OR p_result->>'intent' NOT IN (
       'product_question','pricing','availability','objection','purchase_intent','booking',
       'complaint','refund','payment','legal','abuse','policy_exception','sensitive_data',
       'greeting','unknown'
     )
     OR p_result->>'urgency' NOT IN ('low','normal','high','critical')
     OR p_result->>'sentiment' NOT IN ('positive','neutral','negative','mixed')
     OR p_result->>'sales_stage' NOT IN (
       'discovery','qualification','consideration','decision','customer_support','unknown'
     )
     OR p_result->>'next_best_action' NOT IN (
       'respond','ask_clarifying_question','escalate_to_human','no_action'
     )
     OR p_result->>'answer_status' NOT IN ('proposal','escalate','no_approved_answer')
     OR jsonb_typeof(p_result->'citations') <> 'array'
     OR jsonb_typeof(p_result->'risk_categories') <> 'array'
     OR coalesce((p_result->>'external_action_count')::integer, -1) <> 0
     OR length(coalesce(p_result->>'model_name','')) NOT BETWEEN 1 AND 120
     OR length(coalesce(p_result->>'proposed_reply','')) > 5000 THEN
    RAISE EXCEPTION 'invalid conversation intelligence output contract';
  END IF;

  BEGIN v_confidence := (p_result->>'confidence')::numeric;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid conversation confidence'; END;
  IF v_confidence NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION 'invalid conversation confidence'; END IF;
  BEGIN v_escalation := (p_result->'escalation'->>'required')::boolean;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid escalation decision'; END;

  SELECT * INTO v_job FROM tanaghom.agent_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.status <> 'running'
     OR v_job.job_type <> 'conversation.ghl.inbound_event' THEN
    RAISE EXCEPTION 'running conversation intelligence job required';
  END IF;
  SELECT * INTO v_event FROM tanaghom.ghl_inbound_events
   WHERE id=(v_job.input->>'event_id')::uuid AND status='processing' FOR UPDATE;
  SELECT policy.* INTO v_policy FROM tanaghom.organization_conversation_policy_versions policy
   WHERE policy.organization_id=v_event.organization_id AND policy.status='active';
  IF v_event.id IS NULL OR v_policy.id IS NULL THEN RAISE EXCEPTION 'event policy boundary unavailable'; END IF;

  v_mandatory := v_confidence < v_policy.confidence_threshold
    OR p_result->>'intent' = ANY(v_policy.mandatory_escalations)
    OR p_result->>'urgency' IN ('high','critical')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_result->'risk_categories') risk
      WHERE risk = ANY(v_policy.mandatory_escalations));
  IF v_mandatory AND NOT v_escalation THEN RAISE EXCEPTION 'mandatory human escalation required'; END IF;

  v_citation_count := jsonb_array_length(p_result->'citations');
  SELECT count(*) INTO v_valid_citation_count
  FROM jsonb_array_elements(p_result->'citations') citation
  JOIN tanaghom.sales_knowledge_versions version
    ON version.id=(citation->>'source_version_id')::uuid
   AND version.organization_id=v_event.organization_id AND version.status='active'
  JOIN tanaghom.sales_knowledge_sources source
    ON source.id=version.source_id AND source.id=(citation->>'source_id')::uuid
  WHERE citation->>'content_fingerprint'=version.content_fingerprint;
  IF v_valid_citation_count <> v_citation_count THEN
    RAISE EXCEPTION 'citation is not an active organization knowledge version';
  END IF;
  IF p_result->>'answer_status'='proposal' AND v_citation_count=0 THEN
    RAISE EXCEPTION 'factual proposal requires approved citations';
  END IF;
  IF p_result->>'answer_status'='no_approved_answer'
     AND (v_citation_count<>0 OR NOT v_escalation) THEN
    RAISE EXCEPTION 'no-approved-answer result must escalate without citations';
  END IF;

  v_summary := p_result->'conversation_summary';
  IF jsonb_typeof(v_summary)='object' THEN
    SELECT array_agg(value::uuid ORDER BY ordinal) INTO v_input_ids
    FROM jsonb_array_elements_text(v_summary->'input_event_ids') WITH ORDINALITY item(value, ordinal);
    IF cardinality(v_input_ids) NOT BETWEEN 1 AND 12
       OR length(trim(coalesce(v_summary->>'summary',''))) NOT BETWEEN 1 AND 4000
       OR v_summary->>'language' NOT IN ('en','ar') THEN
      RAISE EXCEPTION 'invalid bounded conversation summary';
    END IF;
    IF (SELECT count(*) FROM tanaghom.ghl_inbound_events event
      WHERE event.id=ANY(v_input_ids) AND event.organization_id=v_event.organization_id
        AND event.conversation_id=v_event.conversation_id) <> cardinality(v_input_ids) THEN
      RAISE EXCEPTION 'conversation summary crosses event boundary';
    END IF;
    v_input_fingerprint := 'md5:' || md5(array_to_string(v_input_ids, ':') ||
      ':phase5.conversation-summary.prompt.v1');
    INSERT INTO tanaghom.conversation_summary_versions (
      organization_id, conversation_id, version_number, language, summary,
      input_event_ids, input_fingerprint, prompt_version
    ) SELECT v_event.organization_id, v_event.conversation_id,
      coalesce(max(existing.version_number),0)+1, v_summary->>'language',
      trim(v_summary->>'summary'), v_input_ids, v_input_fingerprint,
      'phase5.conversation-summary.prompt.v1'
    FROM tanaghom.conversation_summary_versions existing
    WHERE existing.organization_id=v_event.organization_id
      AND existing.conversation_id=v_event.conversation_id
    ON CONFLICT (organization_id, conversation_id, input_fingerprint, prompt_version)
    DO UPDATE SET summary=tanaghom.conversation_summary_versions.summary
    RETURNING id INTO v_summary_id;
  END IF;

  INSERT INTO tanaghom.conversation_intelligence_proposals (
    organization_id, event_id, job_id, conversation_id, contract_version,
    prompt_version, language, intent, urgency, sentiment, sales_stage,
    next_best_action, confidence, answer_status, proposed_reply, citations,
    risk_categories, escalation_required, escalation_category, escalation_reason,
    policy_version_id, summary_version_id, model_name, model_output, external_action_count
  ) VALUES (
    v_event.organization_id, v_event.id, v_job.id, v_event.conversation_id,
    p_result->>'contract_version', p_result->>'prompt_version', p_result->>'language',
    p_result->>'intent', p_result->>'urgency', p_result->>'sentiment',
    p_result->>'sales_stage', p_result->>'next_best_action', v_confidence,
    p_result->>'answer_status', nullif(p_result->>'proposed_reply',''), p_result->'citations',
    ARRAY(SELECT jsonb_array_elements_text(p_result->'risk_categories')),
    v_escalation, nullif(p_result->'escalation'->>'category',''),
    nullif(p_result->'escalation'->>'reason',''), v_policy.id, v_summary_id,
    p_result->>'model_name', p_result, 0
  ) RETURNING id INTO v_proposal_id;

  PERFORM tanaghom.complete_ghl_inbound_event(v_job.id, jsonb_build_object(
    'contract_version','phase5.ghl-inbound-event-result.v1', 'event_id',v_event.id,
    'outcome','accepted_for_conversation_intelligence', 'external_action_count',0,
    'proposal_id',v_proposal_id
  ));
  RETURN v_proposal_id;
END;
$$;

REVOKE ALL ON tanaghom.sales_knowledge_sources FROM PUBLIC, tanaghom_n8n_worker, tanaghom_conversation_worker;
REVOKE ALL ON tanaghom.sales_knowledge_versions FROM PUBLIC, tanaghom_n8n_worker, tanaghom_conversation_worker;
REVOKE ALL ON tanaghom.organization_conversation_policy_versions FROM PUBLIC, tanaghom_n8n_worker, tanaghom_conversation_worker;
REVOKE ALL ON tanaghom.conversation_summary_versions FROM PUBLIC, tanaghom_n8n_worker, tanaghom_conversation_worker;
REVOKE ALL ON tanaghom.conversation_intelligence_proposals FROM PUBLIC, tanaghom_n8n_worker, tanaghom_conversation_worker;
REVOKE ALL ON tanaghom.sales_knowledge_catalog FROM PUBLIC, tanaghom_n8n_worker, tanaghom_conversation_worker;
REVOKE ALL ON FUNCTION tanaghom.create_sales_knowledge_draft(text,text,text,text,text,jsonb,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.transition_sales_knowledge_version(uuid,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.prepare_conversation_intelligence(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.persist_conversation_intelligence_proposal(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tanaghom.create_default_conversation_policy() FROM PUBLIC;

GRANT SELECT ON tanaghom.sales_knowledge_sources, tanaghom.sales_knowledge_versions,
  tanaghom.organization_conversation_policy_versions, tanaghom.conversation_summary_versions,
  tanaghom.conversation_intelligence_proposals, tanaghom.sales_knowledge_catalog TO tanaghom_api;
GRANT SELECT ON tanaghom.sales_knowledge_catalog, tanaghom.conversation_intelligence_proposals TO tanaghom_readonly;
GRANT EXECUTE ON FUNCTION tanaghom.create_sales_knowledge_draft(text,text,text,text,text,jsonb,text,text,uuid) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.transition_sales_knowledge_version(uuid,text,uuid,text) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.prepare_conversation_intelligence(uuid) TO tanaghom_conversation_worker;
GRANT EXECUTE ON FUNCTION tanaghom.persist_conversation_intelligence_proposal(uuid,jsonb) TO tanaghom_conversation_worker;

INSERT INTO public.schema_migrations(version)
VALUES ('0013_sales_knowledge_intelligence');

COMMIT;
