BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tanaghom.notification_deliveries) THEN
    RAISE EXCEPTION 'notification delivery history exists; export or remove it explicitly before rollback';
  END IF;
END;
$$;

DROP FUNCTION tanaghom.complete_notification_delivery(uuid, boolean, integer, text, boolean);
DROP FUNCTION tanaghom.claim_notification_deliveries(integer);
DROP FUNCTION tanaghom.enqueue_notification_deliveries();
DROP FUNCTION tanaghom.notification_delivery_active();
DROP TABLE tanaghom.notification_deliveries;

DELETE FROM public.schema_migrations WHERE version = '0036_notification_delivery_worker';

COMMIT;
