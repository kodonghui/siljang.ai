-- TASK-034: 영업 신고와 지금 계좌의 확인만 한 번에 바꾼다. 일반 승인 권한은 주지 않는다.
CREATE FUNCTION review_shop_license(
  requested_shop uuid, requested_operator uuid, session_hash text, requested_at timestamptz,
  expected_state text, decision text, hold_reason text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $license_review$
DECLARE
  current_status text;
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
     OR (decision='on_hold' AND (hold_reason IS NULL OR char_length(hold_reason) NOT BETWEEN 1 AND 200))
     OR requested_at IS NULL OR expected_state IS NULL THEN
    RAISE EXCEPTION 'invalid license review' USING ERRCODE='22023';
  END IF;
  SELECT s.license_status INTO current_status FROM public.shops s WHERE s.id=requested_shop FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT concat(s.id,':',s.xmin::text,':',coalesce((SELECT concat(p.id,':',p.xmin::text) FROM public.payment_accounts p WHERE p.shop_id=s.id AND p.retired_at IS NULL),'-'),':',coalesce((SELECT concat(i.id,':',i.xmin::text) FROM public.shop_identity_changes i WHERE i.shop_id=s.id AND i.status='pending'),'-'))
    INTO current_state FROM public.shops s WHERE s.id=requested_shop;
  IF current_state<>expected_state THEN RETURN 'version_conflict'; END IF;
  IF current_status='verified' THEN
    IF decision='verified' THEN RETURN 'unchanged'; END IF;
    RETURN 'invalid_state';
  END IF;
  SELECT p.id INTO account_id FROM public.payment_accounts p WHERE p.shop_id=requested_shop AND p.retired_at IS NULL FOR UPDATE;
  SELECT i.id INTO identity_id FROM public.shop_identity_changes i WHERE i.shop_id=requested_shop AND i.status='pending' FOR UPDATE;
  IF decision='verified' AND identity_id IS NOT NULL THEN RETURN 'identity_change_pending'; END IF;
  IF decision='verified' AND account_id IS NULL THEN RETURN 'payment_account_missing'; END IF;
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
