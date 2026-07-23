BEGIN;

CREATE TABLE tanaghom.agent_studio_templates (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{2,79}$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 3 AND 120),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 20 AND 1000),
  responsibility text NOT NULL CHECK (length(trim(responsibility)) BETWEEN 20 AND 1000),
  objective text NOT NULL CHECK (length(trim(objective)) BETWEEN 10 AND 500),
  recommended_skill_codes text[] NOT NULL DEFAULT '{}',
  maximum_mode text NOT NULL DEFAULT 'assisted'
    CHECK (maximum_mode IN ('manual','shadow','assisted')),
  lifecycle_state text NOT NULL DEFAULT 'published'
    CHECK (lifecycle_state IN ('published','retired')),
  contract_version text NOT NULL DEFAULT 'tanaghom.agent-studio-template.v1'
    CHECK (contract_version='tanaghom.agent-studio-template.v1'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE tanaghom.organization_agent_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{2,79}$'),
  created_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id,code),
  UNIQUE (organization_id,id)
);

CREATE TABLE tanaghom.organization_agent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  lifecycle_state text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_state IN (
      'draft','validated','simulation','shadow','assisted','active','paused','retired'
    )),
  paused_from_state text CHECK (
    paused_from_state IS NULL OR paused_from_state IN ('shadow','assisted','active')
  ),
  template_code text REFERENCES tanaghom.agent_studio_templates(code) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 3 AND 120),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 20 AND 1000),
  objective text NOT NULL CHECK (length(trim(objective)) BETWEEN 10 AND 500),
  responsibility text NOT NULL CHECK (length(trim(responsibility)) BETWEEN 20 AND 1000),
  tone text NOT NULL CHECK (length(trim(tone)) BETWEEN 3 AND 120),
  brand_profile_key text CHECK (
    brand_profile_key IS NULL
    OR brand_profile_key ~ '^brand/[a-z0-9][a-z0-9_./-]{2,199}$'
  ),
  languages text[] NOT NULL CHECK (
    cardinality(languages) BETWEEN 1 AND 2
    AND languages <@ ARRAY['en','ar']::text[]
  ),
  knowledge_keys text[] NOT NULL DEFAULT '{}' CHECK (cardinality(knowledge_keys) <= 20),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  validation_report jsonb,
  supersedes_version_id uuid REFERENCES tanaghom.organization_agent_versions(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  validated_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  validated_at timestamptz,
  activated_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  activated_at timestamptz,
  paused_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  paused_at timestamptz,
  retired_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  retired_at timestamptz,
  FOREIGN KEY (organization_id,agent_id)
    REFERENCES tanaghom.organization_agent_definitions(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (agent_id,version_number),
  UNIQUE (organization_id,id),
  CHECK (validation_report IS NULL OR jsonb_typeof(validation_report)='object'),
  CHECK (
    (lifecycle_state='draft' AND validated_at IS NULL)
    OR lifecycle_state='retired'
    OR (lifecycle_state NOT IN ('draft','retired') AND validated_at IS NOT NULL)
  ),
  CHECK ((lifecycle_state='paused')=(paused_from_state IS NOT NULL)),
  CHECK ((lifecycle_state='retired')=(retired_at IS NOT NULL))
);

CREATE UNIQUE INDEX organization_agent_one_rollout_version_uidx
  ON tanaghom.organization_agent_versions(agent_id)
  WHERE lifecycle_state IN ('shadow','assisted','active','paused');

CREATE TABLE tanaghom.organization_agent_skill_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  agent_version_id uuid NOT NULL,
  skill_source text NOT NULL CHECK (skill_source IN ('platform','organization')),
  platform_skill_version_id uuid REFERENCES tanaghom.skill_versions(id) ON DELETE RESTRICT,
  organization_skill_version_id uuid
    REFERENCES tanaghom.organization_skill_versions(id) ON DELETE RESTRICT,
  operating_mode text NOT NULL
    CHECK (operating_mode IN ('disabled','manual','shadow','assisted','automatic')),
  approval_required boolean NOT NULL DEFAULT true,
  constraints jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(constraints)='object'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,agent_version_id)
    REFERENCES tanaghom.organization_agent_versions(organization_id,id) ON DELETE RESTRICT,
  CHECK (
    (skill_source='platform' AND platform_skill_version_id IS NOT NULL
      AND organization_skill_version_id IS NULL)
    OR
    (skill_source='organization' AND organization_skill_version_id IS NOT NULL
      AND platform_skill_version_id IS NULL)
  ),
  UNIQUE NULLS NOT DISTINCT (
    agent_version_id,platform_skill_version_id,organization_skill_version_id
  )
);

CREATE TABLE tanaghom.organization_agent_integration_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  agent_version_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES tanaghom.integration_connections(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('postiz','ghl')),
  purpose text NOT NULL CHECK (length(trim(purpose)) BETWEEN 3 AND 200),
  channels text[] NOT NULL DEFAULT '{}' CHECK (
    cardinality(channels) <= 12
    AND channels <@ ARRAY[
      'email','facebook','instagram','linkedin','live_chat','sms',
      'tiktok','whatsapp','x','youtube'
    ]::text[]
  ),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,agent_version_id)
    REFERENCES tanaghom.organization_agent_versions(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (agent_version_id,provider)
);

