\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regprocedure(
    'tanaghom.campaign_strategy_cadence_is_valid(jsonb,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'strategy cadence validator is missing';
  END IF;

  IF NOT tanaghom.campaign_strategy_cadence_is_valid(
    '["instagram","linkedin"]'::jsonb,
    '{"instagram":{"posts_per_week":3},"linkedin":{"posts_per_week":2}}'::jsonb
  ) THEN
    RAISE EXCEPTION 'valid exact channel/cadence equality was rejected';
  END IF;

  IF tanaghom.campaign_strategy_cadence_is_valid(
    '["instagram","linkedin"]'::jsonb,
    '{"instagram":{"posts_per_week":3},"whatsapp_status":{"posts_per_week":2}}'::jsonb
  ) THEN
    RAISE EXCEPTION 'mismatched channel/cadence keys were accepted';
  END IF;

  IF tanaghom.campaign_strategy_cadence_is_valid(
    '["instagram","instagram"]'::jsonb,
    '{"instagram":{"posts_per_week":3}}'::jsonb
  ) THEN
    RAISE EXCEPTION 'duplicate channels were accepted';
  END IF;

  IF tanaghom.campaign_strategy_cadence_is_valid(
    '["instagram"]'::jsonb,
    '{"instagram":{"posts_per_week":0}}'::jsonb
  ) OR tanaghom.campaign_strategy_cadence_is_valid(
    '["instagram"]'::jsonb,
    '{"instagram":{"posts_per_week":2,"extra":true}}'::jsonb
  ) THEN
    RAISE EXCEPTION 'invalid cadence value was accepted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid='tanaghom.campaign_strategies'::regclass
      AND conname='campaign_strategies_cadence_integrity_check'
      AND contype='c'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'validated strategy cadence constraint is missing';
  END IF;

  IF has_function_privilege(
    'tanaghom_n8n_worker',
    'tanaghom.campaign_strategy_cadence_is_valid(jsonb,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'n8n received direct cadence-validator execution';
  END IF;
END
$$;

SELECT 'PASS: strategist channel/cadence equality is enforced at the database boundary.' AS result;
