BEGIN;

DO $$
BEGIN
  IF (
    SELECT version
      FROM public.schema_migrations
     ORDER BY version DESC
     LIMIT 1
  ) <> '0032_gemma_served_model_profile' THEN
    RAISE EXCEPTION '0032 rollback requires exact 0032 baseline';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM tanaghom.agent_runtime_profiles
     WHERE id='7d000000-0000-4000-8000-000000000002'
       AND code='gemma4_26b_a4b_canary_strict_v1'
       AND model_name='gemma4-26b-a4b-canary'
       AND planner_contract_version='phase7.agent-runtime-plan.v1'
       AND planner_schema_ref='packages/contracts/schemas/phase7/agent-runtime-plan.v1.schema.json'
       AND planner_schema_hash='cc0e96f25505bf4251fc66e317a22e1a4a7e417cf08b5827aa270268f89b5178'
       AND prompt_version='policy-resolved-agent.v1'
       AND prompt_hash='ea65fca6fc3759a89c140a73e01057d90d25475b891e0473ee0fa721c6382485'
       AND parser_version='tanaghom.strict-json.v1'
       AND lifecycle_state='validated'
  ) THEN
    RAISE EXCEPTION '0032 runtime profile is missing or differs from review';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM tanaghom.organization_agent_jobs
     WHERE runtime_profile_id='7d000000-0000-4000-8000-000000000002'
  ) OR EXISTS (
    SELECT 1
      FROM tanaghom.organization_agent_runs
     WHERE runtime_profile_id='7d000000-0000-4000-8000-000000000002'
  ) OR EXISTS (
    SELECT 1
      FROM tanaghom.organization_agent_runtime_certifications
     WHERE runtime_profile_id='7d000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION '0032 rollback refused because durable runtime evidence references the served-model profile';
  END IF;
END;
$$;

ALTER TABLE tanaghom.agent_runtime_profiles
  DISABLE TRIGGER agent_runtime_profile_immutable;
DELETE FROM tanaghom.agent_runtime_profiles
WHERE id='7d000000-0000-4000-8000-000000000002';
ALTER TABLE tanaghom.agent_runtime_profiles
  ENABLE TRIGGER agent_runtime_profile_immutable;

DELETE FROM public.schema_migrations
WHERE version='0032_gemma_served_model_profile';

COMMIT;
