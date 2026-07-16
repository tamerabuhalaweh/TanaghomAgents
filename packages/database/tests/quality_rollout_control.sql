DO $$
DECLARE
  v_policy tanaghom.quality_rollout_policies%ROWTYPE;
BEGIN
  SELECT * INTO v_policy FROM tanaghom.quality_rollout_policies
  WHERE organization_id='10000000-0000-4000-8000-000000000001';
  IF v_policy.current_stage<>'baseline' OR v_policy.minimum_sample_size<>25 THEN
    RAISE EXCEPTION 'quality rollout did not start at the safe baseline gate';
  END IF;
  IF has_table_privilege('tanaghom_n8n_worker','tanaghom.quality_rollout_policies','INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_conversation_worker','tanaghom.quality_evaluation_snapshots','INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_readonly','tanaghom.quality_rollout_decisions','INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_api','tanaghom.quality_rollout_policies','UPDATE') THEN
    RAISE EXCEPTION 'quality rollout least-privilege boundary is incorrect';
  END IF;
  BEGIN
    PERFORM tanaghom.set_quality_rollout_stage(
      '00000000-0000-4000-8000-000000000001','shadow','Start comparison',
      'a0000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'promotion succeeded without baseline evidence';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='promotion succeeded without baseline evidence' THEN RAISE; END IF;
  END;
END;
$$;

INSERT INTO tanaghom.quality_evaluation_snapshots (
  id,organization_id,cohort,period_start,period_end,sample_size,
  average_response_seconds,coverage_percent,qualification_percent,booking_percent,won_percent,
  version_attribution,limitations,source_reference,recorded_by
) VALUES (
  'a1000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  'human_baseline',statement_timestamp()-interval '7 days',statement_timestamp(),25,
  780,62,18,7,2,
  '{"model":"human","prompt":"customer-script-v1","knowledge":"customer-catalog-v1","policy":"manual-v1","campaign":"staging-campaign-v1"}',
  'Disposable baseline fixture; it is not a production conversion claim.',
  'quality-rollout-control.sql','00000000-0000-4000-8000-000000000001'
);

SELECT tanaghom.set_quality_rollout_stage(
  '00000000-0000-4000-8000-000000000001','shadow','Baseline recorded; authorize proposal-only comparison',
  'a0000000-0000-4000-8000-000000000002'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.quality_rollout_policies
    WHERE organization_id='10000000-0000-4000-8000-000000000001' AND current_stage='shadow'
  ) OR NOT EXISTS (
    SELECT 1 FROM tanaghom.quality_rollout_decisions
    WHERE command_id='a0000000-0000-4000-8000-000000000002' AND decision='promote'
      AND evidence_snapshot_ids=ARRAY['a1000000-0000-4000-8000-000000000001'::uuid]
  ) THEN RAISE EXCEPTION 'evidence-backed shadow promotion was not recorded'; END IF;

  BEGIN
    UPDATE tanaghom.quality_evaluation_snapshots SET sample_size=26
    WHERE id='a1000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'append-only snapshot accepted mutation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='append-only snapshot accepted mutation' THEN RAISE; END IF;
  END;
END;
$$;

SELECT tanaghom.set_quality_rollout_stage(
  '00000000-0000-4000-8000-000000000001','baseline','Return to manual baseline gate',
  'a0000000-0000-4000-8000-000000000003'
);

TRUNCATE tanaghom.quality_rollout_decisions,tanaghom.quality_evaluation_snapshots CASCADE;

SELECT 'PASS: quality rollout requires sequential, owner-approved, append-only evidence.' AS result;
