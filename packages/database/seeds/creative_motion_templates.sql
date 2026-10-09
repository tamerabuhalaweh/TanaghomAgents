-- Governed global motion starters for Motion Studio (P3).
-- Platform-owned (NULL organization): readable by every tenant, writable by
-- nobody through tenant roles. Each motion references a pinned global design
-- starter by id (never duplicated source). Semantic slots only.
BEGIN;

INSERT INTO tanaghom.creative_templates(id,organization_id,kind,name,spec,version,is_active) VALUES
('b1000000-0000-4000-8000-000000000001',NULL,'motion','motion-ar-fade',
 '{"contract_version":"creative.motion-document.v1","kind":"motion","locale":"ar","direction":"rtl","design_template_id":"a1000000-0000-4000-8000-000000000001","design_version":1,"fps":24,"scenes":[{"id":"scene-page-1","page_id":"page-1","duration_ms":2000,"transition":{"preset":"fade","duration_ms":500}}],"elements":[{"node_id":"headline-1","preset":"slide","direction":"start","delay_ms":0,"duration_ms":800,"easing":"ease-out"},{"node_id":"body-1","preset":"fade","delay_ms":300,"duration_ms":800,"easing":"ease-out"},{"node_id":"cta-1","preset":"scale","delay_ms":600,"duration_ms":600,"easing":"ease-out"}]}',
 1,true),
('b1000000-0000-4000-8000-000000000002',NULL,'motion','motion-en-slide',
 '{"contract_version":"creative.motion-document.v1","kind":"motion","locale":"en","direction":"ltr","design_template_id":"a1000000-0000-4000-8000-000000000002","design_version":1,"fps":24,"scenes":[{"id":"scene-page-1","page_id":"page-1","duration_ms":2000,"transition":{"preset":"slide","direction":"start","duration_ms":600}}],"elements":[{"node_id":"headline-1","preset":"slide","direction":"start","delay_ms":0,"duration_ms":800,"easing":"ease-out"},{"node_id":"body-1","preset":"reveal","direction":"start","delay_ms":300,"duration_ms":800,"easing":"ease-out"}]}',
 1,true),
('b1000000-0000-4000-8000-000000000003',NULL,'motion','motion-ar-story',
 '{"contract_version":"creative.motion-document.v1","kind":"motion","locale":"ar","direction":"rtl","design_template_id":"a1000000-0000-4000-8000-000000000008","design_version":1,"fps":24,"scenes":[{"id":"scene-page-1","page_id":"page-1","duration_ms":3000,"transition":{"preset":"fade","duration_ms":500}}],"elements":[{"node_id":"headline-1","preset":"slide","direction":"start","delay_ms":0,"duration_ms":900,"easing":"ease-out"},{"node_id":"body-1","preset":"fade","delay_ms":400,"duration_ms":800,"easing":"ease-out"},{"node_id":"cta-1","preset":"scale","delay_ms":900,"duration_ms":700,"easing":"ease-out"}],"captions":[{"text":"شاهد العرض الكامل","start_ms":1000,"end_ms":2800}]}',
 1,true)
ON CONFLICT DO NOTHING;

COMMIT;
