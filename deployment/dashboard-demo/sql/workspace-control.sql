\set ON_ERROR_STOP on
\getenv action DEMO_WORKSPACE_ACTION
\getenv approval DEMO_WORKSPACE_CONTROL_AUTHORIZATION
\getenv change_id DEMO_WORKSPACE_CHANGE_ID
BEGIN;
SELECT set_config('demo_workspace.action', :'action', true),
       set_config('demo_workspace.approval', :'approval', true),
       set_config('demo_workspace.change_id', :'change_id', true);

DO $$
DECLARE mode text := current_setting('demo_workspace.action');
        change_ref text := current_setting('demo_workspace.change_id');
        before_state jsonb; after_state jsonb;
BEGIN
 IF current_database() <> 'tanaghom_demo'
 OR current_setting('demo_workspace.approval') <> 'APPROVED-ISOLATED-DEMO-CONTROL'
 OR mode NOT IN ('enable','stop')
 OR change_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$'
 THEN RAISE EXCEPTION 'invalid demo control target or authorization'; END IF;
 -- Resilient baseline: require the reviewed workspace migration to be applied,
 -- not an exact ledger row count, so later migrations cannot break activation.
 IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='0048_gemini_workspace_model')
 OR NOT EXISTS (SELECT 1 FROM tanaghom.app_users WHERE id='00000000-0000-4000-8000-000000000001' AND email='owner@demo.tanaghom.test')
 THEN RAISE EXCEPTION 'demo identity or schema mismatch'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace-claim',0));
 -- The shared platform stop affects other runtimes. This database must not
 -- contain other active work, and the separate pilot lane must stay stopped.
 IF mode='enable' AND (NOT EXISTS (SELECT 1 FROM tanaghom.agency_pilot_controls WHERE emergency_stop AND NOT model_execution_enabled)
 OR EXISTS (SELECT 1 FROM tanaghom.organization_agent_jobs WHERE status IN ('queued','running','waiting_approval'))
 OR EXISTS (SELECT 1 FROM tanaghom.agency_pilot_tasks WHERE status IN ('queued','in_progress'))
 OR NOT EXISTS (SELECT 1 FROM tanaghom.automation_platform_controls WHERE provider='postiz' AND emergency_stop))
 THEN RAISE EXCEPTION 'other runtime work or provider controls are not safely stopped'; END IF;
 SELECT jsonb_build_object('workspace_enabled',w.enabled,'workspace_stop',w.emergency_stop,
   'workspace_reason',w.reason,'platform_stop',r.emergency_stop,'platform_reason',r.reason)
 INTO before_state FROM tanaghom.agency_workspace_control w CROSS JOIN tanaghom.agent_runtime_controls r;
 IF before_state IS NULL THEN RAISE EXCEPTION 'missing control singleton'; END IF;
 IF mode='enable' AND (before_state->>'workspace_enabled'<>'false' OR before_state->>'workspace_stop'<>'true'
 OR before_state->>'platform_stop'<>'true') THEN RAISE EXCEPTION 'unexpected initial control state'; END IF;

 CREATE TABLE IF NOT EXISTS tanaghom.demo_workspace_control_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  change_id text NOT NULL UNIQUE, action text NOT NULL CHECK(action IN ('enable','stop')),
  actor text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  before_state jsonb NOT NULL, after_state jsonb NOT NULL
 );
 REVOKE ALL ON tanaghom.demo_workspace_control_audit FROM PUBLIC;
 IF mode='enable' THEN
  UPDATE tanaghom.agent_runtime_controls SET emergency_stop=false,reason='Isolated demo workspace only',updated_at=now();
  UPDATE tanaghom.agency_workspace_control SET enabled=true,emergency_stop=false,reason='Isolated demo workspace enabled',updated_at=now();
 ELSE
  UPDATE tanaghom.agency_workspace_control SET enabled=false,emergency_stop=true,reason='Isolated demo workspace stopped',updated_at=now();
  UPDATE tanaghom.agent_runtime_controls SET emergency_stop=true,reason='Isolated demo workspace stopped',updated_at=now();
 END IF;
 SELECT jsonb_build_object('workspace_enabled',w.enabled,'workspace_stop',w.emergency_stop,
   'workspace_reason',w.reason,'platform_stop',r.emergency_stop,'platform_reason',r.reason)
 INTO after_state FROM tanaghom.agency_workspace_control w CROSS JOIN tanaghom.agent_runtime_controls r;
 INSERT INTO tanaghom.demo_workspace_control_audit(change_id,action,actor,before_state,after_state)
 VALUES(change_ref,mode,session_user,before_state,after_state);
END $$;
COMMIT;
SELECT action, change_id, actor, occurred_at
  FROM tanaghom.demo_workspace_control_audit
 WHERE change_id = :'change_id';
