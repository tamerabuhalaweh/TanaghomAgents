BEGIN;

CREATE TABLE tanaghom.notification_delivery_controls (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  runtime_ready boolean NOT NULL DEFAULT false,
  emergency_stop boolean NOT NULL DEFAULT true,
  reason text NOT NULL DEFAULT 'Notification delivery is disabled until the runtime and destination are approved',
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (length(trim(reason)) BETWEEN 3 AND 500)
);

INSERT INTO tanaghom.notification_delivery_controls (singleton)
VALUES (true);

CREATE TABLE tanaghom.notification_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','slack','whatsapp')),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 3 AND 80),
  status text NOT NULL DEFAULT 'configured' CHECK (status IN ('configured','disabled')),
  target_ciphertext bytea NOT NULL,
  target_nonce bytea NOT NULL,
  target_auth_tag bytea NOT NULL,
  target_key_version integer NOT NULL CHECK (target_key_version > 0),
  target_last_four text NOT NULL CHECK (length(target_last_four) BETWEEN 1 AND 4),
  minimum_severity text NOT NULL DEFAULT 'warning'
    CHECK (minimum_severity IN ('info','warning','error','critical')),
  event_types text[] NOT NULL DEFAULT ARRAY[
    'queue_age','interactive_backlog','dependency_cooldown','worker_unready',
    'dead_letter','indeterminate_action','database_unavailable'
  ]::text[],
  configured_by uuid NOT NULL REFERENCES tanaghom.app_users(id),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id, channel),
  CHECK (cardinality(event_types) BETWEEN 1 AND 12),
  CHECK (event_types <@ ARRAY[
    'queue_age','interactive_backlog','dependency_cooldown','worker_unready',
    'dead_letter','indeterminate_action','database_unavailable'
  ]::text[])
);

CREATE TRIGGER notification_destinations_set_updated_at
BEFORE UPDATE ON tanaghom.notification_destinations
FOR EACH ROW EXECUTE FUNCTION tanaghom.set_updated_at();

CREATE VIEW tanaghom.notification_delivery_status AS
SELECT organization.id AS organization_id,
  count(destination.id)::integer AS configured_destinations,
  count(destination.id) FILTER (WHERE destination.status='configured')::integer AS selected_destinations,
  control.runtime_ready,
  control.emergency_stop,
  control.reason,
  coalesce(bool_or(destination.status='configured'),false) AND control.runtime_ready AND NOT control.emergency_stop AS delivery_ready,
  max(destination.updated_at) AS last_configured_at
FROM tanaghom.organizations organization
CROSS JOIN tanaghom.notification_delivery_controls control
LEFT JOIN tanaghom.notification_destinations destination
  ON destination.organization_id=organization.id
GROUP BY organization.id,control.runtime_ready,control.emergency_stop,control.reason;

REVOKE ALL ON tanaghom.notification_delivery_controls,tanaghom.notification_destinations,
  tanaghom.notification_delivery_status
FROM PUBLIC,tanaghom_readonly,tanaghom_n8n_worker,tanaghom_conversation_worker;

GRANT SELECT ON tanaghom.notification_delivery_controls,tanaghom.notification_delivery_status
  TO tanaghom_api,tanaghom_readonly;
GRANT SELECT,INSERT,UPDATE,DELETE ON tanaghom.notification_destinations
  TO tanaghom_api;

INSERT INTO public.schema_migrations(version)
VALUES ('0019_notification_monitoring_destinations');

COMMIT;
