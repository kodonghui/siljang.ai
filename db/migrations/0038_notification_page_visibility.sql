-- TASK-077: Worker 시각과 커밋 시각을 구분하여 상담 페이지의 전달 순서를 고정한다.
ALTER TABLE notifications ADD COLUMN delivery_txid bigint NOT NULL DEFAULT txid_current();
COMMENT ON COLUMN notifications.delivery_txid IS '전달 상태를 마지막으로 바꾼 최상위 트랜잭션 ID. API-043 첫 조회의 가시성으로 전달 시각을 정한다';
CREATE FUNCTION notification_delivery_revision() RETURNS trigger LANGUAGE plpgsql AS $notification_delivery$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
      RAISE EXCEPTION 'notification delivery time is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.sent_at IS NOT DISTINCT FROM OLD.sent_at THEN
      NEW.delivery_txid := OLD.delivery_txid;
      RETURN NEW;
    END IF;
  END IF;
  NEW.delivery_txid := txid_current();
  RETURN NEW;
END
$notification_delivery$;
CREATE TRIGGER notification_delivery_revision BEFORE INSERT OR UPDATE OF status,sent_at,delivery_txid ON notifications FOR EACH ROW EXECUTE FUNCTION notification_delivery_revision();
DROP INDEX notifications_timeline_page_idx;
CREATE INDEX notifications_timeline_page_idx ON notifications (shop_id,consultation_id,created_at,timeline_seq);
