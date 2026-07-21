BEGIN;

INSERT INTO tanaghom.agent_workflow_registry
  (code,role_code,name,responsibility,phase,workflow_name,workflow_version,source_path,
   job_types,release_state,runtime_state,trigger_state,runtime_verified_at,runtime_evidence,display_order)
VALUES
  ('conversation_intelligence_worker','sales_crm','Conversation Intelligence Worker',
    'Claims accepted inbound conversations, asks Gemma for a grounded cited proposal, and persists proposal-only evidence for human supervision.',
    'Phase 5C','Tanaghom — Conversation Intelligence v1','v1',
    'n8n/workflows/phase5/conversation-intelligence.v1.json',
    ARRAY['conversation.ghl.inbound_event'],'available','available_not_imported','disabled',
    timestamptz '2026-07-21 00:00:00+00','implementation-merged-not-imported',55);

INSERT INTO public.schema_migrations(version)
VALUES ('0024_conversation_intelligence_worker_registry');

COMMIT;
