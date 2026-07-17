BEGIN;

CREATE TABLE tanaghom.quality_metric_program_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded')),
  formulas jsonb NOT NULL CHECK (jsonb_typeof(formulas)='object'),
  thresholds jsonb NOT NULL CHECK (jsonb_typeof(thresholds)='object'),
  notes text NOT NULL CHECK (length(trim(notes)) BETWEEN 3 AND 2000),
  created_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  approved_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  UNIQUE (organization_id,version_number),
  CHECK ((status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR status<>'approved')
);
CREATE UNIQUE INDEX quality_metric_program_approved_idx
  ON tanaghom.quality_metric_program_versions(organization_id) WHERE status='approved';

CREATE TABLE tanaghom.quality_evaluation_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  metric_program_id uuid NOT NULL REFERENCES tanaghom.quality_metric_program_versions(id) ON DELETE RESTRICT,
  cohort text NOT NULL DEFAULT 'human_baseline' CHECK (cohort='human_baseline'),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','baseline_recorded','shadow_queued','shadow_complete','shadow_recorded','archived')),
  source_label text NOT NULL CHECK (length(trim(source_label)) BETWEEN 3 AND 200),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  version_attribution jsonb NOT NULL,
  case_count integer NOT NULL CHECK (case_count BETWEEN 1 AND 1000),
  pii_attested boolean NOT NULL CHECK (pii_attested),
  imported_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  imported_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  baseline_snapshot_id uuid REFERENCES tanaghom.quality_evaluation_snapshots(id) ON DELETE RESTRICT,
  shadow_snapshot_id uuid REFERENCES tanaghom.quality_evaluation_snapshots(id) ON DELETE RESTRICT,
  UNIQUE (organization_id,source_sha256),
  CHECK (period_end>period_start),
  CHECK (jsonb_typeof(version_attribution)='object'),
  CHECK (version_attribution ?& ARRAY['model','prompt','knowledge','policy','campaign'])
);

CREATE TABLE tanaghom.quality_evaluation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  dataset_id uuid NOT NULL REFERENCES tanaghom.quality_evaluation_datasets(id) ON DELETE RESTRICT,
  reference_hash text NOT NULL CHECK (reference_hash ~ '^sha256:[0-9a-f]{64}$'),
  language text NOT NULL CHECK (language IN ('en','ar')),
  customer_message text NOT NULL CHECK (length(trim(customer_message)) BETWEEN 1 AND 4000),
  human_reply text NOT NULL CHECK (length(trim(human_reply)) BETWEEN 1 AND 5000),
  response_seconds numeric(12,2) NOT NULL CHECK (response_seconds>=0 AND response_seconds<=604800),
  qualified boolean NOT NULL,
  booked boolean NOT NULL,
  won boolean NOT NULL,
  handed_off boolean NOT NULL,
  opted_out boolean NOT NULL,
  complaint boolean NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (dataset_id,reference_hash)
);
CREATE INDEX quality_evaluation_cases_dataset_idx ON tanaghom.quality_evaluation_cases(dataset_id,id);

CREATE TABLE tanaghom.quality_shadow_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  dataset_id uuid NOT NULL REFERENCES tanaghom.quality_evaluation_datasets(id) ON DELETE RESTRICT,
  case_id uuid NOT NULL REFERENCES tanaghom.quality_evaluation_cases(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  model_version text NOT NULL CHECK (length(trim(model_version)) BETWEEN 1 AND 120),
  prompt_version text NOT NULL CHECK (length(trim(prompt_version)) BETWEEN 1 AND 160),
  knowledge_version text NOT NULL CHECK (length(trim(knowledge_version)) BETWEEN 1 AND 160),
  policy_version text NOT NULL CHECK (length(trim(policy_version)) BETWEEN 1 AND 160),
  campaign_version text NOT NULL CHECK (length(trim(campaign_version)) BETWEEN 1 AND 160),
  queued_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  queued_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  claimed_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  UNIQUE (case_id,prompt_version,model_version)
);
CREATE INDEX quality_shadow_jobs_claim_idx ON tanaghom.quality_shadow_jobs(status,queued_at,id);

