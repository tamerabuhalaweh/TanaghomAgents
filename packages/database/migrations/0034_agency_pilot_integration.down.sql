BEGIN;
DO $$ BEGIN
 IF (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0034_agency_pilot_integration'
 THEN RAISE EXCEPTION '0034 rollback requires exact 0034 baseline'; END IF;
 IF EXISTS(SELECT 1 FROM tanaghom.agency_pilot_bindings)
 OR EXISTS(SELECT 1 FROM tanaghom.agency_pilot_evidence)
 OR EXISTS(SELECT 1 FROM tanaghom.agency_pilot_tasks)
 OR EXISTS(SELECT 1 FROM tanaghom.agency_pilot_events)
 OR EXISTS(SELECT 1 FROM tanaghom.agency_pilot_controls WHERE NOT emergency_stop OR model_execution_enabled)
 THEN RAISE EXCEPTION '0034 rollback refused: retained pilot state or enabled controls; stop new work and retain evidence for a forward fix'; END IF;
END $$;
DROP FUNCTION tanaghom.read_agency_pilot_completion(uuid,uuid);
DROP FUNCTION tanaghom.finish_agency_pilot(uuid,uuid,text,jsonb,text);
DROP FUNCTION tanaghom.seal_agency_pilot(uuid,uuid,text,jsonb);
DROP FUNCTION tanaghom.resolve_agency_pilot(uuid,uuid);
DROP FUNCTION tanaghom.claim_agency_pilot();
DROP FUNCTION tanaghom.queue_agency_pilot(uuid,uuid,uuid,text,uuid,jsonb,uuid[],text);
DROP FUNCTION tanaghom.revoke_agency_pilot_evidence(uuid,uuid);
DROP FUNCTION tanaghom.approve_agency_pilot_evidence(uuid,text,jsonb,timestamptz);
DROP FUNCTION tanaghom.bind_agency_pilot(uuid,uuid,text);
DROP TABLE tanaghom.agency_pilot_events,tanaghom.agency_pilot_tasks,tanaghom.agency_pilot_evidence_revocations,
 tanaghom.agency_pilot_evidence,tanaghom.agency_pilot_bindings,tanaghom.agency_pilot_profiles,tanaghom.agency_pilot_controls;
DROP FUNCTION tanaghom.guard_agency_pilot_task();
DROP OWNED BY tanaghom_agency_pilot_worker;
DROP ROLE tanaghom_agency_pilot_worker;
DELETE FROM public.schema_migrations WHERE version='0034_agency_pilot_integration';
COMMIT;
