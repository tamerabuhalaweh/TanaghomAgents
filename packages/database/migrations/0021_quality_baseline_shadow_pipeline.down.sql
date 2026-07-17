BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM tanaghom.quality_evaluation_datasets)
    OR EXISTS (SELECT 1 FROM tanaghom.quality_metric_program_versions)
  THEN RAISE EXCEPTION 'preserve quality baseline and shadow evidence before rolling back 0021'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION tanaghom.record_quality_shadow_failure(uuid,text,text) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.persist_quality_shadow_result(uuid,jsonb) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.claim_quality_shadow_job() FROM tanaghom_n8n_worker;
DROP FUNCTION tanaghom.record_quality_shadow_failure(uuid,text,text);
DROP FUNCTION tanaghom.persist_quality_shadow_result(uuid,jsonb);
DROP FUNCTION tanaghom.claim_quality_shadow_job();
DROP FUNCTION tanaghom.queue_quality_shadow_run(uuid,uuid,jsonb);
DROP FUNCTION tanaghom.record_quality_dataset_snapshot(uuid,uuid,text,text,text);
DROP FUNCTION tanaghom.import_quality_baseline_dataset(uuid,text,text,timestamptz,timestamptz,jsonb,jsonb,boolean);
DROP FUNCTION tanaghom.approve_quality_metric_program(uuid,uuid);
DROP FUNCTION tanaghom.create_quality_metric_program(uuid,jsonb,jsonb,text);
DROP TRIGGER quality_shadow_result_no_update_delete ON tanaghom.quality_shadow_results;
DROP TRIGGER quality_case_no_update_delete ON tanaghom.quality_evaluation_cases;
DROP TRIGGER quality_dataset_no_update_delete ON tanaghom.quality_evaluation_datasets;
DROP TRIGGER quality_metric_program_no_delete ON tanaghom.quality_metric_program_versions;
DROP FUNCTION tanaghom.prevent_quality_pipeline_mutation();
DROP TABLE tanaghom.quality_shadow_results;
DROP TABLE tanaghom.quality_shadow_jobs;
DROP TABLE tanaghom.quality_evaluation_cases;
DROP TABLE tanaghom.quality_evaluation_datasets;
DROP TABLE tanaghom.quality_metric_program_versions;
DELETE FROM public.schema_migrations WHERE version='0021_quality_baseline_shadow_pipeline';
COMMIT;
