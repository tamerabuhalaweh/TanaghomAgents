BEGIN;

CREATE FUNCTION tanaghom.campaign_strategy_cadence_is_valid(
  p_channels jsonb,
  p_posting_cadence jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_channel_count integer;
  v_distinct_channel_count integer;
  v_cadence_count integer;
  v_value_key_count integer;
  v_channel text;
  v_value jsonb;
BEGIN
  IF jsonb_typeof(p_channels) <> 'array'
     OR jsonb_typeof(p_posting_cadence) <> 'object'
     OR jsonb_array_length(p_channels) < 1 THEN
    RETURN false;
  END IF;

  SELECT count(*), count(DISTINCT channel)
  INTO v_channel_count, v_distinct_channel_count
  FROM jsonb_array_elements_text(p_channels) AS selected(channel);

  SELECT count(*)
  INTO v_cadence_count
  FROM jsonb_object_keys(p_posting_cadence);

  IF v_channel_count <> v_distinct_channel_count
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(p_channels) AS selected(channel)
       WHERE channel NOT IN (
         'instagram','tiktok','facebook','linkedin','youtube','email',
         'whatsapp_status'
       )
     )
     OR v_cadence_count <> v_channel_count
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(p_channels) AS selected(channel)
       WHERE NOT (p_posting_cadence ? channel)
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_each(p_posting_cadence) AS cadence(channel, value)
       WHERE channel NOT IN (
         SELECT selected.channel
         FROM jsonb_array_elements_text(p_channels) AS selected(channel)
       )
     ) THEN
    RETURN false;
  END IF;

  FOR v_channel, v_value IN
    SELECT key, value
    FROM jsonb_each(p_posting_cadence)
  LOOP
    IF jsonb_typeof(v_value) <> 'object' THEN
      RETURN false;
    END IF;

    SELECT count(*)
    INTO v_value_key_count
    FROM jsonb_object_keys(v_value);

    IF v_value_key_count <> 1
       OR NOT (v_value ? 'posts_per_week')
       OR jsonb_typeof(v_value->'posts_per_week') <> 'number' THEN
      RETURN false;
    END IF;

    IF (v_value->>'posts_per_week')::numeric
         <> trunc((v_value->>'posts_per_week')::numeric)
       OR (v_value->>'posts_per_week')::numeric NOT BETWEEN 1 AND 14 THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

ALTER TABLE tanaghom.campaign_strategies
  ADD CONSTRAINT campaign_strategies_cadence_integrity_check
  CHECK (tanaghom.campaign_strategy_cadence_is_valid(channels, posting_cadence));

REVOKE ALL ON FUNCTION tanaghom.campaign_strategy_cadence_is_valid(jsonb,jsonb)
  FROM PUBLIC, tanaghom_api, tanaghom_n8n_worker, tanaghom_readonly,
       tanaghom_conversation_worker;

INSERT INTO public.schema_migrations(version)
VALUES ('0028_strategy_cadence_integrity');

COMMIT;
