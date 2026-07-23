BEGIN;

CREATE TABLE tanaghom.organization_skill_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{2,79}$'),
  skill_class text NOT NULL CHECK (skill_class IN ('knowledge','proposal_instruction')),
  created_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id,code),
  UNIQUE (organization_id,id)
);

CREATE TABLE tanaghom.organization_skill_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  lifecycle_state text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_state IN ('draft','validated','published','superseded','retired')),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 3 AND 120),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 20 AND 1000),
  activation_guidance text NOT NULL CHECK (length(trim(activation_guidance)) BETWEEN 20 AND 2000),
  instructions text NOT NULL CHECK (length(trim(instructions)) BETWEEN 20 AND 12000),
  examples jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(examples)='array' AND jsonb_array_length(examples)<=10),
  expected_inputs text[] NOT NULL CHECK (cardinality(expected_inputs) BETWEEN 1 AND 20),
  expected_outputs text[] NOT NULL CHECK (cardinality(expected_outputs) BETWEEN 1 AND 20),
  escalation_conditions text NOT NULL CHECK (length(trim(escalation_conditions)) BETWEEN 10 AND 3000),
  languages text[] NOT NULL CHECK (
    cardinality(languages) BETWEEN 1 AND 2
    AND languages <@ ARRAY['en','ar']::text[]
  ),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  validation_report jsonb,
  validated_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  validated_at timestamptz,
  published_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  retired_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  retired_at timestamptz,
  supersedes_version_id uuid REFERENCES tanaghom.organization_skill_versions(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,skill_id)
    REFERENCES tanaghom.organization_skill_definitions(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (skill_id,version_number),
  UNIQUE (organization_id,id),
  CHECK (
    (lifecycle_state='draft' AND validated_at IS NULL AND published_at IS NULL)
    OR (lifecycle_state='validated' AND validated_at IS NOT NULL AND published_at IS NULL)
    OR (lifecycle_state IN ('published','superseded','retired')
        AND validated_at IS NOT NULL AND published_at IS NOT NULL)
  ),
  CHECK (retired_at IS NULL OR lifecycle_state='retired'),
  CHECK (validation_report IS NULL OR jsonb_typeof(validation_report)='object')
);

CREATE UNIQUE INDEX organization_skill_one_published_version_uidx
  ON tanaghom.organization_skill_versions(skill_id)
  WHERE lifecycle_state='published';

CREATE TABLE tanaghom.organization_skill_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  skill_version_id uuid NOT NULL,
  reference_type text NOT NULL
    CHECK (reference_type IN ('knowledge_collection','approved_document','approved_asset')),
  reference_key text NOT NULL CHECK (
    reference_key ~ '^(knowledge|document|asset)/[a-z0-9][a-z0-9_./-]{2,199}$'
    AND reference_key !~ '(^|/)\.\.(/|$)'
    AND reference_key !~ '^(https?|file):'
  ),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 200),
  language text NOT NULL CHECK (language IN ('en','ar','und')),
  provenance text NOT NULL CHECK (length(trim(provenance)) BETWEEN 3 AND 500),
  review_status text NOT NULL DEFAULT 'approved' CHECK (review_status='approved'),
  expires_at timestamptz,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,skill_version_id)
    REFERENCES tanaghom.organization_skill_versions(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (skill_version_id,reference_key)
);

