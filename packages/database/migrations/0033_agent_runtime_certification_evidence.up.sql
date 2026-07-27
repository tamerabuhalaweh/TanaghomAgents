BEGIN;

DO $$
BEGIN
  IF (
    SELECT version FROM public.schema_migrations
    ORDER BY version DESC LIMIT 1
  ) <> '0032_gemma_served_model_profile' THEN
    RAISE EXCEPTION '0033 requires exact 0032 baseline';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION tanaghom.build_agent_runtime_certification_evidence(
  p_organization_id uuid,p_agent_version_id uuid,p_runtime_profile_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $$
  SELECT jsonb_build_object(
    'contract_version','phase7.agent-runtime-certification.v1',
    'organization_id',version.organization_id,
    'agent_version_id',version.id,
    'agent_content_hash',version.content_hash,
    'runtime_profile_id',profile.id,
    'runtime_profile_code',profile.code,
    'languages',to_jsonb(version.languages),
    'required_scenarios_per_language',7,
    'scenario_count',count(scenario.id),
    'external_action_count',coalesce(sum(
      invocation_summary.external_action_count
    ),0),
    'scenarios',jsonb_agg(
      jsonb_build_object(
        'scenario_id',scenario.id,'code',scenario.code,'language',scenario.language,
        'scenario_kind',scenario.scenario_kind,'job_id',job.id,'run_id',run.id,
        'request_fingerprint',job.request_fingerprint,'job_status',job.status,
        'scenario_result',job.scenario_result,'run_status',run.status,
        'invocation_count',invocation_summary.invocation_count
      ) ORDER BY scenario.language,scenario.scenario_kind,scenario.code
    )
  )
  FROM tanaghom.organization_agent_versions version
  JOIN tanaghom.agent_runtime_profiles profile ON profile.id=p_runtime_profile_id
  JOIN tanaghom.organization_agent_test_scenarios scenario
    ON scenario.agent_version_id=version.id
   AND scenario.organization_id=version.organization_id
  JOIN LATERAL (
    SELECT candidate.*
      FROM tanaghom.organization_agent_jobs candidate
     WHERE candidate.scenario_id=scenario.id
       AND candidate.agent_version_id=version.id
       AND candidate.organization_id=version.organization_id
       AND candidate.runtime_profile_id=profile.id
       AND candidate.status='succeeded'
       AND candidate.scenario_result='passed'
     ORDER BY candidate.finished_at DESC,candidate.id
     LIMIT 1
  ) job ON true
  JOIN LATERAL (
    SELECT candidate.*
      FROM tanaghom.organization_agent_runs candidate
     WHERE candidate.job_id=job.id AND candidate.status='succeeded'
     ORDER BY candidate.finished_at DESC,candidate.id
     LIMIT 1
  ) run ON true
  CROSS JOIN LATERAL (
    SELECT
      count(*)::integer AS invocation_count,
      count(*) FILTER (
        WHERE invocation.provider_reference IS NOT NULL
           OR invocation.provider_dispatch_id IS NOT NULL
      )::integer AS external_action_count
    FROM tanaghom.organization_agent_invocations invocation
    WHERE invocation.run_id=run.id
  ) invocation_summary
  WHERE version.id=p_agent_version_id
    AND version.organization_id=p_organization_id
    AND profile.lifecycle_state='validated'
  GROUP BY version.organization_id,version.id,version.content_hash,version.languages,
           profile.id,profile.code;
$$;

REVOKE ALL ON FUNCTION tanaghom.build_agent_runtime_certification_evidence(uuid,uuid,uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.build_agent_runtime_certification_evidence(uuid,uuid,uuid)
  TO tanaghom_agent_runtime;

INSERT INTO public.schema_migrations(version)
VALUES ('0033_agent_runtime_certification_evidence');

COMMIT;
