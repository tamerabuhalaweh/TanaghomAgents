BEGIN;

CREATE TABLE tanaghom.api_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES tanaghom.app_users(id),
  operation_type text NOT NULL CHECK (length(trim(operation_type)) > 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  response_status integer CHECK (response_status BETWEEN 200 AND 599),
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (actor_user_id, operation_type, idempotency_key),
  CHECK (
    (status = 'processing' AND response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
    OR
    (status = 'completed' AND response_status IS NOT NULL AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX api_idempotency_created_idx
  ON tanaghom.api_idempotency_keys(created_at);

INSERT INTO public.schema_migrations(version)
VALUES ('0003_api_idempotency');

COMMIT;
