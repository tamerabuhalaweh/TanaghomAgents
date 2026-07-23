BEGIN;

ALTER TABLE tanaghom.campaign_strategies
  DROP CONSTRAINT campaign_strategies_cadence_integrity_check;

DROP FUNCTION tanaghom.campaign_strategy_cadence_is_valid(jsonb,jsonb);

DELETE FROM public.schema_migrations
WHERE version='0028_strategy_cadence_integrity';

COMMIT;
