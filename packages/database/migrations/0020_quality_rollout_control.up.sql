BEGIN;

CREATE TABLE tanaghom.quality_rollout_policies (
  organization_id uuid PRIMARY KEY REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  current_stage text NOT NULL DEFAULT 'baseline' CHECK (current_stage IN (
    'baseline','shadow','assisted','pilot_1','pilot_5','pilot_20','pilot_50'
  )),
  minimum_sample_size integer NOT NULL DEFAULT 25 CHECK (minimum_sample_size BETWEEN 10 AND 10000),
  minimum_groundedness_percent numeric(5,2) NOT NULL DEFAULT 90 CHECK (minimum_groundedness_percent BETWEEN 0 AND 100),
  minimum_policy_compliance_percent numeric(5,2) NOT NULL DEFAULT 95 CHECK (minimum_policy_compliance_percent BETWEEN 0 AND 100),
  minimum_qualification_accuracy_percent numeric(5,2) NOT NULL DEFAULT 85 CHECK (minimum_qualification_accuracy_percent BETWEEN 0 AND 100),
  maximum_unsupported_claim_percent numeric(5,2) NOT NULL DEFAULT 1 CHECK (maximum_unsupported_claim_percent BETWEEN 0 AND 100),
  maximum_complaint_percent numeric(5,2) NOT NULL DEFAULT 1 CHECK (maximum_complaint_percent BETWEEN 0 AND 100),
  maximum_opt_out_percent numeric(5,2) NOT NULL DEFAULT 5 CHECK (maximum_opt_out_percent BETWEEN 0 AND 100),
  changed_by uuid REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

INSERT INTO tanaghom.quality_rollout_policies (organization_id)
SELECT id FROM tanaghom.organizations;

CREATE TABLE tanaghom.quality_evaluation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  cohort text NOT NULL CHECK (cohort IN ('human_baseline','ai_shadow','assisted','bounded_autonomous')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  sample_size integer NOT NULL CHECK (sample_size > 0),
  average_response_seconds numeric(12,2) CHECK (average_response_seconds IS NULL OR average_response_seconds >= 0),
  coverage_percent numeric(5,2) CHECK (coverage_percent IS NULL OR coverage_percent BETWEEN 0 AND 100),
  groundedness_percent numeric(5,2) CHECK (groundedness_percent IS NULL OR groundedness_percent BETWEEN 0 AND 100),
  policy_compliance_percent numeric(5,2) CHECK (policy_compliance_percent IS NULL OR policy_compliance_percent BETWEEN 0 AND 100),
  qualification_accuracy_percent numeric(5,2) CHECK (qualification_accuracy_percent IS NULL OR qualification_accuracy_percent BETWEEN 0 AND 100),
  qualification_percent numeric(5,2) CHECK (qualification_percent IS NULL OR qualification_percent BETWEEN 0 AND 100),
  booking_percent numeric(5,2) CHECK (booking_percent IS NULL OR booking_percent BETWEEN 0 AND 100),
  won_percent numeric(5,2) CHECK (won_percent IS NULL OR won_percent BETWEEN 0 AND 100),
  human_edit_percent numeric(5,2) CHECK (human_edit_percent IS NULL OR human_edit_percent BETWEEN 0 AND 100),
  handoff_percent numeric(5,2) CHECK (handoff_percent IS NULL OR handoff_percent BETWEEN 0 AND 100),
  opt_out_percent numeric(5,2) CHECK (opt_out_percent IS NULL OR opt_out_percent BETWEEN 0 AND 100),
  complaint_percent numeric(5,2) CHECK (complaint_percent IS NULL OR complaint_percent BETWEEN 0 AND 100),
  unsupported_claim_percent numeric(5,2) CHECK (unsupported_claim_percent IS NULL OR unsupported_claim_percent BETWEEN 0 AND 100),
  version_attribution jsonb NOT NULL,
  limitations text NOT NULL CHECK (length(trim(limitations)) BETWEEN 3 AND 2000),
  source_reference text NOT NULL CHECK (length(trim(source_reference)) BETWEEN 3 AND 500),
  recorded_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (period_end > period_start),
  CHECK (jsonb_typeof(version_attribution)='object'),
  CHECK (version_attribution ?& ARRAY['model','prompt','knowledge','policy','campaign'])
);

CREATE INDEX quality_evaluation_snapshots_org_cohort_idx
  ON tanaghom.quality_evaluation_snapshots(organization_id,cohort,period_end DESC);

CREATE TABLE tanaghom.quality_rollout_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('promote','hold','rollback')),
  from_stage text NOT NULL CHECK (from_stage IN (
    'baseline','shadow','assisted','pilot_1','pilot_5','pilot_20','pilot_50'
  )),
  to_stage text NOT NULL CHECK (to_stage IN (
    'baseline','shadow','assisted','pilot_1','pilot_5','pilot_20','pilot_50'
  )),
  rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 3 AND 1000),
  evidence_snapshot_ids uuid[] NOT NULL DEFAULT '{}',
  decided_by uuid NOT NULL REFERENCES tanaghom.app_users(id) ON DELETE RESTRICT,
  decided_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id,command_id)
);

