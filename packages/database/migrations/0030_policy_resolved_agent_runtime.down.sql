BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tanaghom.organization_agent_runtime_certifications)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_agent_jobs)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_agent_runs)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_agent_invocations)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_agent_invocation_approvals)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_agent_dependency_blocks)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_agent_runtime_events)
  THEN
    RAISE EXCEPTION 'cannot roll back 0030 while durable agent runtime evidence exists';
  END IF;
END;
$$;

DROP FUNCTION tanaghom.promote_organization_agent_to_simulation(uuid,uuid,uuid,uuid);
DROP FUNCTION tanaghom.record_agent_runtime_certification(uuid,uuid,uuid,text,jsonb,text);
DROP FUNCTION tanaghom.reconcile_agent_dependency_block(uuid,uuid,uuid,text);
DROP FUNCTION tanaghom.fail_agent_runtime_run(uuid,text,text,boolean);
DROP FUNCTION tanaghom.finalize_agent_runtime_run(uuid,text,jsonb,text);
DROP FUNCTION tanaghom.complete_agent_simulation_invocation(uuid,text,jsonb,integer,integer);
DROP FUNCTION tanaghom.complete_agent_action_invocation(uuid,text,jsonb,integer,integer,numeric,text);
DROP FUNCTION tanaghom.complete_agent_proposal_invocation(uuid,text,jsonb,integer,integer,numeric,text);
DROP FUNCTION tanaghom.complete_agent_read_invocation(uuid,text,jsonb,integer,integer,numeric,text);
DROP FUNCTION tanaghom.complete_agent_skill_invocation_internal(uuid,text,text,jsonb,integer,integer,numeric,text);
DROP FUNCTION tanaghom.claim_agent_simulation_invocation(text);
DROP FUNCTION tanaghom.agent_runtime_result_is_valid(uuid,text,jsonb,integer,integer,numeric,text);
DROP FUNCTION tanaghom.claim_agent_action_invocation(text);
DROP FUNCTION tanaghom.claim_agent_proposal_invocation(text);
DROP FUNCTION tanaghom.claim_agent_read_invocation(text);
DROP FUNCTION tanaghom.claim_agent_skill_invocation_internal(text,text);
DROP FUNCTION tanaghom.decide_agent_skill_invocation(uuid,uuid,uuid,text,text,text);
DROP FUNCTION tanaghom.authorize_agent_skill_invocation(uuid,jsonb,text);
DROP FUNCTION tanaghom.record_agent_runtime_plan(uuid,jsonb,text,integer,integer);
DROP FUNCTION tanaghom.resolve_agent_skill_instructions(uuid,text);
DROP FUNCTION tanaghom.claim_organization_agent_job(text);
DROP FUNCTION tanaghom.queue_organization_agent_handoff(uuid,uuid,uuid,text,text,text,boolean,jsonb);
DROP FUNCTION tanaghom.queue_organization_agent_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,boolean,text,jsonb);

DROP TRIGGER agent_runtime_event_immutable ON tanaghom.organization_agent_runtime_events;
DROP TRIGGER agent_runtime_approval_immutable ON tanaghom.organization_agent_invocation_approvals;
DROP TRIGGER agent_runtime_certification_immutable ON tanaghom.organization_agent_runtime_certifications;
DROP TRIGGER agent_runtime_profile_immutable ON tanaghom.agent_runtime_profiles;
DROP TRIGGER agent_runtime_invocation_integrity ON tanaghom.organization_agent_invocations;
DROP TRIGGER agent_runtime_job_integrity ON tanaghom.organization_agent_jobs;

DROP TABLE tanaghom.organization_agent_runtime_events;
DROP TABLE tanaghom.organization_agent_dependency_blocks;
DROP TABLE tanaghom.organization_agent_invocation_approvals;
DROP TABLE tanaghom.organization_agent_invocations;
DROP TABLE tanaghom.organization_agent_runs;
DROP TABLE tanaghom.organization_agent_jobs;
DROP TABLE tanaghom.organization_agent_runtime_certifications;
DROP TABLE tanaghom.agent_runtime_controls;
DROP TABLE tanaghom.agent_runtime_profiles;

DROP FUNCTION tanaghom.enforce_agent_runtime_invocation_integrity();
DROP FUNCTION tanaghom.enforce_agent_runtime_job_integrity();
DROP FUNCTION tanaghom.prevent_agent_runtime_append_only_mutation();
DROP FUNCTION tanaghom.agent_runtime_sha256(jsonb);
DROP FUNCTION tanaghom.agent_runtime_json_is_safe(jsonb,integer);

DROP OWNED BY tanaghom_agent_runtime;
DROP OWNED BY tanaghom_skill_read_executor;
DROP OWNED BY tanaghom_skill_proposal_executor;
DROP OWNED BY tanaghom_skill_action_executor;
DROP ROLE tanaghom_agent_runtime;
DROP ROLE tanaghom_skill_read_executor;
DROP ROLE tanaghom_skill_proposal_executor;
DROP ROLE tanaghom_skill_action_executor;

DELETE FROM public.schema_migrations
WHERE version='0030_policy_resolved_agent_runtime';

COMMIT;
