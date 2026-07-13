\set ON_ERROR_STOP on

INSERT INTO tanaghom.app_users (
  id,email,display_name,kind,role,organization_id,auth_subject,accepted_at
) VALUES
  ('68000000-0000-4000-8000-000000000001','operator-phase5d@example.test','Staging Operator','human','operator','10000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',now()),
  ('68000000-0000-4000-8000-000000000002','reviewer-phase5d@example.test','Staging Reviewer','human','reviewer','10000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000002',now()),
  ('68000000-0000-4000-8000-000000000003','viewer-phase5d@example.test','Staging Viewer','human','viewer','10000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000003',now());

INSERT INTO tanaghom.organizations (id,slug,name)
VALUES ('68000000-0000-4000-8000-000000000010','phase5d-isolation','Phase 5D Isolation');
INSERT INTO tanaghom.app_users (
  id,email,display_name,kind,role,organization_id,auth_subject,accepted_at
) VALUES (
  '68000000-0000-4000-8000-000000000011','outsider-phase5d@example.test','Outside Operator',
  'human','operator','68000000-0000-4000-8000-000000000010','98000000-0000-4000-8000-000000000011',now()
);

UPDATE tanaghom.conversations SET priority='urgent',sla_due_at=statement_timestamp()-interval '5 minutes'
WHERE organization_id='10000000-0000-4000-8000-000000000001'
  AND provider_conversation_id='conversation-intelligence-1';

DO $$
DECLARE v_conversation tanaghom.conversation_supervisor_inbox%ROWTYPE;
BEGIN
  SELECT * INTO v_conversation FROM tanaghom.conversation_supervisor_inbox
   WHERE organization_id='10000000-0000-4000-8000-000000000001'
     AND provider_conversation_id='conversation-intelligence-1';
  IF v_conversation.id IS NULL OR NOT v_conversation.sla_breached
     OR v_conversation.priority<>'urgent' OR v_conversation.language<>'en'
     OR v_conversation.intent<>'pricing' OR v_conversation.latest_proposal_id IS NULL
     OR v_conversation.handoff_summary IS NULL OR v_conversation.suggested_response IS NULL THEN
    RAISE EXCEPTION 'supervisor inbox lost SLA, classification, or handoff metadata';
  END IF;
  BEGIN
    PERFORM tanaghom.transition_supervised_conversation(
      v_conversation.id,'takeover','68000000-0000-4000-8000-000000000003',NULL,
      'Viewer must never acquire reply authority',v_conversation.conversation_version,
      '68000000-0000-4000-8000-000000000020'
    );
    RAISE EXCEPTION 'viewer acquired conversation ownership';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='viewer acquired conversation ownership' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  IF has_table_privilege('tanaghom_conversation_worker','tanaghom.conversations','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_conversation_worker','tanaghom.conversation_ownership_history','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_n8n_worker','tanaghom.conversations','SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_function_privilege('tanaghom_conversation_worker',
       'tanaghom.claim_conversation_ai_lease(uuid,bigint,integer,uuid)','EXECUTE')
     OR has_function_privilege('tanaghom_n8n_worker',
       'tanaghom.claim_conversation_ai_lease(uuid,bigint,integer,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'conversation ownership least-privilege boundary failed';
  END IF;
END;
$$;

SET ROLE tanaghom_conversation_worker;
SELECT tanaghom.sweep_conversation_supervisor_alerts();
RESET ROLE;

DO $$
DECLARE v_conversation_id uuid;
BEGIN
  SELECT id INTO v_conversation_id FROM tanaghom.conversations
   WHERE provider_conversation_id='conversation-intelligence-1';
  IF (SELECT count(*) FROM tanaghom.conversation_notification_receipts
      WHERE conversation_id=v_conversation_id AND alert_type IN ('urgent','sla_breached')) <> 2
     OR (SELECT count(*) FROM tanaghom.notifications
      WHERE entity_type='conversation' AND entity_id=v_conversation_id) < 2 THEN
    RAISE EXCEPTION 'urgent and SLA notification sweep did not produce deduplicated supervisor alerts';
  END IF;
END;
$$;

SELECT 'PASS: supervisor inbox, role, SLA, and worker privilege foundations enforced.' AS result;
