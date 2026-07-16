BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tanaghom.quality_evaluation_snapshots)
     OR EXISTS (SELECT 1 FROM tanaghom.quality_rollout_decisions)
     OR EXISTS (SELECT 1 FROM tanaghom.quality_rollout_policies WHERE current_stage<>'baseline') THEN
    RAISE EXCEPTION 'preserve quality evaluation evidence before rolling back 0020';
  END IF;
END;
$$;

DROP FUNCTION tanaghom.set_quality_rollout_stage(uuid,text,text,uuid);
DROP TRIGGER quality_rollout_decisions_no_update ON tanaghom.quality_rollout_decisions;
DROP TRIGGER quality_evaluation_snapshots_no_update ON tanaghom.quality_evaluation_snapshots;
DROP FUNCTION tanaghom.prevent_quality_evidence_mutation();
DROP TABLE tanaghom.quality_rollout_decisions;
DROP TABLE tanaghom.quality_evaluation_snapshots;
DROP TABLE tanaghom.quality_rollout_policies;

DELETE FROM public.schema_migrations WHERE version='0020_quality_rollout_control';

COMMIT;
