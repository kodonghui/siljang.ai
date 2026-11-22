-- TASK-036: 0031은 고치지 않고 판정 시각 인자/열 이름의 충돌을 바로잡는다.
-- 같은 요청 시각에도 마지막 요청을 찾는다. 운영자 목록의 시각/ID 정렬 계약은 유지한다.
ALTER TABLE shop_identity_changes ADD COLUMN requested_order bigint GENERATED ALWAYS AS IDENTITY NOT NULL;
COMMENT ON COLUMN shop_identity_changes.requested_order IS '같은 요청 시각에도 마지막 요청 하나를 찾는 내부 순번. 가게 잠금 뒤 새 요청마다 정함(API-009/080)';
DO $identity_request_order$
DECLARE item record;
BEGIN
  LOCK TABLE public.shop_identity_changes IN ACCESS EXCLUSIVE MODE;
  FOR item IN SELECT id FROM public.shop_identity_changes ORDER BY requested_at,id LOOP
    UPDATE public.shop_identity_changes SET requested_order=DEFAULT WHERE id=item.id;
  END LOOP;
END
$identity_request_order$;
CREATE INDEX shop_identity_changes_latest_idx ON shop_identity_changes (shop_id,requested_order DESC);

-- TASK-036: 살아 있는 운영자 세션으로 요청 하나의 신원 정보만 반영·보류한다.
CREATE OR REPLACE FUNCTION review_shop_identity(
  requested_shop uuid, requested_change uuid, requested_operator uuid, session_hash text,
  requested_at timestamptz, expected_request text, expected_account uuid, expected_account_version text,
  decision text, hold_reason text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $identity_review$
DECLARE
  shop_row public.shops%ROWTYPE;
  change_row public.shop_identity_changes%ROWTYPE;
  request_version text;
  account_id uuid;
  account_version text;
BEGIN
  PERFORM 1 FROM public.operators o WHERE o.id=requested_operator
    AND o.disabled_at IS NULL AND o.mfa_enrolled_at IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RETURN 'unauthenticated'; END IF;
  PERFORM 1 FROM public.operator_sessions s WHERE s.operator_id=requested_operator
    AND s.token_hash=session_hash AND s.ended_at IS NULL
    AND s.created_at<=requested_at AND s.expires_at>requested_at FOR SHARE;
  IF NOT FOUND THEN RETURN 'unauthenticated'; END IF;
  IF decision IS NULL OR decision NOT IN ('applied','on_hold')
     OR (decision='on_hold' AND (hold_reason IS NULL OR char_length(hold_reason) NOT BETWEEN 1 AND 200 OR btrim(hold_reason, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')=''))
     OR requested_at IS NULL OR expected_request IS NULL
     OR (expected_account IS NULL)<>(expected_account_version IS NULL) THEN
    RAISE EXCEPTION 'invalid identity review' USING ERRCODE='22023';
  END IF;
  SELECT * INTO shop_row FROM public.shops s WHERE s.id=requested_shop FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT i.* INTO change_row FROM public.shop_identity_changes i
    WHERE i.shop_id=requested_shop AND i.id=requested_change FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF change_row.status<>'pending' THEN
    IF change_row.reviewed_by IS DISTINCT FROM requested_operator THEN RETURN 'already_decided'; END IF;
    IF change_row.status=decision AND (decision='applied' OR change_row.hold_reason=hold_reason) THEN RETURN 'unchanged'; END IF;
    RETURN 'version_conflict';
  END IF;
  SELECT i.xmin::text INTO request_version FROM public.shop_identity_changes i
    WHERE i.shop_id=requested_shop AND i.id=requested_change;
  SELECT p.id,p.xmin::text INTO account_id,account_version FROM public.payment_accounts p
    WHERE p.shop_id=requested_shop AND p.retired_at IS NULL FOR SHARE;
  IF request_version<>expected_request
     OR account_id IS DISTINCT FROM expected_account OR account_version IS DISTINCT FROM expected_account_version
     OR (shop_row.business_name,shop_row.representative_name,shop_row.business_reg_no)
        IS DISTINCT FROM (change_row.prev_business_name,change_row.prev_representative_name,change_row.prev_business_reg_no) THEN
    RETURN 'version_conflict';
  END IF;
  IF decision='applied' THEN
    UPDATE public.shops SET business_name=change_row.business_name,
      representative_name=change_row.representative_name,business_reg_no=change_row.business_reg_no,updated_at=review_shop_identity.requested_at
      WHERE id=requested_shop;
  END IF;
  UPDATE public.shop_identity_changes SET status=decision,
    hold_reason=CASE WHEN decision='on_hold' THEN review_shop_identity.hold_reason ELSE NULL END,
    reviewed_by=requested_operator,reviewed_at=review_shop_identity.requested_at
    WHERE shop_id=requested_shop AND id=requested_change;
  RETURN 'done';
END
$identity_review$;
REVOKE ALL ON FUNCTION review_shop_identity(uuid,uuid,uuid,text,timestamptz,text,uuid,text,text,text) FROM PUBLIC;
