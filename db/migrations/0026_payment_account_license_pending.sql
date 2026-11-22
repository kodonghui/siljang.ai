-- TASK-040/A25: 새 계좌가 등록되면 보류된 영업 신고만 다시 확인 기다림으로 바꾼다.
-- 서버 역할에 일반 승인 UPDATE 권한을 주지 않는다. 트리거 함수는 직접 호출할 수 없다.
CREATE FUNCTION payment_account_license_pending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $payment_license$
BEGIN
  UPDATE public.shops
    SET license_status = 'pending', license_hold_reason = NULL,
        license_reviewed_by = NULL, license_reviewed_at = NULL, updated_at = NEW.created_at
    WHERE id = NEW.shop_id AND license_status = 'on_hold';
  RETURN NEW;
END
$payment_license$;
REVOKE ALL ON FUNCTION payment_account_license_pending() FROM PUBLIC;
CREATE TRIGGER payment_account_license_pending AFTER INSERT ON payment_accounts
  FOR EACH ROW EXECUTE FUNCTION payment_account_license_pending();
