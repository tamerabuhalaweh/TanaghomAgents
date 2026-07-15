DO $$
DECLARE v_status tanaghom.notification_delivery_status%ROWTYPE;
BEGIN
  SELECT * INTO v_status FROM tanaghom.notification_delivery_status
  WHERE organization_id='10000000-0000-4000-8000-000000000001';
  IF v_status.runtime_ready OR NOT v_status.emergency_stop OR v_status.delivery_ready
     OR v_status.configured_destinations<>0 THEN
    RAISE EXCEPTION 'notification delivery did not start locked';
  END IF;

  IF has_table_privilege('tanaghom_readonly','tanaghom.notification_destinations','SELECT')
     OR has_table_privilege('tanaghom_n8n_worker','tanaghom.notification_destinations','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_conversation_worker','tanaghom.notification_destinations','SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'notification destination secret table leaked to a worker or readonly role';
  END IF;
  IF NOT has_table_privilege('tanaghom_api','tanaghom.notification_destinations','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_api','tanaghom.notification_delivery_controls','UPDATE') THEN
    RAISE EXCEPTION 'notification API/platform role boundary is incorrect';
  END IF;
END;
$$;

INSERT INTO tanaghom.notification_destinations (
  organization_id,channel,label,target_ciphertext,target_nonce,target_auth_tag,
  target_key_version,target_last_four,minimum_severity,event_types,configured_by
) VALUES (
  '10000000-0000-4000-8000-000000000001','email','Operations email',
  decode('74657374','hex'),decode('000000000000000000000000','hex'),decode('00000000000000000000000000000000','hex'),
  1,'test','warning',ARRAY['queue_age','dead_letter']::text[],
  '00000000-0000-4000-8000-000000000001'
);

DO $$
DECLARE v_status tanaghom.notification_delivery_status%ROWTYPE;
BEGIN
  SELECT * INTO v_status FROM tanaghom.notification_delivery_status
  WHERE organization_id='10000000-0000-4000-8000-000000000001';
  IF v_status.configured_destinations<>1 OR v_status.selected_destinations<>1
     OR v_status.delivery_ready THEN
    RAISE EXCEPTION 'configured destination bypassed locked platform delivery';
  END IF;
END;
$$;

DELETE FROM tanaghom.notification_destinations
WHERE organization_id='10000000-0000-4000-8000-000000000001';

SELECT 'PASS: customer notification destination and locked delivery boundary enforced.' AS result;