CREATE FUNCTION tanaghom.prevent_quality_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'quality evaluation evidence is append-only'; END;
$$;

CREATE TRIGGER quality_evaluation_snapshots_no_update
BEFORE UPDATE OR DELETE ON tanaghom.quality_evaluation_snapshots
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_quality_evidence_mutation();

CREATE TRIGGER quality_rollout_decisions_no_update
BEFORE UPDATE OR DELETE ON tanaghom.quality_rollout_decisions
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_quality_evidence_mutation();

CREATE FUNCTION tanaghom.set_quality_rollout_stage(
  p_actor_id uuid,
  p_target_stage text,
  p_rationale text,
  p_command_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
DECLARE
  v_actor tanaghom.app_users%ROWTYPE;
  v_policy tanaghom.quality_rollout_policies%ROWTYPE;
  v_required_cohort text;
  v_snapshot tanaghom.quality_evaluation_snapshots%ROWTYPE;
  v_next_stage text;
  v_decision_id uuid;
BEGIN
  IF p_command_id IS NULL OR length(trim(coalesce(p_rationale,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'quality rollout rationale and command are required';
  END IF;
  IF p_target_stage NOT IN ('baseline','shadow','assisted','pilot_1','pilot_5','pilot_20','pilot_50') THEN
    RAISE EXCEPTION 'invalid quality rollout stage';
  END IF;

  SELECT * INTO v_actor FROM tanaghom.app_users
  WHERE id=p_actor_id AND kind='human' AND role='owner' AND is_active AND accepted_at IS NOT NULL;
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'active owner required'; END IF;

  SELECT * INTO v_policy FROM tanaghom.quality_rollout_policies
  WHERE organization_id=v_actor.organization_id FOR UPDATE;
  IF v_policy.organization_id IS NULL THEN RAISE EXCEPTION 'quality rollout policy missing'; END IF;
  IF p_target_stage=v_policy.current_stage THEN RETURN NULL; END IF;

  IF p_target_stage='baseline' THEN
    INSERT INTO tanaghom.quality_rollout_decisions
      (organization_id,command_id,decision,from_stage,to_stage,rationale,decided_by)
    VALUES (v_actor.organization_id,p_command_id,'rollback',v_policy.current_stage,'baseline',trim(p_rationale),v_actor.id)
    RETURNING id INTO v_decision_id;
    UPDATE tanaghom.quality_rollout_policies SET current_stage='baseline',changed_by=v_actor.id,
      changed_at=statement_timestamp() WHERE organization_id=v_actor.organization_id;
    RETURN v_decision_id;
  END IF;

  v_next_stage := CASE v_policy.current_stage
    WHEN 'baseline' THEN 'shadow' WHEN 'shadow' THEN 'assisted'
    WHEN 'assisted' THEN 'pilot_1' WHEN 'pilot_1' THEN 'pilot_5'
    WHEN 'pilot_5' THEN 'pilot_20' WHEN 'pilot_20' THEN 'pilot_50'
    ELSE NULL END;
  IF p_target_stage IS DISTINCT FROM v_next_stage THEN
    RAISE EXCEPTION 'quality rollout stages must be promoted sequentially';
  END IF;

  v_required_cohort := CASE v_policy.current_stage
    WHEN 'baseline' THEN 'human_baseline'
    WHEN 'shadow' THEN 'ai_shadow'
    WHEN 'assisted' THEN 'assisted'
    ELSE 'bounded_autonomous' END;
  SELECT * INTO v_snapshot FROM tanaghom.quality_evaluation_snapshots
  WHERE organization_id=v_actor.organization_id AND cohort=v_required_cohort
    AND (v_policy.current_stage='baseline' OR recorded_at>v_policy.changed_at)
  ORDER BY period_end DESC,id DESC LIMIT 1;

  IF v_snapshot.id IS NULL OR v_snapshot.sample_size<v_policy.minimum_sample_size THEN
    RAISE EXCEPTION 'quality rollout sample gate is not satisfied';
  END IF;
  IF v_policy.current_stage<>'baseline' AND (
    coalesce(v_snapshot.groundedness_percent,-1)<v_policy.minimum_groundedness_percent OR
    coalesce(v_snapshot.policy_compliance_percent,-1)<v_policy.minimum_policy_compliance_percent OR
    coalesce(v_snapshot.qualification_accuracy_percent,-1)<v_policy.minimum_qualification_accuracy_percent OR
    coalesce(v_snapshot.unsupported_claim_percent,101)>v_policy.maximum_unsupported_claim_percent OR
    coalesce(v_snapshot.complaint_percent,101)>v_policy.maximum_complaint_percent OR
    coalesce(v_snapshot.opt_out_percent,101)>v_policy.maximum_opt_out_percent
  ) THEN RAISE EXCEPTION 'quality rollout threshold gate is not satisfied'; END IF;

  INSERT INTO tanaghom.quality_rollout_decisions
    (organization_id,command_id,decision,from_stage,to_stage,rationale,evidence_snapshot_ids,decided_by)
  VALUES (v_actor.organization_id,p_command_id,'promote',v_policy.current_stage,p_target_stage,
    trim(p_rationale),ARRAY[v_snapshot.id],v_actor.id)
  RETURNING id INTO v_decision_id;
  UPDATE tanaghom.quality_rollout_policies SET current_stage=p_target_stage,changed_by=v_actor.id,
    changed_at=statement_timestamp() WHERE organization_id=v_actor.organization_id;
  RETURN v_decision_id;
END;
$$;

REVOKE ALL ON tanaghom.quality_rollout_policies,tanaghom.quality_evaluation_snapshots,
  tanaghom.quality_rollout_decisions FROM PUBLIC,tanaghom_n8n_worker,tanaghom_conversation_worker,tanaghom_readonly;
REVOKE ALL ON FUNCTION tanaghom.prevent_quality_evidence_mutation(),
  tanaghom.set_quality_rollout_stage(uuid,text,text,uuid) FROM PUBLIC;

GRANT SELECT ON tanaghom.quality_rollout_policies,tanaghom.quality_evaluation_snapshots,
  tanaghom.quality_rollout_decisions TO tanaghom_api,tanaghom_readonly;
GRANT EXECUTE ON FUNCTION tanaghom.set_quality_rollout_stage(uuid,text,text,uuid) TO tanaghom_api;

INSERT INTO public.schema_migrations(version)
VALUES ('0020_quality_rollout_control');

COMMIT;