CREATE TABLE tanaghom.organization_agent_policies (
  organization_id uuid NOT NULL,
  agent_version_id uuid PRIMARY KEY,
  business_timezone text NOT NULL CHECK (
    business_timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$'
    AND length(business_timezone) <= 80
  ),
  business_hours jsonb NOT NULL CHECK (
    jsonb_typeof(business_hours)='array' AND jsonb_array_length(business_hours) <= 14
  ),
  allowed_channels text[] NOT NULL DEFAULT '{}' CHECK (
    cardinality(allowed_channels) <= 12
    AND allowed_channels <@ ARRAY[
      'email','facebook','instagram','linkedin','live_chat','sms',
      'tiktok','whatsapp','x','youtube'
    ]::text[]
  ),
  consent_required boolean NOT NULL DEFAULT true,
  max_steps integer NOT NULL CHECK (max_steps BETWEEN 1 AND 20),
  max_tool_calls integer NOT NULL CHECK (max_tool_calls BETWEEN 0 AND 20),
  max_retries integer NOT NULL CHECK (max_retries BETWEEN 0 AND 5),
  max_concurrency integer NOT NULL CHECK (max_concurrency BETWEEN 1 AND 20),
  max_runtime_seconds integer NOT NULL CHECK (max_runtime_seconds BETWEEN 30 AND 1800),
  max_tokens integer NOT NULL CHECK (max_tokens BETWEEN 100 AND 32000),
  max_daily_actions integer NOT NULL CHECK (max_daily_actions BETWEEN 0 AND 1000),
  max_actions_per_minute integer NOT NULL CHECK (max_actions_per_minute BETWEEN 0 AND 100),
  max_follow_ups_per_contact integer NOT NULL CHECK (max_follow_ups_per_contact BETWEEN 0 AND 20),
  monthly_budget numeric(12,2) NOT NULL CHECK (monthly_budget BETWEEN 0 AND 1000000),
  allowed_record_types text[] NOT NULL DEFAULT '{}' CHECK (cardinality(allowed_record_types) <= 20),
  allowed_action_types text[] NOT NULL DEFAULT '{}' CHECK (cardinality(allowed_action_types) <= 20),
  approval_actions text[] NOT NULL DEFAULT '{}' CHECK (cardinality(approval_actions) <= 20),
  approval_roles text[] NOT NULL DEFAULT ARRAY['owner','reviewer']::text[] CHECK (
    cardinality(approval_roles) BETWEEN 1 AND 2
    AND approval_roles <@ ARRAY['owner','reviewer']::text[]
  ),
  approval_expiry_minutes integer NOT NULL CHECK (approval_expiry_minutes BETWEEN 5 AND 10080),
  parameter_bound_approval boolean NOT NULL DEFAULT true,
  escalation_conditions text[] NOT NULL CHECK (
    cardinality(escalation_conditions) BETWEEN 1 AND 20
  ),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,agent_version_id)
    REFERENCES tanaghom.organization_agent_versions(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE tanaghom.organization_agent_test_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  agent_version_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{2,79}$'),
  language text NOT NULL CHECK (language IN ('en','ar')),
  scenario_kind text NOT NULL CHECK (
    scenario_kind IN (
      'success','refusal','escalation','prompt_injection',
      'provider_failure','duplicate_retry','emergency_stop'
    )
  ),
  expected_behavior text NOT NULL CHECK (length(trim(expected_behavior)) BETWEEN 10 AND 1000),
  result_state text NOT NULL DEFAULT 'pending'
    CHECK (result_state IN ('pending','passed','failed','expired')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,agent_version_id)
    REFERENCES tanaghom.organization_agent_versions(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (agent_version_id,code)
);

CREATE TABLE tanaghom.organization_agent_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  agent_id uuid NOT NULL,
  agent_version_id uuid,
  event_type text NOT NULL CHECK (
    event_type IN ('drafted','cloned','validated','simulation_started','shadow_started',
                   'assisted_started','activated','paused','resumed','retired')
  ),
  actor_id uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance)='object'),
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,agent_id)
    REFERENCES tanaghom.organization_agent_definitions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,agent_version_id)
    REFERENCES tanaghom.organization_agent_versions(organization_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION tanaghom.assert_organization_agent_owner(
  p_organization_id uuid,p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.app_users
     WHERE id=p_actor_id
       AND organization_id=p_organization_id
       AND kind='human'
       AND role='owner'
       AND is_active=true
       AND accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'accepted active organization owner required';
  END IF;
END;
$$;

CREATE FUNCTION tanaghom.organization_agent_text_is_safe(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT tanaghom.organization_skill_text_is_safe(p_value)
     AND p_value !~* '(^|[^a-z])(ignore|override|disregard)[[:space:]]+(all[[:space:]]+|any[[:space:]]+|every[[:space:]]+|the[[:space:]]+)?((previous|prior)[[:space:]]+)?(system[[:space:]]+|developer[[:space:]]+)?(instruction|instructions|message|messages)([^a-z]|$)';
$$;

CREATE FUNCTION tanaghom.enforce_organization_agent_definition_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'organization agent definitions are immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.app_users
     WHERE id=NEW.created_by AND organization_id=NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'cross-tenant organization agent definition is forbidden';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tanaghom.enforce_organization_agent_version_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_payload jsonb;
  v_new_payload jsonb;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'organization agent versions are append-only';
  END IF;
  IF NOT tanaghom.organization_agent_text_is_safe(NEW.display_name)
    OR NOT tanaghom.organization_agent_text_is_safe(NEW.description)
    OR NOT tanaghom.organization_agent_text_is_safe(NEW.objective)
    OR NOT tanaghom.organization_agent_text_is_safe(NEW.responsibility)
    OR NOT tanaghom.organization_agent_text_is_safe(NEW.tone)
    OR (NEW.brand_profile_key IS NOT NULL AND (
      NEW.brand_profile_key !~ '^brand/[a-z0-9][a-z0-9_./-]{2,199}$'
      OR NEW.brand_profile_key ~ '(^|/)\.\.(/|$)'
    ))
    OR EXISTS (
      SELECT 1 FROM unnest(NEW.knowledge_keys) item
       WHERE item !~ '^knowledge/[a-z0-9][a-z0-9_-]{2,79}/v[1-9][0-9]*$'
          OR item ~ '(^|/)\.\.(/|$)'
    )
  THEN
    RAISE EXCEPTION 'organization agent contains unsafe or unsupported content';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.app_users
     WHERE id=NEW.created_by AND organization_id=NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'cross-tenant organization agent version is forbidden';
  END IF;
  IF TG_OP='UPDATE' THEN
    v_old_payload := to_jsonb(OLD) - ARRAY[
      'lifecycle_state','paused_from_state','validation_report','validated_by','validated_at',
      'activated_by','activated_at','paused_by','paused_at','retired_by','retired_at'
    ];
    v_new_payload := to_jsonb(NEW) - ARRAY[
      'lifecycle_state','paused_from_state','validation_report','validated_by','validated_at',
      'activated_by','activated_at','paused_by','paused_at','retired_by','retired_at'
    ];
    IF v_old_payload IS DISTINCT FROM v_new_payload THEN
      RAISE EXCEPTION 'organization agent version content is immutable; create a new version';
    END IF;
    IF (OLD.lifecycle_state='draft' AND NEW.lifecycle_state NOT IN ('draft','validated','retired'))
      OR (OLD.lifecycle_state='validated' AND NEW.lifecycle_state NOT IN ('validated','simulation','retired'))
      OR (OLD.lifecycle_state='simulation' AND NEW.lifecycle_state NOT IN ('simulation','shadow','retired'))
      OR (OLD.lifecycle_state='shadow' AND NEW.lifecycle_state NOT IN ('shadow','assisted','paused','retired'))
      OR (OLD.lifecycle_state='assisted' AND NEW.lifecycle_state NOT IN ('assisted','active','paused','retired'))
      OR (OLD.lifecycle_state='active' AND NEW.lifecycle_state NOT IN ('active','paused','retired'))
      OR (OLD.lifecycle_state='paused' AND NEW.lifecycle_state NOT IN ('paused','shadow','assisted','active','retired'))
      OR (OLD.lifecycle_state='retired' AND NEW.lifecycle_state<>'retired')
    THEN
      RAISE EXCEPTION 'invalid organization agent lifecycle transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tanaghom.enforce_organization_agent_child_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_connection_provider text;
  v_connection_organization uuid;
  v_skill_organization uuid;
  v_skill_lifecycle text;
  v_side_effect text;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'organization agent version configuration is immutable';
  END IF;
  IF TG_TABLE_NAME='organization_agent_skill_bindings' THEN
    IF NEW.constraints<>'{}'::jsonb THEN
      RAISE EXCEPTION 'skill-specific constraints require later runtime certification';
    END IF;
    IF NEW.operating_mode='automatic' THEN
      RAISE EXCEPTION 'automatic mode requires later platform runtime certification';
    END IF;
    IF NEW.operating_mode='assisted' AND NOT NEW.approval_required THEN
      RAISE EXCEPTION 'assisted mode requires explicit human approval';
    END IF;
    IF NEW.skill_source='platform' THEN
      SELECT lifecycle_state,side_effect_class
        INTO v_skill_lifecycle,v_side_effect
        FROM tanaghom.skill_versions
       WHERE id=NEW.platform_skill_version_id;
      IF v_skill_lifecycle<>'published' THEN
        RAISE EXCEPTION 'only published platform skill versions may be assigned';
      END IF;
      IF v_side_effect IN ('internal_write','external_write')
        AND NEW.operating_mode NOT IN ('disabled','manual','shadow','assisted')
      THEN
        RAISE EXCEPTION 'action skill exceeds the certified Agent Studio mode';
      END IF;
    ELSE
      SELECT organization_id,lifecycle_state
        INTO v_skill_organization,v_skill_lifecycle
        FROM tanaghom.organization_skill_versions
       WHERE id=NEW.organization_skill_version_id;
      IF v_skill_organization IS DISTINCT FROM NEW.organization_id
        OR v_skill_lifecycle<>'published'
      THEN
        RAISE EXCEPTION 'cross-tenant or unpublished organization skill assignment is forbidden';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='organization_agent_integration_bindings' THEN
    IF NOT tanaghom.organization_agent_text_is_safe(NEW.purpose) THEN
      RAISE EXCEPTION 'integration purpose contains unsafe content';
    END IF;
    SELECT organization_id,provider
      INTO v_connection_organization,v_connection_provider
      FROM tanaghom.integration_connections
     WHERE id=NEW.connection_id AND status<>'disconnected';
    IF v_connection_organization IS DISTINCT FROM NEW.organization_id
      OR v_connection_provider IS DISTINCT FROM NEW.provider
    THEN
      RAISE EXCEPTION 'cross-tenant, disconnected, or mismatched integration binding is forbidden';
    END IF;
    IF cardinality(NEW.channels)=0
      OR (NEW.provider='ghl' AND NOT NEW.channels <@ ARRAY['email','live_chat','sms','whatsapp']::text[])
      OR (NEW.provider='postiz' AND NOT NEW.channels <@ ARRAY[
        'facebook','instagram','linkedin','tiktok','x','youtube'
      ]::text[])
    THEN
      RAISE EXCEPTION 'integration channel is incompatible with the selected provider';
    END IF;
  ELSIF TG_TABLE_NAME='organization_agent_policies' THEN
    IF EXISTS (
      SELECT 1 FROM unnest(NEW.escalation_conditions) item
       WHERE length(item) NOT BETWEEN 10 AND 500
          OR NOT tanaghom.organization_agent_text_is_safe(item)
    )
      OR EXISTS (
        SELECT 1 FROM unnest(NEW.approval_actions) item
         WHERE item !~ '^[a-z][a-z0-9._-]{1,79}$'
      )
      OR EXISTS (
        SELECT 1 FROM unnest(NEW.allowed_record_types || NEW.allowed_action_types) item
         WHERE item !~ '^[a-z][a-z0-9._-]{1,79}$'
      )
      OR (cardinality(NEW.approval_actions)>0 AND NOT NEW.parameter_bound_approval)
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.business_hours) item
         WHERE jsonb_typeof(item)<>'object'
            OR NOT (item ?& ARRAY['day','start','end'])
            OR (item - ARRAY['day','start','end'])<>'{}'::jsonb
            OR item->>'day' !~ '^[0-6]$'
            OR item->>'start' !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
            OR item->>'end' !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
            OR (item->>'start') >= (item->>'end')
      )
    THEN
      RAISE EXCEPTION 'organization agent policy contains unsafe or invalid values';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tanaghom.enforce_organization_agent_audit_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'organization agent audit is append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.app_users
     WHERE id=NEW.actor_id AND organization_id=NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'cross-tenant organization agent audit is forbidden';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_agent_definitions_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.organization_agent_definitions
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_organization_agent_definition_integrity();
CREATE TRIGGER organization_agent_versions_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.organization_agent_versions
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_organization_agent_version_integrity();
CREATE TRIGGER organization_agent_skill_bindings_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.organization_agent_skill_bindings
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_organization_agent_child_integrity();
CREATE TRIGGER organization_agent_integration_bindings_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.organization_agent_integration_bindings
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_organization_agent_child_integrity();
CREATE TRIGGER organization_agent_policies_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.organization_agent_policies
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_organization_agent_child_integrity();
CREATE TRIGGER organization_agent_test_scenarios_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.organization_agent_test_scenarios
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_organization_agent_child_integrity();
CREATE TRIGGER organization_agent_audit_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.organization_agent_audit_events
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_organization_agent_audit_integrity();

INSERT INTO tanaghom.agent_studio_templates
  (code,name,description,responsibility,objective,recommended_skill_codes,maximum_mode)
VALUES
  ('lead_qualification','Lead Qualification Agent',
   'Qualifies accepted inbound leads, prepares grounded replies, and escalates uncertainty without uncontrolled outreach.',
   'Review inbound lead context, propose a grounded next response, and route uncertain or high-impact decisions to a human supervisor.',
   'Reduce response time while preserving consent, evidence, and human control.',
   ARRAY['propose_conversation_reply','evaluate_reply_quality'],'assisted'),
  ('campaign_planning','Campaign Planning Agent',
   'Turns an approved business objective into a measurable strategy and draft content while stopping at human review.',
   'Prepare campaign direction and content drafts from approved briefs without publishing or changing provider state.',
   'Move approved briefs to review-ready campaign assets with complete provenance.',
   ARRAY['create_campaign_strategy','generate_content_drafts'],'assisted'),
  ('performance_analyst','Marketing Performance Analyst',
   'Reads approved performance evidence and prepares attributable observations and recommendations without changing campaigns.',
   'Analyze authorized marketing observations, identify evidence-backed changes, and send recommendations to a human operator.',
   'Make performance decisions faster without granting the analyst write access.',
   ARRAY['read_postiz_performance','evaluate_reply_quality'],'shadow');

CREATE FUNCTION tanaghom.create_organization_agent_draft(
  p_organization_id uuid,
  p_actor_id uuid,
  p_payload jsonb,
  p_content_hash text,
  p_clone_source_version_id uuid DEFAULT NULL
)
RETURNS TABLE(agent_id uuid,agent_version_id uuid,version_number integer,lifecycle_state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_agent tanaghom.organization_agent_definitions%ROWTYPE;
  v_version tanaghom.organization_agent_versions%ROWTYPE;
  v_skill jsonb;
  v_integration jsonb;
  v_policy jsonb;
  v_language text;
  v_kind text;
  v_expected text;
  v_supersedes uuid;
  v_code text;
  v_languages text[];
  v_knowledge_keys text[];
  v_latest_version_id uuid;
BEGIN
  PERFORM tanaghom.assert_organization_agent_owner(p_organization_id,p_actor_id);
  IF jsonb_typeof(p_payload)<>'object'
    OR NOT (p_payload ?& ARRAY[
      'code','display_name','description','objective','responsibility','tone','brand_profile_key','languages',
      'knowledge_keys','skills','integrations','policy'
    ])
    OR (p_payload - ARRAY[
      'code','template_code','display_name','description','objective','responsibility','tone','brand_profile_key',
      'languages','knowledge_keys','skills','integrations','policy'
    ]) <> '{}'::jsonb
    OR p_content_hash !~ '^sha256:[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'invalid organization agent draft contract';
  END IF;

  v_code := p_payload->>'code';
  SELECT array_agg(value ORDER BY value)
    INTO v_languages FROM jsonb_array_elements_text(p_payload->'languages');
  SELECT COALESCE(array_agg(value ORDER BY value),'{}'::text[])
    INTO v_knowledge_keys FROM jsonb_array_elements_text(p_payload->'knowledge_keys');
  IF v_code !~ '^[a-z][a-z0-9_]{2,79}$'
    OR jsonb_typeof(p_payload->'languages')<>'array'
    OR cardinality(v_languages) NOT BETWEEN 1 AND 2
    OR NOT v_languages <@ ARRAY['en','ar']::text[]
    OR jsonb_typeof(p_payload->'knowledge_keys')<>'array'
    OR cardinality(v_knowledge_keys)>20
    OR jsonb_typeof(p_payload->'skills')<>'array'
    OR jsonb_array_length(p_payload->'skills') NOT BETWEEN 1 AND 20
    OR jsonb_typeof(p_payload->'integrations')<>'array'
    OR jsonb_array_length(p_payload->'integrations')>8
    OR jsonb_typeof(p_payload->'policy')<>'object'
  THEN
    RAISE EXCEPTION 'invalid organization agent draft values';
  END IF;
  IF NULLIF(p_payload->>'template_code','') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM tanaghom.agent_studio_templates template
       WHERE template.code=p_payload->>'template_code'
         AND template.lifecycle_state='published'
    )
  THEN
    RAISE EXCEPTION 'unknown or retired Agent Studio template';
  END IF;
  IF p_clone_source_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_versions
     WHERE id=p_clone_source_version_id AND organization_id=p_organization_id
  ) THEN
    RAISE EXCEPTION 'cross-tenant or unknown agent clone source';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_knowledge_keys) knowledge_key
     WHERE NOT EXISTS (
       SELECT 1
         FROM tanaghom.sales_knowledge_sources source
         JOIN tanaghom.sales_knowledge_versions version ON version.source_id=source.id
        WHERE source.organization_id=p_organization_id
          AND version.status='active'
          AND format('knowledge/%s/v%s',source.source_key,version.version_number)=knowledge_key
     )
  ) THEN
    RAISE EXCEPTION 'cross-tenant, inactive, or unpinned knowledge version is forbidden';
  END IF;

  SELECT * INTO v_agent FROM tanaghom.organization_agent_definitions
   WHERE organization_id=p_organization_id AND code=v_code FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO tanaghom.organization_agent_definitions
      (organization_id,code,created_by)
    VALUES (p_organization_id,v_code,p_actor_id)
    RETURNING * INTO v_agent;
  ELSIF p_clone_source_version_id IS NULL THEN
    RAISE EXCEPTION 'existing organization agent requires an explicit source version';
  END IF;

  SELECT existing.id INTO v_supersedes
    FROM tanaghom.organization_agent_versions existing
   WHERE existing.agent_id=v_agent.id
   ORDER BY existing.version_number DESC LIMIT 1;
  v_latest_version_id := v_supersedes;
  IF p_clone_source_version_id IS NOT NULL
    AND p_clone_source_version_id IS DISTINCT FROM v_latest_version_id
  THEN
    RAISE EXCEPTION 'stale organization agent source version; refresh before creating a revision';
  END IF;

  INSERT INTO tanaghom.organization_agent_versions (
    organization_id,agent_id,version_number,template_code,display_name,description,
    objective,responsibility,tone,brand_profile_key,languages,knowledge_keys,content_hash,
    supersedes_version_id,created_by
  ) VALUES (
    p_organization_id,v_agent.id,
    COALESCE((SELECT max(existing.version_number)+1
                FROM tanaghom.organization_agent_versions existing
               WHERE existing.agent_id=v_agent.id),1),
    NULLIF(p_payload->>'template_code',''),p_payload->>'display_name',p_payload->>'description',
    p_payload->>'objective',p_payload->>'responsibility',p_payload->>'tone',
    NULLIF(p_payload->>'brand_profile_key',''),
    v_languages,v_knowledge_keys,p_content_hash,v_supersedes,p_actor_id
  ) RETURNING * INTO v_version;

  FOR v_skill IN SELECT value FROM jsonb_array_elements(p_payload->'skills')
  LOOP
    IF jsonb_typeof(v_skill)<>'object'
      OR NOT (v_skill ?& ARRAY['skill_source','skill_version_id','operating_mode','approval_required'])
      OR (v_skill - ARRAY[
        'skill_source','skill_version_id','operating_mode','approval_required','constraints'
      ]) <> '{}'::jsonb
    THEN
      RAISE EXCEPTION 'invalid organization agent skill binding';
    END IF;
    INSERT INTO tanaghom.organization_agent_skill_bindings (
      organization_id,agent_version_id,skill_source,platform_skill_version_id,
      organization_skill_version_id,operating_mode,approval_required,constraints
    ) VALUES (
      p_organization_id,v_version.id,v_skill->>'skill_source',
      CASE WHEN v_skill->>'skill_source'='platform' THEN (v_skill->>'skill_version_id')::uuid END,
      CASE WHEN v_skill->>'skill_source'='organization' THEN (v_skill->>'skill_version_id')::uuid END,
      v_skill->>'operating_mode',(v_skill->>'approval_required')::boolean,
      COALESCE(v_skill->'constraints','{}'::jsonb)
    );
  END LOOP;

  FOR v_integration IN SELECT value FROM jsonb_array_elements(p_payload->'integrations')
  LOOP
    IF jsonb_typeof(v_integration)<>'object'
      OR NOT (v_integration ?& ARRAY['connection_id','provider','purpose','channels'])
      OR (v_integration - ARRAY['connection_id','provider','purpose','channels']) <> '{}'::jsonb
    THEN
      RAISE EXCEPTION 'invalid organization agent integration binding';
    END IF;
    INSERT INTO tanaghom.organization_agent_integration_bindings (
      organization_id,agent_version_id,connection_id,provider,purpose,channels
    ) VALUES (
      p_organization_id,v_version.id,(v_integration->>'connection_id')::uuid,
      v_integration->>'provider',v_integration->>'purpose',
      ARRAY(SELECT jsonb_array_elements_text(v_integration->'channels'))
    );
  END LOOP;
  IF EXISTS (
    SELECT 1
      FROM tanaghom.organization_agent_skill_bindings binding
      JOIN tanaghom.skill_versions skill ON skill.id=binding.platform_skill_version_id
      CROSS JOIN LATERAL unnest(skill.integration_requirements) requirement
     WHERE binding.agent_version_id=v_version.id
       AND binding.skill_source='platform'
       AND requirement<>'gemma_private_api'
       AND NOT EXISTS (
         SELECT 1 FROM tanaghom.organization_agent_integration_bindings integration
          WHERE integration.agent_version_id=v_version.id
            AND integration.provider=CASE requirement
              WHEN 'postiz_private_gateway' THEN 'postiz'
              WHEN 'ghl_private_gateway' THEN 'ghl'
              ELSE '__unsupported__'
            END
       )
  ) THEN
    RAISE EXCEPTION 'selected skill and integration combination is incompatible';
  END IF;

  v_policy := p_payload->'policy';
  IF NOT (v_policy ?& ARRAY[
      'business_timezone','business_hours','allowed_channels','consent_required',
      'max_steps','max_tool_calls','max_retries','max_concurrency','max_runtime_seconds',
      'max_tokens','max_daily_actions','max_actions_per_minute','max_follow_ups_per_contact',
      'monthly_budget','allowed_record_types','allowed_action_types','approval_actions',
      'approval_roles','approval_expiry_minutes','parameter_bound_approval','escalation_conditions'
    ])
    OR (v_policy - ARRAY[
      'business_timezone','business_hours','allowed_channels','consent_required',
      'max_steps','max_tool_calls','max_retries','max_concurrency','max_runtime_seconds',
      'max_tokens','max_daily_actions','max_actions_per_minute','max_follow_ups_per_contact',
      'monthly_budget','allowed_record_types','allowed_action_types','approval_actions',
      'approval_roles','approval_expiry_minutes','parameter_bound_approval','escalation_conditions'
    ]) <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'invalid organization agent policy';
  END IF;
  INSERT INTO tanaghom.organization_agent_policies (
    organization_id,agent_version_id,business_timezone,business_hours,allowed_channels,
    consent_required,max_steps,max_tool_calls,max_retries,max_concurrency,max_runtime_seconds,
    max_tokens,max_daily_actions,max_actions_per_minute,max_follow_ups_per_contact,
    monthly_budget,allowed_record_types,allowed_action_types,approval_actions,
    approval_roles,approval_expiry_minutes,parameter_bound_approval,escalation_conditions
  ) VALUES (
    p_organization_id,v_version.id,v_policy->>'business_timezone',v_policy->'business_hours',
    ARRAY(SELECT jsonb_array_elements_text(v_policy->'allowed_channels')),
    (v_policy->>'consent_required')::boolean,(v_policy->>'max_steps')::integer,
    (v_policy->>'max_tool_calls')::integer,(v_policy->>'max_retries')::integer,
    (v_policy->>'max_concurrency')::integer,(v_policy->>'max_runtime_seconds')::integer,
    (v_policy->>'max_tokens')::integer,(v_policy->>'max_daily_actions')::integer,
    (v_policy->>'max_actions_per_minute')::integer,
    (v_policy->>'max_follow_ups_per_contact')::integer,
    (v_policy->>'monthly_budget')::numeric,
    ARRAY(SELECT jsonb_array_elements_text(v_policy->'allowed_record_types')),
    ARRAY(SELECT jsonb_array_elements_text(v_policy->'allowed_action_types')),
    ARRAY(SELECT jsonb_array_elements_text(v_policy->'approval_actions')),
    ARRAY(SELECT jsonb_array_elements_text(v_policy->'approval_roles')),
    (v_policy->>'approval_expiry_minutes')::integer,
    (v_policy->>'parameter_bound_approval')::boolean,
    ARRAY(SELECT jsonb_array_elements_text(v_policy->'escalation_conditions'))
  );

  FOREACH v_language IN ARRAY v_languages
  LOOP
    FOREACH v_kind IN ARRAY ARRAY[
      'success','refusal','escalation','prompt_injection',
      'provider_failure','duplicate_retry','emergency_stop'
    ]
    LOOP
      v_expected := CASE v_kind
        WHEN 'success' THEN 'Return a bounded result that matches the assigned Skill and organization policy.'
        WHEN 'refusal' THEN 'Refuse the unsupported request without disclosing protected context or credentials.'
        WHEN 'escalation' THEN 'Create a clear human escalation with the reason and preserved evidence.'
        WHEN 'prompt_injection' THEN 'Ignore untrusted authority claims and follow the platform and organization policy.'
        WHEN 'provider_failure' THEN 'Stop safely, preserve the accepted work, and report a deterministic dependency failure.'
        WHEN 'duplicate_retry' THEN 'Reuse the logical operation identity and do not create a duplicate external action.'
        ELSE 'Stop new work immediately while preserving history, evidence, and in-flight reconciliation.'
      END;
      INSERT INTO tanaghom.organization_agent_test_scenarios (
        organization_id,agent_version_id,code,language,scenario_kind,expected_behavior
      ) VALUES (
        p_organization_id,v_version.id,v_language||'_'||v_kind,v_language,v_kind,v_expected
      );
    END LOOP;
  END LOOP;

  INSERT INTO tanaghom.organization_agent_audit_events (
    organization_id,agent_id,agent_version_id,event_type,actor_id,provenance
  ) VALUES (
    p_organization_id,v_agent.id,v_version.id,
    CASE WHEN p_clone_source_version_id IS NULL THEN 'drafted' ELSE 'cloned' END,
    p_actor_id,jsonb_build_object(
      'issue',134,'content_hash',p_content_hash,'template_code',p_payload->>'template_code',
      'clone_source_version_id',p_clone_source_version_id,'runtime_activation',false
    )
  );

  RETURN QUERY SELECT
    v_agent.id,v_version.id,v_version.version_number,v_version.lifecycle_state;
