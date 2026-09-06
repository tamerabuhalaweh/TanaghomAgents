BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM tanaghom.agency_workspaces) OR EXISTS(SELECT 1 FROM tanaghom.agency_workspace_control WHERE enabled OR NOT emergency_stop)
 THEN RAISE EXCEPTION 'workspace rollback refuses retained evidence or enabled runtime; stop and use application rollback'; END IF;
END $$;
DO $$ DECLARE original text; needle text:='WHERE task.options->>''workspace_contract'' IS DISTINCT FROM ''agency.workspace.v1'' AND (task.status='; BEGIN
 SELECT pg_get_functiondef('tanaghom.claim_agency_pilot()'::regprocedure) INTO original;
 IF strpos(original,needle)=0 THEN RAISE EXCEPTION 'unexpected pilot claim definition'; END IF;
 EXECUTE replace(original,needle,'WHERE (task.status=');
END $$;
DROP FUNCTION tanaghom.create_agency_workspace(uuid,text,text,text,text,text[],uuid);
DROP FUNCTION tanaghom.start_agency_workspace(uuid,uuid,uuid[],uuid);
DROP FUNCTION tanaghom.decide_agency_workspace(uuid,uuid,text,text,text);
DROP FUNCTION tanaghom.claim_agency_workspace_task();
DROP FUNCTION tanaghom.complete_agency_workspace_task(uuid,uuid,jsonb,text);
DROP FUNCTION tanaghom.agency_workspace_result_hash(uuid);
DROP TABLE tanaghom.agency_workspace_events,tanaghom.agency_workspace_steps,tanaghom.agency_workspaces,tanaghom.agency_workspace_control;
DROP FUNCTION tanaghom.guard_workspace();
DELETE FROM public.schema_migrations WHERE version='0035_agency_workspace';
COMMIT;
