BEGIN;

REVOKE EXECUTE ON FUNCTION tanaghom.persist_conversation_intelligence_proposal(uuid,jsonb) FROM tanaghom_conversation_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.prepare_conversation_intelligence(uuid) FROM tanaghom_conversation_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.transition_sales_knowledge_version(uuid,text,uuid,text) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.create_sales_knowledge_draft(text,text,text,text,text,jsonb,text,text,uuid) FROM tanaghom_api;
REVOKE SELECT ON tanaghom.sales_knowledge_catalog, tanaghom.conversation_intelligence_proposals FROM tanaghom_readonly;

DROP FUNCTION tanaghom.persist_conversation_intelligence_proposal(uuid,jsonb);
DROP FUNCTION tanaghom.prepare_conversation_intelligence(uuid);
DROP FUNCTION tanaghom.transition_sales_knowledge_version(uuid,text,uuid,text);
DROP FUNCTION tanaghom.create_sales_knowledge_draft(text,text,text,text,text,jsonb,text,text,uuid);
DROP VIEW tanaghom.sales_knowledge_catalog;
DROP TABLE tanaghom.conversation_intelligence_proposals;
DROP TABLE tanaghom.conversation_summary_versions;
DROP TRIGGER organizations_default_conversation_policy ON tanaghom.organizations;
DROP FUNCTION tanaghom.create_default_conversation_policy();
DROP TABLE tanaghom.organization_conversation_policy_versions;
DROP TABLE tanaghom.sales_knowledge_versions;
DROP TABLE tanaghom.sales_knowledge_sources;

DELETE FROM public.schema_migrations
WHERE version = '0013_sales_knowledge_intelligence';

COMMIT;
