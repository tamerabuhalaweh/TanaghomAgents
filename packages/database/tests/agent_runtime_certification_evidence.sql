\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (
    SELECT version FROM public.schema_migrations
    ORDER BY version DESC LIMIT 1
  ) NOT IN ('0033_agent_runtime_certification_evidence','0034_agency_pilot_integration') THEN
    RAISE EXCEPTION '0033 evidence requires a reviewed baseline';
  END IF;
  IF position(
    'invocation_summary.external_action_count'
    IN pg_get_functiondef(
      'tanaghom.build_agent_runtime_certification_evidence(uuid,uuid,uuid)'::regprocedure
    )
  ) = 0 OR position(
    'count(scenario.id)'
    IN pg_get_functiondef(
      'tanaghom.build_agent_runtime_certification_evidence(uuid,uuid,uuid)'::regprocedure
    )
  ) = 0 THEN
    RAISE EXCEPTION '0033 canonical scenario aggregation differs from review';
  END IF;
  IF has_function_privilege(
    'public',
    'tanaghom.build_agent_runtime_certification_evidence(uuid,uuid,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'tanaghom_agent_runtime',
    'tanaghom.build_agent_runtime_certification_evidence(uuid,uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION '0033 function privileges are not least-privilege';
  END IF;
END;
$$;
