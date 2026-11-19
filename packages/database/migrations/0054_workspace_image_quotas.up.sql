BEGIN;

DO $$ BEGIN
 IF (SELECT count(*) FROM public.schema_migrations) <> 50
 OR (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0053_workspace_step_retry'
 THEN RAISE EXCEPTION '0054 requires the exact 0053 ledger (50 migrations)'; END IF;
END $$;

-- One row per generated (or deliberately skipped) AI image for a Task 2 post.
-- The workspace/post pair is unique so loading the post cards again reuses the
-- stored image instead of re-charging the tenant's monthly image quota.
CREATE TABLE tanaghom.workspace_post_images (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
 workspace_id uuid NOT NULL REFERENCES tanaghom.agency_workspaces(id),
 post_index smallint NOT NULL CHECK (post_index BETWEEN 1 AND 3),
 month date NOT NULL CHECK (month = date_trunc('month', month)::date),
 status text NOT NULL CHECK (status IN ('generated', 'fallback')),
 fallback_reason text CHECK (fallback_reason IS NULL OR char_length(fallback_reason) BETWEEN 3 AND 120),
 model text CHECK (model IS NULL OR char_length(model) BETWEEN 3 AND 120),
 object_key text CHECK (
   object_key IS NULL
   OR object_key ~ '^t/[0-9a-f-]{36}/image/[0-9a-f-]{36}/v[0-9]{1,9}\.(png|jpg|jpeg|webp)$'
 ),
 mime_type text CHECK (mime_type IS NULL OR mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
 byte_size integer CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 16777216),
 sha256_hex text CHECK (sha256_hex IS NULL OR sha256_hex ~ '^[a-f0-9]{64}$'),
 prompt_summary text CHECK (prompt_summary IS NULL OR char_length(prompt_summary) <= 600),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT workspace_post_images_generated_artifact CHECK (
   status <> 'generated'
   OR (object_key IS NOT NULL AND mime_type IS NOT NULL AND byte_size IS NOT NULL AND sha256_hex IS NOT NULL)
 ),
 CONSTRAINT workspace_post_images_fallback_reason CHECK (
   status <> 'fallback' OR fallback_reason IS NOT NULL
 ),
 UNIQUE (workspace_id, post_index)
);

-- Atomic per-organization monthly counter. Each UTC calendar month is its own
-- key, so a new month starts at zero without a scheduled job.
CREATE TABLE tanaghom.workspace_monthly_image_usage (
 organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
 month date NOT NULL CHECK (month = date_trunc('month', month)::date),
 images_used integer NOT NULL DEFAULT 0 CHECK (images_used >= 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (organization_id, month)
);

GRANT SELECT, INSERT, UPDATE ON tanaghom.workspace_post_images TO tanaghom_api;
GRANT SELECT, INSERT, UPDATE ON tanaghom.workspace_monthly_image_usage TO tanaghom_api;

INSERT INTO public.schema_migrations(version) VALUES('0054_workspace_image_quotas');
COMMIT;
