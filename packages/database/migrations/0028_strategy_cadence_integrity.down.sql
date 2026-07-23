BEGIN;

ALTER TABLE tanaghom.campaign_strategies
  DROP CONSTRAINT campaign_strategies_cadence_integrity_check;

UPDATE tanaghom.campaign_strategies strategy
SET posting_cadence=backup.original_posting_cadence
FROM tanaghom.strategy_cadence_0028_legacy_backup backup
WHERE backup.strategy_id=strategy.id;

DROP TABLE tanaghom.strategy_cadence_0028_legacy_backup;

DROP FUNCTION tanaghom.campaign_strategy_cadence_is_valid(jsonb,jsonb);

DELETE FROM public.schema_migrations
WHERE version='0028_strategy_cadence_integrity';

COMMIT;
