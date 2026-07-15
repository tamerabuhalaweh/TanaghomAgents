BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tanaghom.notification_destinations) THEN
    RAISE EXCEPTION 'delete customer notification destinations before rolling back 0019';
  END IF;
END;
$$;

REVOKE SELECT,INSERT,UPDATE,DELETE ON tanaghom.notification_destinations FROM tanaghom_api;
REVOKE SELECT ON tanaghom.notification_delivery_controls,tanaghom.notification_delivery_status
  FROM tanaghom_api,tanaghom_readonly;
DROP VIEW tanaghom.notification_delivery_status;
DROP TABLE tanaghom.notification_destinations;
DROP TABLE tanaghom.notification_delivery_controls;

DELETE FROM public.schema_migrations
WHERE version='0019_notification_monitoring_destinations';

COMMIT;