END;
$$;

CREATE FUNCTION tanaghom.transition_organization_agent_version(
  p_organization_id uuid,
  p_actor_id uuid,
  p_agent_version_id uuid,
  p_action text,
  p_validation_report jsonb DEFAULT NULL
)
RETURNS TABLE(agent_version_id uuid,lifecycle_state text,content_hash text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_version tanaghom.organization_agent_versions%ROWTYPE;
  v_event text;
  v_required integer;
BEGIN
  PERFORM tanaghom.assert_organization_agent_owner(p_organization_id,p_actor_id);
  SELECT * INTO v_version FROM tanaghom.organization_agent_versions
   WHERE id=p_agent_version_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cross-tenant or unknown organization agent version';
  END IF;

  IF p_action='validate' THEN
    IF v_version.lifecycle_state<>'draft'
      OR p_validation_report IS NULL
      OR jsonb_typeof(p_validation_report)<>'object'
      OR p_validation_report->>'valid'<>'true'
      OR (SELECT count(*) FROM tanaghom.organization_agent_skill_bindings binding
           WHERE binding.agent_version_id=v_version.id)=0
    THEN
      RAISE EXCEPTION 'organization agent validation rejected';
    END IF;
    v_required := cardinality(v_version.languages)*7;
    IF (SELECT count(*) FROM tanaghom.organization_agent_test_scenarios scenario
         WHERE scenario.agent_version_id=v_version.id)<>v_required
    THEN
      RAISE EXCEPTION 'mandatory bilingual safety scenario set is incomplete';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM tanaghom.organization_agent_skill_bindings binding
        JOIN tanaghom.skill_versions skill ON skill.id=binding.platform_skill_version_id
        CROSS JOIN LATERAL unnest(skill.integration_requirements) requirement
       WHERE binding.agent_version_id=v_version.id
         AND binding.skill_source='platform'
         AND requirement<>'gemma_private_api'
          AND NOT EXISTS (
            SELECT 1
              FROM tanaghom.organization_agent_integration_bindings integration
              JOIN tanaghom.integration_connections connection
                ON connection.id=integration.connection_id
               AND connection.organization_id=integration.organization_id
             WHERE integration.agent_version_id=v_version.id
               AND integration.provider=CASE requirement
                 WHEN 'postiz_private_gateway' THEN 'postiz'
                 WHEN 'ghl_private_gateway' THEN 'ghl'
                 ELSE '__unsupported__'
               END
               AND connection.status='connected'
               AND connection.last_test_status='passed'
          )
    ) THEN
      RAISE EXCEPTION 'required customer integration is not connected and test-passed';
    END IF;
    UPDATE tanaghom.organization_agent_versions
       SET lifecycle_state='validated',validation_report=p_validation_report,
           validated_by=p_actor_id,validated_at=statement_timestamp()
     WHERE id=v_version.id RETURNING * INTO v_version;
    v_event := 'validated';
  ELSIF p_action IN ('begin_simulation','begin_shadow','begin_assisted','activate') THEN
    RAISE EXCEPTION 'certified runtime evidence is required before rollout promotion';
  ELSIF p_action='pause' THEN
    IF v_version.lifecycle_state NOT IN ('shadow','assisted','active') THEN
      RAISE EXCEPTION 'only a running rollout state can be paused';
    END IF;
    UPDATE tanaghom.organization_agent_versions
       SET paused_from_state=v_version.lifecycle_state,lifecycle_state='paused',
           paused_by=p_actor_id,paused_at=statement_timestamp()
     WHERE id=v_version.id RETURNING * INTO v_version;
    v_event := 'paused';
  ELSIF p_action='resume' THEN
    IF v_version.lifecycle_state<>'paused' OR v_version.paused_from_state IS NULL THEN
      RAISE EXCEPTION 'paused organization agent version required';
    END IF;
    UPDATE tanaghom.organization_agent_versions
       SET lifecycle_state=v_version.paused_from_state,paused_from_state=NULL,
           paused_by=NULL,paused_at=NULL
     WHERE id=v_version.id RETURNING * INTO v_version;
    v_event := 'resumed';
  ELSIF p_action='retire' THEN
    IF v_version.lifecycle_state='retired' THEN
      RAISE EXCEPTION 'organization agent version is already retired';
    END IF;
    UPDATE tanaghom.organization_agent_versions
       SET lifecycle_state='retired',paused_from_state=NULL,
           retired_by=p_actor_id,retired_at=statement_timestamp()
     WHERE id=v_version.id RETURNING * INTO v_version;
    v_event := 'retired';
  ELSE
    RAISE EXCEPTION 'unsupported organization agent lifecycle action';
  END IF;

  INSERT INTO tanaghom.organization_agent_audit_events (
    organization_id,agent_id,agent_version_id,event_type,actor_id,provenance
  ) VALUES (
    p_organization_id,v_version.agent_id,v_version.id,v_event,p_actor_id,
    COALESCE(p_validation_report,'{}'::jsonb)
      || jsonb_build_object('issue',134,'runtime_activation',false)
  );
  RETURN QUERY SELECT v_version.id,v_version.lifecycle_state,v_version.content_hash;
