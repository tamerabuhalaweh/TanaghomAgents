BEGIN;

DO $$ BEGIN
 IF (SELECT count(*) FROM public.schema_migrations) <> 51
 OR (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0054_workspace_image_quotas'
 THEN RAISE EXCEPTION '0054 down requires the exact 0054 ledger (51 migrations)'; END IF;
END $$;

DROP TABLE tanaghom.workspace_post_images;
DROP TABLE tanaghom.workspace_monthly_image_usage;

DELETE FROM public.schema_migrations WHERE version='0054_workspace_image_quotas';
COMMIT;