CREATE TABLE tanaghom.organization_skill_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE RESTRICT,
  skill_id uuid NOT NULL,
  skill_version_id uuid,
  event_type text NOT NULL CHECK (
    event_type IN ('drafted','cloned','validated','published','superseded','retired','exported')
  ),
  actor_id uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance)='object'),
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id,skill_id)
    REFERENCES tanaghom.organization_skill_definitions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,skill_version_id)
    REFERENCES tanaghom.organization_skill_versions(organization_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION tanaghom.assert_organization_skill_owner(p_organization_id uuid,p_actor_id uuid)
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

CREATE FUNCTION tanaghom.organization_skill_text_is_safe(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_value IS NOT NULL
     AND p_value !~ '(^|\n)[[:space:]]*---[[:space:]]*(\n|$)'
     AND p_value !~ '```|~~~'
     AND p_value !~* '(https?|file|javascript|data)://'
     AND p_value !~* '-----BEGIN [A-Z ]*PRIVATE KEY-----'
     AND p_value !~* '(^|[^a-z])(api[_ -]?key|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|password)[[:space:]]*[:=]'
     AND p_value !~* '(^|[^a-z])bearer[[:space:]]+[a-z0-9._-]{8,}'
     AND p_value !~* '(^|[[:space:]])(sudo|ssh|scp|curl|wget|powershell|cmd\.exe|/bin/(sh|bash))([[:space:]]|$)'
     AND p_value !~* '(^|[^a-z])(npm|pnpm|yarn|pip|pipx|apt|apk)[[:space:]]+(add|install|run|exec)([^a-z]|$)'
     AND p_value !~* '([a-z]:\\|/(etc|opt|var|home|root|tmp)/|\.\./)'
     AND p_value !~* '(^|[^a-z])(insert[[:space:]]+into|delete[[:space:]]+from|drop[[:space:]]+table|alter[[:space:]]+table|create[[:space:]]+(table|function|role)|grant[[:space:]]+[a-z]+[[:space:]]+on|revoke[[:space:]]+[a-z]+[[:space:]]+on)([^a-z]|$)'
     AND p_value !~* '<[[:space:]]*(script|iframe|object|embed)([[:space:]>])'
     AND p_value !~* '(^|[^a-z])(n8n[_ -]?(workflow|credential)[_ -]?id)([^a-z]|$)'
     AND p_value !~* '(^|[^a-z])(mcp://|mcp[[:space:]]+(server|tool))([^a-z]|$)';
$$;

CREATE FUNCTION tanaghom.enforce_organization_skill_definition_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'organization skill definitions are immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.app_users
     WHERE id=NEW.created_by AND organization_id=NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'cross-tenant organization skill definition is forbidden';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tanaghom.enforce_organization_skill_version_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_payload jsonb;
  v_new_payload jsonb;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'organization skill versions are append-only';
  END IF;
  IF NOT tanaghom.organization_skill_text_is_safe(NEW.display_name)
    OR NOT tanaghom.organization_skill_text_is_safe(NEW.description)
    OR NOT tanaghom.organization_skill_text_is_safe(NEW.activation_guidance)
    OR NOT tanaghom.organization_skill_text_is_safe(NEW.instructions)
    OR NOT tanaghom.organization_skill_text_is_safe(NEW.escalation_conditions)
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.examples) item
       WHERE jsonb_typeof(item)<>'string'
          OR length(item #>> '{}') NOT BETWEEN 1 AND 1000
          OR NOT tanaghom.organization_skill_text_is_safe(item #>> '{}')
    )
    OR EXISTS (
      SELECT 1 FROM unnest(NEW.expected_inputs || NEW.expected_outputs) item
       WHERE item !~ '^[a-z][a-z0-9._-]{1,79}$'
    )
  THEN
    RAISE EXCEPTION 'organization skill contains unsafe or unsupported content';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.app_users
     WHERE id=NEW.created_by AND organization_id=NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'cross-tenant organization skill version is forbidden';
  END IF;
  IF TG_OP='UPDATE' THEN
    v_old_payload := to_jsonb(OLD) - ARRAY[
      'lifecycle_state','validation_report','validated_by','validated_at',
      'published_by','published_at','retired_by','retired_at'
    ];
    v_new_payload := to_jsonb(NEW) - ARRAY[
      'lifecycle_state','validation_report','validated_by','validated_at',
      'published_by','published_at','retired_by','retired_at'
    ];
    IF v_old_payload IS DISTINCT FROM v_new_payload THEN
      RAISE EXCEPTION 'organization skill version content is immutable; create a new version';
    END IF;
    IF (OLD.lifecycle_state='draft' AND NEW.lifecycle_state NOT IN ('draft','validated'))
      OR (OLD.lifecycle_state='validated' AND NEW.lifecycle_state NOT IN ('validated','published'))
      OR (OLD.lifecycle_state='published' AND NEW.lifecycle_state NOT IN ('published','superseded','retired'))
      OR (OLD.lifecycle_state='superseded' AND NEW.lifecycle_state NOT IN ('superseded','retired'))
      OR (OLD.lifecycle_state='retired' AND NEW.lifecycle_state<>'retired')
    THEN
      RAISE EXCEPTION 'invalid organization skill lifecycle transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tanaghom.enforce_organization_skill_reference_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'organization skill references are immutable';
  END IF;
  IF NOT tanaghom.organization_skill_text_is_safe(NEW.title)
    OR NOT tanaghom.organization_skill_text_is_safe(NEW.provenance)
  THEN
    RAISE EXCEPTION 'organization skill reference contains unsafe content';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tanaghom.enforce_organization_skill_audit_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'organization skill audit is append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.app_users
     WHERE id=NEW.actor_id AND organization_id=NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'cross-tenant organization skill audit is forbidden';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_skill_definitions_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.organization_skill_definitions
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_organization_skill_definition_integrity();
CREATE TRIGGER organization_skill_versions_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.organization_skill_versions
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_organization_skill_version_integrity();
CREATE TRIGGER organization_skill_references_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.organization_skill_references
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_organization_skill_reference_integrity();
CREATE TRIGGER organization_skill_audit_integrity
BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.organization_skill_audit_events
FOR EACH ROW EXECUTE FUNCTION tanaghom.enforce_organization_skill_audit_integrity();

CREATE FUNCTION tanaghom.create_organization_skill_draft(
  p_organization_id uuid,
  p_actor_id uuid,
  p_code text,
  p_skill_class text,
  p_display_name text,
  p_description text,
  p_activation_guidance text,
  p_instructions text,
  p_examples jsonb,
  p_expected_inputs text[],
  p_expected_outputs text[],
  p_escalation_conditions text,
  p_languages text[],
  p_content_hash text,
  p_references jsonb DEFAULT '[]'::jsonb,
  p_clone_source_version_id uuid DEFAULT NULL
)
RETURNS TABLE(skill_id uuid,skill_version_id uuid,version_number integer,lifecycle_state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_skill tanaghom.organization_skill_definitions%ROWTYPE;
  v_version tanaghom.organization_skill_versions%ROWTYPE;
  v_reference jsonb;
  v_supersedes uuid;
BEGIN
  PERFORM tanaghom.assert_organization_skill_owner(p_organization_id,p_actor_id);
  IF p_skill_class NOT IN ('knowledge','proposal_instruction')
    OR p_code !~ '^[a-z][a-z0-9_]{2,79}$'
    OR jsonb_typeof(p_references)<>'array'
    OR jsonb_array_length(p_references)>10
  THEN
    RAISE EXCEPTION 'invalid organization skill draft';
  END IF;
  IF p_clone_source_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tanaghom.organization_skill_versions
     WHERE id=p_clone_source_version_id AND organization_id=p_organization_id
    UNION ALL
    SELECT 1 FROM tanaghom.skill_versions version
    JOIN tanaghom.skill_definitions definition ON definition.id=version.skill_id
     WHERE version.id=p_clone_source_version_id AND definition.organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'cross-tenant or unknown clone source';
  END IF;

  SELECT * INTO v_skill FROM tanaghom.organization_skill_definitions
   WHERE organization_id=p_organization_id AND code=p_code FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO tanaghom.organization_skill_definitions
      (organization_id,code,skill_class,created_by)
    VALUES (p_organization_id,p_code,p_skill_class,p_actor_id)
    RETURNING * INTO v_skill;
  ELSIF v_skill.skill_class<>p_skill_class THEN
    RAISE EXCEPTION 'skill class cannot change';
  END IF;

  SELECT existing.id INTO v_supersedes
    FROM tanaghom.organization_skill_versions existing
   WHERE existing.skill_id=v_skill.id
   ORDER BY existing.version_number DESC LIMIT 1;
  INSERT INTO tanaghom.organization_skill_versions (
    organization_id,skill_id,version_number,display_name,description,activation_guidance,
    instructions,examples,expected_inputs,expected_outputs,escalation_conditions,languages,
    content_hash,supersedes_version_id,created_by
  ) VALUES (
    p_organization_id,v_skill.id,
    COALESCE((SELECT max(existing.version_number)+1
                FROM tanaghom.organization_skill_versions existing
               WHERE existing.skill_id=v_skill.id),1),
    p_display_name,p_description,p_activation_guidance,p_instructions,COALESCE(p_examples,'[]'::jsonb),
    p_expected_inputs,p_expected_outputs,p_escalation_conditions,p_languages,p_content_hash,
    v_supersedes,p_actor_id
  ) RETURNING * INTO v_version;

  FOR v_reference IN SELECT value FROM jsonb_array_elements(p_references)
  LOOP
    IF jsonb_typeof(v_reference)<>'object'
      OR NOT (v_reference ?& ARRAY['reference_type','reference_key','title','language','provenance','content_hash'])
      OR (v_reference - ARRAY['reference_type','reference_key','title','language','provenance','content_hash','expires_at']) <> '{}'::jsonb
    THEN
      RAISE EXCEPTION 'invalid organization skill reference';
    END IF;
    INSERT INTO tanaghom.organization_skill_references (
      organization_id,skill_version_id,reference_type,reference_key,title,language,
      provenance,expires_at,content_hash
    ) VALUES (
      p_organization_id,v_version.id,v_reference->>'reference_type',v_reference->>'reference_key',
      v_reference->>'title',v_reference->>'language',v_reference->>'provenance',
      NULLIF(v_reference->>'expires_at','')::timestamptz,v_reference->>'content_hash'
    );
  END LOOP;

  INSERT INTO tanaghom.organization_skill_audit_events (
    organization_id,skill_id,skill_version_id,event_type,actor_id,provenance
  ) VALUES (
    p_organization_id,v_skill.id,v_version.id,
    CASE WHEN p_clone_source_version_id IS NULL THEN 'drafted' ELSE 'cloned' END,
    p_actor_id,jsonb_build_object('issue',133,'clone_source_version_id',p_clone_source_version_id)
  );
  RETURN QUERY SELECT v_skill.id,v_version.id,v_version.version_number,v_version.lifecycle_state;
END;
$$;

CREATE FUNCTION tanaghom.transition_organization_skill_version(
  p_organization_id uuid,
  p_actor_id uuid,
  p_skill_version_id uuid,
  p_action text,
  p_validation_report jsonb DEFAULT NULL
)
RETURNS TABLE(skill_version_id uuid,lifecycle_state text,content_hash text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_version tanaghom.organization_skill_versions%ROWTYPE;
  v_previous uuid;
BEGIN
  PERFORM tanaghom.assert_organization_skill_owner(p_organization_id,p_actor_id);
  SELECT * INTO v_version FROM tanaghom.organization_skill_versions
   WHERE id=p_skill_version_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cross-tenant or unknown organization skill version'; END IF;

  IF p_action='validate' THEN
    IF v_version.lifecycle_state<>'draft'
      OR p_validation_report IS NULL
      OR jsonb_typeof(p_validation_report)<>'object'
      OR p_validation_report->>'valid'<>'true'
    THEN RAISE EXCEPTION 'skill validation rejected'; END IF;
    UPDATE tanaghom.organization_skill_versions
       SET lifecycle_state='validated',validation_report=p_validation_report,
           validated_by=p_actor_id,validated_at=statement_timestamp()
     WHERE id=v_version.id RETURNING * INTO v_version;
    INSERT INTO tanaghom.organization_skill_audit_events
      (organization_id,skill_id,skill_version_id,event_type,actor_id,provenance)
    VALUES (p_organization_id,v_version.skill_id,v_version.id,'validated',p_actor_id,p_validation_report);
  ELSIF p_action='publish' THEN
    IF v_version.lifecycle_state<>'validated' THEN RAISE EXCEPTION 'validated skill required'; END IF;
    SELECT existing.id INTO v_previous
      FROM tanaghom.organization_skill_versions existing
     WHERE existing.skill_id=v_version.skill_id AND existing.lifecycle_state='published'
     FOR UPDATE;
    IF v_previous IS NOT NULL THEN
      UPDATE tanaghom.organization_skill_versions SET lifecycle_state='superseded' WHERE id=v_previous;
      INSERT INTO tanaghom.organization_skill_audit_events
        (organization_id,skill_id,skill_version_id,event_type,actor_id,provenance)
      VALUES (p_organization_id,v_version.skill_id,v_previous,'superseded',p_actor_id,
              jsonb_build_object('replacement_version_id',v_version.id));
    END IF;
    UPDATE tanaghom.organization_skill_versions
       SET lifecycle_state='published',published_by=p_actor_id,published_at=statement_timestamp()
     WHERE id=v_version.id RETURNING * INTO v_version;
    INSERT INTO tanaghom.organization_skill_audit_events
      (organization_id,skill_id,skill_version_id,event_type,actor_id,provenance)
    VALUES (p_organization_id,v_version.skill_id,v_version.id,'published',p_actor_id,
            jsonb_build_object('content_hash',v_version.content_hash,'agent_bindings_changed',false));
  ELSIF p_action='retire' THEN
    IF v_version.lifecycle_state NOT IN ('published','superseded') THEN RAISE EXCEPTION 'published skill required'; END IF;
    UPDATE tanaghom.organization_skill_versions
       SET lifecycle_state='retired',retired_by=p_actor_id,retired_at=statement_timestamp()
     WHERE id=v_version.id RETURNING * INTO v_version;
    INSERT INTO tanaghom.organization_skill_audit_events
      (organization_id,skill_id,skill_version_id,event_type,actor_id,provenance)
    VALUES (p_organization_id,v_version.skill_id,v_version.id,'retired',p_actor_id,
            jsonb_build_object('new_bindings_allowed',false,'historical_records_preserved',true));
  ELSE
    RAISE EXCEPTION 'unsupported organization skill lifecycle action';
  END IF;
  RETURN QUERY SELECT v_version.id,v_version.lifecycle_state,v_version.content_hash;
END;
$$;

CREATE FUNCTION tanaghom.record_organization_skill_export(
  p_organization_id uuid,p_actor_id uuid,p_skill_version_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE v_version tanaghom.organization_skill_versions%ROWTYPE;
BEGIN
  PERFORM tanaghom.assert_organization_skill_owner(p_organization_id,p_actor_id);
  SELECT * INTO v_version FROM tanaghom.organization_skill_versions
   WHERE id=p_skill_version_id AND organization_id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cross-tenant or unknown organization skill version'; END IF;
  INSERT INTO tanaghom.organization_skill_audit_events
    (organization_id,skill_id,skill_version_id,event_type,actor_id,provenance)
  VALUES (p_organization_id,v_version.skill_id,v_version.id,'exported',p_actor_id,
          jsonb_build_object('format','agent-skills-compatible','content_hash',v_version.content_hash));
END;
$$;

REVOKE ALL ON
  tanaghom.organization_skill_definitions,tanaghom.organization_skill_versions,
  tanaghom.organization_skill_references,tanaghom.organization_skill_audit_events
FROM PUBLIC,tanaghom_api,tanaghom_readonly,tanaghom_n8n_worker,tanaghom_conversation_worker;
GRANT SELECT ON
  tanaghom.organization_skill_definitions,tanaghom.organization_skill_versions,
  tanaghom.organization_skill_references,tanaghom.organization_skill_audit_events
TO tanaghom_api,tanaghom_readonly;

REVOKE EXECUTE ON FUNCTION
  tanaghom.assert_organization_skill_owner(uuid,uuid),
  tanaghom.organization_skill_text_is_safe(text),
  tanaghom.enforce_organization_skill_definition_integrity(),
  tanaghom.enforce_organization_skill_version_integrity(),
  tanaghom.enforce_organization_skill_reference_integrity(),
  tanaghom.enforce_organization_skill_audit_integrity(),
  tanaghom.create_organization_skill_draft(uuid,uuid,text,text,text,text,text,text,jsonb,text[],text[],text,text[],text,jsonb,uuid),
  tanaghom.transition_organization_skill_version(uuid,uuid,uuid,text,jsonb),
  tanaghom.record_organization_skill_export(uuid,uuid,uuid)
FROM PUBLIC,tanaghom_api,tanaghom_readonly,tanaghom_n8n_worker,tanaghom_conversation_worker;
GRANT EXECUTE ON FUNCTION
  tanaghom.create_organization_skill_draft(uuid,uuid,text,text,text,text,text,text,jsonb,text[],text[],text,text[],text,jsonb,uuid),
  tanaghom.transition_organization_skill_version(uuid,uuid,uuid,text,jsonb),
  tanaghom.record_organization_skill_export(uuid,uuid,uuid)
TO tanaghom_api;

INSERT INTO public.schema_migrations(version)
VALUES ('0027_governed_skill_library');

COMMIT;