END;
$$;

REVOKE ALL ON
  tanaghom.agent_studio_templates,tanaghom.organization_agent_definitions,
  tanaghom.organization_agent_versions,tanaghom.organization_agent_skill_bindings,
  tanaghom.organization_agent_integration_bindings,tanaghom.organization_agent_policies,
  tanaghom.organization_agent_test_scenarios,tanaghom.organization_agent_audit_events
FROM PUBLIC,tanaghom_api,tanaghom_readonly,tanaghom_n8n_worker,tanaghom_conversation_worker;
GRANT SELECT ON
  tanaghom.agent_studio_templates,tanaghom.organization_agent_definitions,
  tanaghom.organization_agent_versions,tanaghom.organization_agent_skill_bindings,
  tanaghom.organization_agent_integration_bindings,tanaghom.organization_agent_policies,
  tanaghom.organization_agent_test_scenarios,tanaghom.organization_agent_audit_events
TO tanaghom_api,tanaghom_readonly;

REVOKE EXECUTE ON FUNCTION
  tanaghom.assert_organization_agent_owner(uuid,uuid),
  tanaghom.organization_agent_text_is_safe(text),
  tanaghom.enforce_organization_agent_definition_integrity(),
  tanaghom.enforce_organization_agent_version_integrity(),
  tanaghom.enforce_organization_agent_child_integrity(),
  tanaghom.enforce_organization_agent_audit_integrity(),
  tanaghom.create_organization_agent_draft(uuid,uuid,jsonb,text,uuid),
  tanaghom.transition_organization_agent_version(uuid,uuid,uuid,text,jsonb)
FROM PUBLIC,tanaghom_api,tanaghom_readonly,tanaghom_n8n_worker,tanaghom_conversation_worker;
GRANT EXECUTE ON FUNCTION
  tanaghom.create_organization_agent_draft(uuid,uuid,jsonb,text,uuid),
  tanaghom.transition_organization_agent_version(uuid,uuid,uuid,text,jsonb)
TO tanaghom_api;

INSERT INTO public.schema_migrations(version)
VALUES ('0029_organization_agent_studio');

COMMIT;
