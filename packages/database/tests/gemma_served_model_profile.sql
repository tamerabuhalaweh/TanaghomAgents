DO $$
BEGIN
  IF (
    SELECT version
      FROM public.schema_migrations
     ORDER BY version DESC
     LIMIT 1
  ) <> '0032_gemma_served_model_profile' THEN
    RAISE EXCEPTION '0032 is not the latest migration';
  END IF;
  IF (
    SELECT count(*)
      FROM tanaghom.agent_runtime_profiles
     WHERE (
       id='7d000000-0000-4000-8000-000000000001'
       AND code='gemma4_vllm_strict_v1'
       AND model_name='gemma4-vllm'
       AND lifecycle_state='validated'
     ) OR (
       id='7d000000-0000-4000-8000-000000000002'
       AND code='gemma4_26b_a4b_canary_strict_v1'
       AND model_name='gemma4-26b-a4b-canary'
       AND lifecycle_state='validated'
     )
  ) <> 2 THEN
    RAISE EXCEPTION 'historical and served-model runtime profiles differ from review';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE tanaghom.agent_runtime_profiles
       SET model_name='forbidden-mutation'
     WHERE id='7d000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'served-model runtime profile unexpectedly allowed mutation';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM='served-model runtime profile unexpectedly allowed mutation' THEN
        RAISE;
      END IF;
  END;
END;
$$;
