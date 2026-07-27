BEGIN;

DO $$
BEGIN
  IF (
    SELECT version
      FROM public.schema_migrations
     ORDER BY version DESC
     LIMIT 1
  ) <> '0031_policy_runtime_executors_certification' THEN
    RAISE EXCEPTION '0032 requires exact 0031 baseline';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM tanaghom.agent_runtime_profiles
     WHERE id='7d000000-0000-4000-8000-000000000001'
       AND code='gemma4_vllm_strict_v1'
       AND model_name='gemma4-vllm'
       AND lifecycle_state='validated'
  ) THEN
    RAISE EXCEPTION 'reviewed historical runtime profile is missing or changed';
  END IF;
END;
$$;

INSERT INTO tanaghom.agent_runtime_profiles (
  id,code,model_name,planner_contract_version,planner_schema_ref,planner_schema_hash,
  prompt_version,prompt_hash,parser_version,lifecycle_state
) VALUES (
  '7d000000-0000-4000-8000-000000000002',
  'gemma4_26b_a4b_canary_strict_v1',
  'gemma4-26b-a4b-canary',
  'phase7.agent-runtime-plan.v1',
  'packages/contracts/schemas/phase7/agent-runtime-plan.v1.schema.json',
  'cc0e96f25505bf4251fc66e317a22e1a4a7e417cf08b5827aa270268f89b5178',
  'policy-resolved-agent.v1',
  'ea65fca6fc3759a89c140a73e01057d90d25475b891e0473ee0fa721c6382485',
  'tanaghom.strict-json.v1',
  'validated'
);

INSERT INTO public.schema_migrations(version)
VALUES ('0032_gemma_served_model_profile');

COMMIT;
