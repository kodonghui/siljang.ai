-- TASK-034 리뷰: 끝난 보류 할 일과 발신 대기만 정리한다. 직접 실행은 서버 역할에 주지 않는다.
CREATE FUNCTION close_license_on_hold_tasks(requested_shop uuid, requested_at timestamptz) RETURNS void
LANGUAGE sql STRICT SECURITY INVOKER SET search_path = pg_catalog AS $close_license_tasks$
  UPDATE public.owner_alerts a SET next_attempt_at=NULL
    WHERE a.shop_id=$1 AND a.kind='license_on_hold' AND a.status='pending'
      AND EXISTS(SELECT 1 FROM public.owner_tasks t WHERE t.shop_id=$1 AND t.id=a.owner_task_id AND t.kind='license_on_hold');
  UPDATE public.owner_tasks SET closed_at=$2
    WHERE shop_id=$1 AND kind='license_on_hold' AND closed_at IS NULL;
$close_license_tasks$;
REVOKE ALL ON FUNCTION close_license_on_hold_tasks(uuid,timestamptz) FROM PUBLIC;

-- TASK-034: 영업 신고와 지금 계좌의 확인만 한 번에 바꾼다. 일반 승인 권한은 주지 않는다.
CREATE OR REPLACE FUNCTION review_shop_license(
  requested_shop uuid, requested_operator uuid, session_hash text, requested_at timestamptz,
  expected_state text, decision text, hold_reason text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $license_review$
DECLARE
  current_status text;
  current_reason text;
  current_state text;
  account_id uuid;
  identity_id uuid;
BEGIN
  PERFORM 1 FROM public.operators o WHERE o.id=requested_operator
    AND o.disabled_at IS NULL AND o.mfa_enrolled_at IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RETURN 'unauthenticated'; END IF;
  PERFORM 1 FROM public.operator_sessions s WHERE s.operator_id=requested_operator
    AND s.token_hash=session_hash AND s.ended_at IS NULL
    AND s.created_at<=requested_at AND s.expires_at>requested_at FOR SHARE;
  IF NOT FOUND THEN RETURN 'unauthenticated'; END IF;
  IF decision IS NULL OR decision NOT IN ('verified','on_hold')
     OR (decision='on_hold' AND (hold_reason IS NULL OR char_length(hold_reason) NOT BETWEEN 1 AND 200 OR btrim(hold_reason, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')=''))
     OR requested_at IS NULL OR expected_state IS NULL THEN
    RAISE EXCEPTION 'invalid license review' USING ERRCODE='22023';
  END IF;
  SELECT s.license_status,s.license_hold_reason INTO current_status,current_reason FROM public.shops s WHERE s.id=requested_shop FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT concat(s.id,':',s.xmin::text,':',coalesce((SELECT concat(p.id,':',p.xmin::text) FROM public.payment_accounts p WHERE p.shop_id=s.id AND p.retired_at IS NULL),'-'),':',coalesce((SELECT concat(i.id,':',i.xmin::text) FROM public.shop_identity_changes i WHERE i.shop_id=s.id AND i.status='pending'),'-'))
    INTO current_state FROM public.shops s WHERE s.id=requested_shop;
  IF current_state<>expected_state THEN RETURN 'version_conflict'; END IF;
  IF current_status='verified' THEN
    IF decision='verified' THEN RETURN 'unchanged'; END IF;
    RETURN 'invalid_state';
  END IF;
  IF current_status='on_hold' AND decision='on_hold' AND current_reason=hold_reason THEN RETURN 'unchanged'; END IF;
  SELECT p.id INTO account_id FROM public.payment_accounts p WHERE p.shop_id=requested_shop AND p.retired_at IS NULL FOR UPDATE;
  SELECT i.id INTO identity_id FROM public.shop_identity_changes i WHERE i.shop_id=requested_shop AND i.status='pending' FOR UPDATE;
  IF decision='verified' AND identity_id IS NOT NULL THEN RETURN 'identity_change_pending'; END IF;
  IF decision='verified' AND account_id IS NULL THEN RETURN 'payment_account_missing'; END IF;
  PERFORM public.close_license_on_hold_tasks(requested_shop,requested_at);
  UPDATE public.shops SET license_status=decision,
    license_hold_reason=CASE WHEN decision='on_hold' THEN hold_reason ELSE NULL END,
    license_reviewed_by=requested_operator,license_reviewed_at=requested_at,updated_at=requested_at
    WHERE id=requested_shop;
  IF decision='verified' THEN
    UPDATE public.payment_accounts SET holder_checked_by=requested_operator,holder_checked_at=requested_at
      WHERE shop_id=requested_shop AND id=account_id AND retired_at IS NULL;
  END IF;
  RETURN 'done';
END
$license_review$;
REVOKE ALL ON FUNCTION review_shop_license(uuid,uuid,text,timestamptz,text,text,text) FROM PUBLIC;

-- 계좌를 바꿔 보류를 처리한 경우도 같은 보류 할 일/발신 대기를 닫는다.
CREATE OR REPLACE FUNCTION payment_account_license_pending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $payment_license$
BEGIN
  UPDATE public.shops
    SET license_status = 'pending', license_hold_reason = NULL,
        license_reviewed_by = NULL, license_reviewed_at = NULL, updated_at = NEW.created_at
    WHERE id = NEW.shop_id AND license_status = 'on_hold';
  IF FOUND THEN PERFORM public.close_license_on_hold_tasks(NEW.shop_id,NEW.created_at); END IF;
  RETURN NEW;
END
$payment_license$;
REVOKE ALL ON FUNCTION payment_account_license_pending() FROM PUBLIC;
