DO $$
DECLARE
  v_actor uuid := '00000000-0000-4000-8000-000000000001';
  v_program uuid; v_dataset uuid; v_snapshot uuid; v_claim record; v_count integer; item integer;
  v_cases jsonb;
  v_formulas jsonb := '{
    "response_time":"Average seconds from inbound message to first human reply",
    "coverage":"Percent of reviewed cases with a reply",
    "groundedness":"Percent of proposals supported by approved knowledge",
    "policy_compliance":"Percent of proposals passing policy review",
    "qualification_accuracy":"Percent matching the reviewed human qualification label",
    "qualification":"Percent marked qualified",
    "booking":"Percent with a booked appointment",
    "won":"Percent marked won in the measurement period",
    "unsupported_claim":"Percent containing an unsupported factual claim",
    "complaint":"Percent marked as a complaint",
    "opt_out":"Percent marked opted out"
  }'::jsonb;
  v_thresholds jsonb := '{
    "minimum_sample_size":10,
    "minimum_groundedness_percent":90,
    "minimum_policy_compliance_percent":95,
    "minimum_qualification_accuracy_percent":85,
    "maximum_unsupported_claim_percent":1,
    "maximum_complaint_percent":1,
    "maximum_opt_out_percent":5
  }'::jsonb;
BEGIN
  v_program:=tanaghom.create_quality_metric_program(v_actor,v_formulas,v_thresholds,
    'Disposable formulas; customer production approval is still required.');
  PERFORM tanaghom.approve_quality_metric_program(v_actor,v_program);
  IF NOT EXISTS (SELECT 1 FROM tanaghom.quality_metric_program_versions WHERE id=v_program AND status='approved')
    OR EXISTS (SELECT 1 FROM tanaghom.quality_rollout_policies WHERE minimum_sample_size<>10)
  THEN RAISE EXCEPTION 'metric program approval did not update the rollout gate'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'reference_hash','sha256:'||lpad(to_hex(series.case_number),64,'0'),'language',CASE WHEN series.case_number%2=0 THEN 'ar' ELSE 'en' END,
    'customer_message',CASE WHEN series.case_number%2=0 THEN 'Arabic sample request' ELSE 'Please explain the available options' END,
    'human_reply',CASE WHEN series.case_number%2=0 THEN 'Arabic sample response' ELSE 'I will explain the approved options' END,
    'response_seconds',60+series.case_number,'qualified',series.case_number<=5,'booked',series.case_number<=2,'won',series.case_number=1,
    'handed_off',series.case_number=10,'opted_out',false,'complaint',false,'reviewed',true
  )) INTO v_cases FROM generate_series(1,10) AS series(case_number);

  BEGIN
    PERFORM tanaghom.import_quality_baseline_dataset(v_actor,'PII refusal fixture',
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      statement_timestamp()-interval '1 day',statement_timestamp(),
      '{"model":"human","prompt":"script-v1","knowledge":"catalog-v1","policy":"manual-v1","campaign":"test-v1"}',
      jsonb_build_array(jsonb_build_object('reference_hash','sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        'language','en','customer_message','Email me at private@example.test','human_reply','No',
        'response_seconds',1,'qualified',false,'booked',false,'won',false,'handed_off',true,
        'opted_out',false,'complaint',false,'reviewed',true)),true);
    RAISE EXCEPTION 'PII import unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='PII import unexpectedly succeeded' THEN RAISE; END IF; END;

  v_dataset:=tanaghom.import_quality_baseline_dataset(v_actor,'Disposable reviewed baseline',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    statement_timestamp()-interval '7 days',statement_timestamp(),
    '{"model":"human","prompt":"script-v1","knowledge":"catalog-v1","policy":"manual-v1","campaign":"test-v1"}',v_cases,true);
  v_snapshot:=tanaghom.record_quality_dataset_snapshot(v_actor,v_dataset,'human_baseline',
    'Disposable baseline; not a production conversion claim.','quality_baseline_shadow_pipeline.sql');
  IF NOT EXISTS (SELECT 1 FROM tanaghom.quality_evaluation_snapshots WHERE id=v_snapshot AND sample_size=10)
  THEN RAISE EXCEPTION 'baseline snapshot was not recorded'; END IF;
  PERFORM tanaghom.set_quality_rollout_stage(v_actor,'shadow','Authorize disposable proposal-only comparison',gen_random_uuid());
  v_count:=tanaghom.queue_quality_shadow_run(v_actor,v_dataset,
    '{"model":"gemma-test","prompt":"quality-shadow/v1","knowledge":"catalog-v1","policy":"manual-v1","campaign":"test-v1"}');
  IF v_count<>10 THEN RAISE EXCEPTION 'shadow jobs were not queued for every case'; END IF;
  FOR item IN 1..10 LOOP
    SELECT * INTO v_claim FROM tanaghom.claim_quality_shadow_job();
    IF v_claim.job_id IS NULL OR v_claim.request_body->>'external_actions_allowed'<>'false'
    THEN RAISE EXCEPTION 'proposal-only shadow claim failed'; END IF;
    PERFORM tanaghom.persist_quality_shadow_result(v_claim.job_id,jsonb_build_object(
      'contract_version','phase5g.quality-shadow-result.v1','prompt_version','quality-shadow/v1',
      'model_name','gemma-test','proposed_reply','Reviewed proposal only','scores',jsonb_build_object(
        'groundedness_pass',true,'policy_compliance_pass',true,'qualification_match',true,'unsupported_claim',false),
      'escalation_required',false,'predicted_qualified',item<=5,'latency_seconds',1.25,'external_action_count',0));
  END LOOP;
  v_snapshot:=tanaghom.record_quality_dataset_snapshot(v_actor,v_dataset,'ai_shadow',
    'Disposable shadow results from a simulated model; no live quality claim.','quality_baseline_shadow_pipeline.sql');
  IF NOT EXISTS (SELECT 1 FROM tanaghom.quality_evaluation_snapshots WHERE id=v_snapshot AND cohort='ai_shadow'
    AND groundedness_percent=100 AND policy_compliance_percent=100 AND unsupported_claim_percent=0)
  THEN RAISE EXCEPTION 'shadow snapshot was not aggregated correctly'; END IF;
  IF has_table_privilege('tanaghom_n8n_worker','tanaghom.quality_shadow_jobs','SELECT,INSERT,UPDATE,DELETE')
    OR NOT has_function_privilege('tanaghom_n8n_worker','tanaghom.claim_quality_shadow_job()','EXECUTE')
    OR has_function_privilege('tanaghom_conversation_worker','tanaghom.claim_quality_shadow_job()','EXECUTE')
  THEN RAISE EXCEPTION 'quality shadow least-privilege boundary is incorrect'; END IF;
END $$;

TRUNCATE tanaghom.quality_rollout_decisions,tanaghom.quality_evaluation_snapshots,
  tanaghom.quality_shadow_results,tanaghom.quality_shadow_jobs,tanaghom.quality_evaluation_cases,
  tanaghom.quality_evaluation_datasets,tanaghom.quality_metric_program_versions CASCADE;
UPDATE tanaghom.quality_rollout_policies SET current_stage='baseline',minimum_sample_size=25,
  minimum_groundedness_percent=90,minimum_policy_compliance_percent=95,
  minimum_qualification_accuracy_percent=85,maximum_unsupported_claim_percent=1,
  maximum_complaint_percent=1,maximum_opt_out_percent=5,changed_by=NULL,changed_at=statement_timestamp();

SELECT 'PASS: approved metrics, de-identified baseline, proposal-only shadow, evidence aggregation, and least privilege verified.' AS result;