CREATE TABLE tanaghom.quality_shadow_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  dataset_id uuid NOT NULL REFERENCES tanaghom.quality_evaluation_datasets(id) ON DELETE RESTRICT,
  case_id uuid NOT NULL REFERENCES tanaghom.quality_evaluation_cases(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL UNIQUE REFERENCES tanaghom.quality_shadow_jobs(id) ON DELETE RESTRICT,
  contract_version text NOT NULL CHECK (contract_version='phase5g.quality-shadow-result.v1'),
  proposed_reply text,
  groundedness_pass boolean NOT NULL,
  policy_compliance_pass boolean NOT NULL,
  qualification_match boolean NOT NULL,
  unsupported_claim boolean NOT NULL,
  escalation_required boolean NOT NULL,
  predicted_qualified boolean NOT NULL,
  latency_seconds numeric(12,2) NOT NULL CHECK (latency_seconds>=0 AND latency_seconds<=3600),
  external_action_count integer NOT NULL CHECK (external_action_count=0),
  model_output jsonb NOT NULL CHECK (jsonb_typeof(model_output)='object'),
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE FUNCTION tanaghom.prevent_quality_pipeline_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'quality pipeline evidence is append-only'; END;
$$;
CREATE TRIGGER quality_metric_program_no_delete BEFORE DELETE ON tanaghom.quality_metric_program_versions
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_quality_pipeline_mutation();
CREATE TRIGGER quality_dataset_no_update_delete BEFORE UPDATE OR DELETE ON tanaghom.quality_evaluation_datasets
FOR EACH ROW WHEN (OLD.status IN ('shadow_recorded','archived')) EXECUTE FUNCTION tanaghom.prevent_quality_pipeline_mutation();
CREATE TRIGGER quality_case_no_update_delete BEFORE UPDATE OR DELETE ON tanaghom.quality_evaluation_cases
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_quality_pipeline_mutation();
CREATE TRIGGER quality_shadow_result_no_update_delete BEFORE UPDATE OR DELETE ON tanaghom.quality_shadow_results
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_quality_pipeline_mutation();

CREATE FUNCTION tanaghom.create_quality_metric_program(
  p_actor_id uuid,p_formulas jsonb,p_thresholds jsonb,p_notes text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_actor tanaghom.app_users%ROWTYPE; v_id uuid; v_version integer;
BEGIN
  SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_id AND kind='human'
    AND role='owner' AND is_active AND accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active owner required'; END IF;
  IF jsonb_typeof(p_formulas)<>'object' OR NOT (p_formulas ?& ARRAY[
    'response_time','coverage','groundedness','policy_compliance','qualification_accuracy',
    'qualification','booking','won','unsupported_claim','complaint','opt_out'])
    OR EXISTS (SELECT 1 FROM jsonb_each_text(p_formulas) item WHERE length(trim(item.value)) NOT BETWEEN 3 AND 500)
  THEN RAISE EXCEPTION 'complete metric formulas are required'; END IF;
  IF jsonb_typeof(p_thresholds)<>'object' OR NOT (p_thresholds ?& ARRAY[
    'minimum_sample_size','minimum_groundedness_percent','minimum_policy_compliance_percent',
    'minimum_qualification_accuracy_percent','maximum_unsupported_claim_percent',
    'maximum_complaint_percent','maximum_opt_out_percent'])
    OR length(trim(coalesce(p_notes,''))) NOT BETWEEN 3 AND 2000
  THEN RAISE EXCEPTION 'complete thresholds and notes are required'; END IF;
  BEGIN
    IF (p_thresholds->>'minimum_sample_size')::integer NOT BETWEEN 10 AND 10000
      OR (p_thresholds->>'minimum_groundedness_percent')::numeric NOT BETWEEN 0 AND 100
      OR (p_thresholds->>'minimum_policy_compliance_percent')::numeric NOT BETWEEN 0 AND 100
      OR (p_thresholds->>'minimum_qualification_accuracy_percent')::numeric NOT BETWEEN 0 AND 100
      OR (p_thresholds->>'maximum_unsupported_claim_percent')::numeric NOT BETWEEN 0 AND 100
      OR (p_thresholds->>'maximum_complaint_percent')::numeric NOT BETWEEN 0 AND 100
      OR (p_thresholds->>'maximum_opt_out_percent')::numeric NOT BETWEEN 0 AND 100
    THEN RAISE EXCEPTION 'metric thresholds are outside accepted ranges'; END IF;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'metric thresholds must be numeric'; END;
  SELECT coalesce(max(version_number),0)+1 INTO v_version FROM tanaghom.quality_metric_program_versions
    WHERE organization_id=v_actor.organization_id;
  INSERT INTO tanaghom.quality_metric_program_versions
    (organization_id,version_number,formulas,thresholds,notes,created_by)
  VALUES (v_actor.organization_id,v_version,p_formulas,p_thresholds,trim(p_notes),v_actor.id)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE FUNCTION tanaghom.approve_quality_metric_program(p_actor_id uuid,p_program_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_actor tanaghom.app_users%ROWTYPE; v_program tanaghom.quality_metric_program_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_id AND kind='human'
    AND role='owner' AND is_active AND accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active owner required'; END IF;
  SELECT * INTO v_program FROM tanaghom.quality_metric_program_versions
    WHERE id=p_program_id AND organization_id=v_actor.organization_id FOR UPDATE;
  IF v_program.id IS NULL OR v_program.status<>'draft' THEN RAISE EXCEPTION 'draft metric program required'; END IF;
  UPDATE tanaghom.quality_metric_program_versions SET status='superseded'
    WHERE organization_id=v_actor.organization_id AND status='approved';
  UPDATE tanaghom.quality_metric_program_versions SET status='approved',approved_by=v_actor.id,
    approved_at=statement_timestamp() WHERE id=v_program.id;
  UPDATE tanaghom.quality_rollout_policies SET
    minimum_sample_size=(v_program.thresholds->>'minimum_sample_size')::integer,
    minimum_groundedness_percent=(v_program.thresholds->>'minimum_groundedness_percent')::numeric,
    minimum_policy_compliance_percent=(v_program.thresholds->>'minimum_policy_compliance_percent')::numeric,
    minimum_qualification_accuracy_percent=(v_program.thresholds->>'minimum_qualification_accuracy_percent')::numeric,
    maximum_unsupported_claim_percent=(v_program.thresholds->>'maximum_unsupported_claim_percent')::numeric,
    maximum_complaint_percent=(v_program.thresholds->>'maximum_complaint_percent')::numeric,
    maximum_opt_out_percent=(v_program.thresholds->>'maximum_opt_out_percent')::numeric,
    changed_by=v_actor.id,changed_at=statement_timestamp()
    WHERE organization_id=v_actor.organization_id AND current_stage='baseline';
  RETURN v_program.id;
END; $$;

CREATE FUNCTION tanaghom.import_quality_baseline_dataset(
  p_actor_id uuid,p_source_label text,p_source_sha256 text,p_period_start timestamptz,
  p_period_end timestamptz,p_version_attribution jsonb,p_cases jsonb,p_pii_attested boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_actor tanaghom.app_users%ROWTYPE; v_program uuid; v_dataset uuid; v_case jsonb; v_count integer;
  v_customer text; v_reply text;
BEGIN
  SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_id AND kind='human'
    AND role IN ('owner','reviewer','operator') AND is_active AND accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active quality operator required'; END IF;
  SELECT id INTO v_program FROM tanaghom.quality_metric_program_versions
    WHERE organization_id=v_actor.organization_id AND status='approved';
  IF v_program IS NULL THEN RAISE EXCEPTION 'approved metric program required'; END IF;
  v_count:=CASE WHEN jsonb_typeof(p_cases)='array' THEN jsonb_array_length(p_cases) ELSE 0 END;
  IF NOT coalesce(p_pii_attested,false) OR v_count NOT BETWEEN 1 AND 1000
    OR p_source_sha256 !~ '^sha256:[0-9a-f]{64}$' OR p_period_end<=p_period_start
    OR jsonb_typeof(p_version_attribution)<>'object'
    OR NOT (p_version_attribution ?& ARRAY['model','prompt','knowledge','policy','campaign'])
  THEN RAISE EXCEPTION 'valid de-identified dataset metadata is required'; END IF;
  INSERT INTO tanaghom.quality_evaluation_datasets
    (organization_id,metric_program_id,source_label,source_sha256,period_start,period_end,
     version_attribution,case_count,pii_attested,imported_by)
  VALUES (v_actor.organization_id,v_program,trim(p_source_label),p_source_sha256,p_period_start,p_period_end,
    p_version_attribution,v_count,true,v_actor.id) RETURNING id INTO v_dataset;
  FOR v_case IN SELECT value FROM jsonb_array_elements(p_cases) LOOP
    IF (SELECT count(*) FROM jsonb_object_keys(v_case))<>12 OR NOT (v_case ?& ARRAY[
      'reference_hash','language','customer_message','human_reply','response_seconds','qualified',
      'booked','won','handed_off','opted_out','complaint','reviewed'])
      OR coalesce((v_case->>'reviewed')::boolean,false) IS NOT TRUE
    THEN RAISE EXCEPTION 'every baseline case must use the reviewed v1 contract'; END IF;
    v_customer:=trim(v_case->>'customer_message'); v_reply:=trim(v_case->>'human_reply');
    IF v_customer ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' OR v_reply ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
      OR v_customer ~ '(https?://|www\.)' OR v_reply ~ '(https?://|www\.)'
      OR v_customer ~ '(^|[^0-9])\+?[0-9][0-9 ()-]{6,}[0-9]([^0-9]|$)'
      OR v_reply ~ '(^|[^0-9])\+?[0-9][0-9 ()-]{6,}[0-9]([^0-9]|$)'
      OR v_customer ~* '(bearer[[:space:]]+[a-z0-9._-]{16,}|postgres(ql)?://[^[:space:]]+)'
      OR v_reply ~* '(bearer[[:space:]]+[a-z0-9._-]{16,}|postgres(ql)?://[^[:space:]]+)'
    THEN RAISE EXCEPTION 'possible personal data detected; import refused'; END IF;
    INSERT INTO tanaghom.quality_evaluation_cases
      (organization_id,dataset_id,reference_hash,language,customer_message,human_reply,response_seconds,
       qualified,booked,won,handed_off,opted_out,complaint)
    VALUES (v_actor.organization_id,v_dataset,v_case->>'reference_hash',v_case->>'language',v_customer,v_reply,
      (v_case->>'response_seconds')::numeric,(v_case->>'qualified')::boolean,(v_case->>'booked')::boolean,
      (v_case->>'won')::boolean,(v_case->>'handed_off')::boolean,(v_case->>'opted_out')::boolean,
      (v_case->>'complaint')::boolean);
  END LOOP;
  RETURN v_dataset;
END; $$;

CREATE FUNCTION tanaghom.record_quality_dataset_snapshot(
  p_actor_id uuid,p_dataset_id uuid,p_cohort text,p_limitations text,p_source_reference text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_actor tanaghom.app_users%ROWTYPE; v_dataset tanaghom.quality_evaluation_datasets%ROWTYPE;
  v_snapshot uuid; v_jobs integer; v_succeeded integer;
BEGIN
  SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_id AND kind='human'
    AND role IN ('owner','reviewer') AND is_active AND accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active quality reviewer required'; END IF;
  SELECT * INTO v_dataset FROM tanaghom.quality_evaluation_datasets
    WHERE id=p_dataset_id AND organization_id=v_actor.organization_id FOR UPDATE;
  IF v_dataset.id IS NULL OR p_cohort NOT IN ('human_baseline','ai_shadow')
    OR length(trim(coalesce(p_limitations,''))) NOT BETWEEN 3 AND 2000
    OR length(trim(coalesce(p_source_reference,''))) NOT BETWEEN 3 AND 500
  THEN RAISE EXCEPTION 'valid dataset snapshot request required'; END IF;
  IF p_cohort='human_baseline' THEN
    IF v_dataset.status<>'ready' THEN RAISE EXCEPTION 'ready baseline dataset required'; END IF;
    INSERT INTO tanaghom.quality_evaluation_snapshots
      (organization_id,cohort,period_start,period_end,sample_size,average_response_seconds,coverage_percent,
       qualification_percent,booking_percent,won_percent,handoff_percent,opt_out_percent,complaint_percent,
       version_attribution,limitations,source_reference,recorded_by)
    SELECT v_dataset.organization_id,'human_baseline',v_dataset.period_start,v_dataset.period_end,count(*),
      round(avg(response_seconds),2),round(100.0*count(*) FILTER (WHERE length(human_reply)>0)/count(*),2),
      round(100.0*count(*) FILTER (WHERE qualified)/count(*),2),round(100.0*count(*) FILTER (WHERE booked)/count(*),2),
      round(100.0*count(*) FILTER (WHERE won)/count(*),2),round(100.0*count(*) FILTER (WHERE handed_off)/count(*),2),
      round(100.0*count(*) FILTER (WHERE opted_out)/count(*),2),round(100.0*count(*) FILTER (WHERE complaint)/count(*),2),
      v_dataset.version_attribution,trim(p_limitations),trim(p_source_reference),v_actor.id
    FROM tanaghom.quality_evaluation_cases WHERE dataset_id=v_dataset.id RETURNING id INTO v_snapshot;
    UPDATE tanaghom.quality_evaluation_datasets SET status='baseline_recorded',baseline_snapshot_id=v_snapshot WHERE id=v_dataset.id;
  ELSE
    SELECT count(*),count(*) FILTER (WHERE status='succeeded') INTO v_jobs,v_succeeded
      FROM tanaghom.quality_shadow_jobs WHERE dataset_id=v_dataset.id;
    IF v_dataset.status<>'shadow_complete' OR v_jobs<>v_dataset.case_count OR v_succeeded<>v_jobs
    THEN RAISE EXCEPTION 'complete shadow dataset required'; END IF;
    INSERT INTO tanaghom.quality_evaluation_snapshots
      (organization_id,cohort,period_start,period_end,sample_size,average_response_seconds,coverage_percent,
       groundedness_percent,policy_compliance_percent,qualification_accuracy_percent,qualification_percent,
       handoff_percent,unsupported_claim_percent,version_attribution,limitations,source_reference,recorded_by)
    SELECT v_dataset.organization_id,'ai_shadow',v_dataset.period_start,v_dataset.period_end,count(*),
      round(avg(result.latency_seconds),2),round(100.0*count(*) FILTER (WHERE result.proposed_reply IS NOT NULL)/count(*),2),
      round(100.0*count(*) FILTER (WHERE result.groundedness_pass)/count(*),2),
      round(100.0*count(*) FILTER (WHERE result.policy_compliance_pass)/count(*),2),
      round(100.0*count(*) FILTER (WHERE result.qualification_match)/count(*),2),
      round(100.0*count(*) FILTER (WHERE result.predicted_qualified)/count(*),2),
      round(100.0*count(*) FILTER (WHERE result.escalation_required)/count(*),2),
      round(100.0*count(*) FILTER (WHERE result.unsupported_claim)/count(*),2),
      jsonb_build_object('model',job.model_version,'prompt',job.prompt_version,'knowledge',job.knowledge_version,
        'policy',job.policy_version,'campaign',job.campaign_version),trim(p_limitations),trim(p_source_reference),v_actor.id
    FROM tanaghom.quality_shadow_results result JOIN tanaghom.quality_shadow_jobs job ON job.id=result.job_id
    WHERE result.dataset_id=v_dataset.id
    GROUP BY job.model_version,job.prompt_version,job.knowledge_version,job.policy_version,job.campaign_version
    RETURNING id INTO v_snapshot;
    UPDATE tanaghom.quality_evaluation_datasets SET status='shadow_recorded',shadow_snapshot_id=v_snapshot WHERE id=v_dataset.id;
  END IF;
  RETURN v_snapshot;
END; $$;

CREATE FUNCTION tanaghom.queue_quality_shadow_run(p_actor_id uuid,p_dataset_id uuid,p_versions jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_actor tanaghom.app_users%ROWTYPE; v_dataset tanaghom.quality_evaluation_datasets%ROWTYPE; v_count integer;
BEGIN
  SELECT * INTO v_actor FROM tanaghom.app_users WHERE id=p_actor_id AND kind='human'
    AND role='owner' AND is_active AND accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active owner required'; END IF;
  SELECT * INTO v_dataset FROM tanaghom.quality_evaluation_datasets
    WHERE id=p_dataset_id AND organization_id=v_actor.organization_id FOR UPDATE;
  IF v_dataset.id IS NULL OR v_dataset.status<>'baseline_recorded'
    OR NOT EXISTS (SELECT 1 FROM tanaghom.quality_rollout_policies WHERE organization_id=v_actor.organization_id AND current_stage='shadow')
    OR jsonb_typeof(p_versions)<>'object' OR NOT (p_versions ?& ARRAY['model','prompt','knowledge','policy','campaign'])
  THEN RAISE EXCEPTION 'shadow run is not authorized'; END IF;
  INSERT INTO tanaghom.quality_shadow_jobs
    (organization_id,dataset_id,case_id,model_version,prompt_version,knowledge_version,policy_version,campaign_version,queued_by)
  SELECT v_actor.organization_id,v_dataset.id,quality_case.id,p_versions->>'model',p_versions->>'prompt',
    p_versions->>'knowledge',p_versions->>'policy',p_versions->>'campaign',v_actor.id
  FROM tanaghom.quality_evaluation_cases quality_case WHERE quality_case.dataset_id=v_dataset.id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  UPDATE tanaghom.quality_evaluation_datasets SET status='shadow_queued' WHERE id=v_dataset.id;
  RETURN v_count;
END; $$;

CREATE FUNCTION tanaghom.claim_quality_shadow_job()
RETURNS TABLE(job_id uuid,request_body jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_job tanaghom.quality_shadow_jobs%ROWTYPE; v_case tanaghom.quality_evaluation_cases%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM tanaghom.quality_shadow_jobs WHERE status='queued' AND attempt_count<3
    ORDER BY queued_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_job.id IS NULL THEN RETURN; END IF;
  UPDATE tanaghom.quality_shadow_jobs SET status='running',attempt_count=attempt_count+1,claimed_at=statement_timestamp()
    WHERE id=v_job.id;
  SELECT * INTO v_case FROM tanaghom.quality_evaluation_cases WHERE id=v_job.case_id;
  RETURN QUERY SELECT v_job.id,jsonb_build_object(
    'contract_version','phase5g.quality-shadow-job.v1','trust','deidentified_reviewed_customer_input',
    'language',v_case.language,'customer_message',v_case.customer_message,'human_reply',v_case.human_reply,
    'human_outcome',jsonb_build_object('qualified',v_case.qualified,'booked',v_case.booked,'won',v_case.won,
      'handed_off',v_case.handed_off,'opted_out',v_case.opted_out,'complaint',v_case.complaint),
    'versions',jsonb_build_object('model',v_job.model_version,'prompt',v_job.prompt_version,
      'knowledge',v_job.knowledge_version,'policy',v_job.policy_version,'campaign',v_job.campaign_version),
    'external_actions_allowed',false);
END; $$;

CREATE FUNCTION tanaghom.persist_quality_shadow_result(p_job_id uuid,p_result jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_job tanaghom.quality_shadow_jobs%ROWTYPE; v_case tanaghom.quality_evaluation_cases%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO v_job FROM tanaghom.quality_shadow_jobs WHERE id=p_job_id AND status='running' FOR UPDATE;
  IF v_job.id IS NULL OR jsonb_typeof(p_result)<>'object'
    OR p_result->>'contract_version'<>'phase5g.quality-shadow-result.v1'
    OR p_result->>'prompt_version'<>v_job.prompt_version OR p_result->>'model_name'<>v_job.model_version
    OR coalesce((p_result->>'external_action_count')::integer,-1)<>0
    OR jsonb_typeof(p_result->'scores')<>'object'
    OR NOT (p_result->'scores' ?& ARRAY['groundedness_pass','policy_compliance_pass','qualification_match','unsupported_claim'])
    OR jsonb_typeof(p_result->'escalation_required')<>'boolean'
    OR jsonb_typeof(p_result->'predicted_qualified')<>'boolean'
    OR length(coalesce(p_result->>'proposed_reply',''))>5000
  THEN RAISE EXCEPTION 'valid proposal-only shadow result required'; END IF;
  SELECT * INTO v_case FROM tanaghom.quality_evaluation_cases WHERE id=v_job.case_id;
  INSERT INTO tanaghom.quality_shadow_results
    (organization_id,dataset_id,case_id,job_id,contract_version,proposed_reply,groundedness_pass,
     policy_compliance_pass,qualification_match,unsupported_claim,escalation_required,predicted_qualified,
     latency_seconds,external_action_count,model_output)
  VALUES (v_job.organization_id,v_job.dataset_id,v_job.case_id,v_job.id,p_result->>'contract_version',
    nullif(trim(p_result->>'proposed_reply'),''),(p_result->'scores'->>'groundedness_pass')::boolean,
    (p_result->'scores'->>'policy_compliance_pass')::boolean,(p_result->'scores'->>'qualification_match')::boolean,
    (p_result->'scores'->>'unsupported_claim')::boolean,(p_result->>'escalation_required')::boolean,
    (p_result->>'predicted_qualified')::boolean,(p_result->>'latency_seconds')::numeric,0,p_result)
  RETURNING id INTO v_id;
  UPDATE tanaghom.quality_shadow_jobs SET status='succeeded',completed_at=statement_timestamp(),error_code=NULL,error_message=NULL
    WHERE id=v_job.id;
  IF NOT EXISTS (SELECT 1 FROM tanaghom.quality_shadow_jobs WHERE dataset_id=v_job.dataset_id AND status<>'succeeded') THEN
    UPDATE tanaghom.quality_evaluation_datasets SET status='shadow_complete' WHERE id=v_job.dataset_id;
  END IF;
  RETURN v_id;
END; $$;

CREATE FUNCTION tanaghom.record_quality_shadow_failure(p_job_id uuid,p_code text,p_message text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_status text;
BEGIN
  UPDATE tanaghom.quality_shadow_jobs SET status=CASE WHEN attempt_count<3 THEN 'queued' ELSE 'failed' END,
    error_code=left(coalesce(p_code,'shadow_error'),120),error_message=left(coalesce(p_message,'Shadow evaluation failed'),1000),
    completed_at=CASE WHEN attempt_count>=3 THEN statement_timestamp() ELSE NULL END
  WHERE id=p_job_id AND status='running' RETURNING status INTO v_status;
  IF v_status IS NULL THEN RAISE EXCEPTION 'running shadow job required'; END IF;
  RETURN v_status;
END; $$;

REVOKE ALL ON tanaghom.quality_metric_program_versions,tanaghom.quality_evaluation_datasets,
  tanaghom.quality_evaluation_cases,tanaghom.quality_shadow_jobs,tanaghom.quality_shadow_results
  FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker,tanaghom_readonly;
REVOKE ALL ON FUNCTION tanaghom.prevent_quality_pipeline_mutation(),
  tanaghom.create_quality_metric_program(uuid,jsonb,jsonb,text),tanaghom.approve_quality_metric_program(uuid,uuid),
  tanaghom.import_quality_baseline_dataset(uuid,text,text,timestamptz,timestamptz,jsonb,jsonb,boolean),
  tanaghom.record_quality_dataset_snapshot(uuid,uuid,text,text,text),
  tanaghom.queue_quality_shadow_run(uuid,uuid,jsonb),tanaghom.claim_quality_shadow_job(),
  tanaghom.persist_quality_shadow_result(uuid,jsonb),tanaghom.record_quality_shadow_failure(uuid,text,text)
  FROM PUBLIC;
GRANT SELECT ON tanaghom.quality_metric_program_versions,tanaghom.quality_evaluation_datasets,
  tanaghom.quality_evaluation_cases,tanaghom.quality_shadow_jobs,tanaghom.quality_shadow_results TO tanaghom_api,tanaghom_readonly;
GRANT EXECUTE ON FUNCTION tanaghom.create_quality_metric_program(uuid,jsonb,jsonb,text),
  tanaghom.approve_quality_metric_program(uuid,uuid),
  tanaghom.import_quality_baseline_dataset(uuid,text,text,timestamptz,timestamptz,jsonb,jsonb,boolean),
  tanaghom.record_quality_dataset_snapshot(uuid,uuid,text,text,text),
  tanaghom.queue_quality_shadow_run(uuid,uuid,jsonb) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.claim_quality_shadow_job(),tanaghom.persist_quality_shadow_result(uuid,jsonb),
  tanaghom.record_quality_shadow_failure(uuid,text,text) TO tanaghom_n8n_worker;

INSERT INTO public.schema_migrations(version) VALUES ('0021_quality_baseline_shadow_pipeline');
COMMIT;
