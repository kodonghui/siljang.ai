-- TASK-033 검토: 새 신고증과 바꾼 옛 사진의 삭제 예약을 같은 트랜잭션에 남긴다.
ALTER TABLE public.file_deletions DROP CONSTRAINT file_deletions_source_check;
ALTER TABLE public.file_deletions ADD CONSTRAINT file_deletions_source_check
  CHECK (source IN ('reference_photo','issue_photo','license_photo'));
COMMENT ON COLUMN public.file_deletions.source IS '지운 참고 사진·신고 사진 또는 바꾼 옛 영업 신고증 사진(SPEC-065)';
COMMENT ON COLUMN public.file_deletions.storage_key IS '저장소에서 지울 사진 파일의 저장 위치. 지운 참고 사진·신고 사진 또는 바꾼 옛 영업 신고증 사진. 사진의 내용·손님 정보는 두지 않음';
COMMENT ON COLUMN public.file_deletions.queued_at IS '사진 행을 지우거나 신고증 사진을 바꾼 트랜잭션의 시각. 그 트랜잭션에서 이 행을 넣음(5절 E24)';
COMMENT ON TABLE public.file_deletions IS 'TBL-054 지울 파일: 지운 참고 사진·신고 사진 또는 바꾼 옛 영업 신고증 사진의 저장 위치. 저장소에서 파일을 지운 뒤에만 행을 지우고, 실패하면 남아 다음 날 다시 지움';
-- TASK-033: 사장님의 살아 있는 세션과 자기 가게 보류/버전을 다시 확인한다.
CREATE OR REPLACE FUNCTION resubmit_shop_license(
  requested_shop uuid, requested_owner uuid, session_hash text, requested_time timestamptz,
  expected_version text, new_license_no text, new_business_type text, new_photo_key text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $license_resubmission$
DECLARE
  current_status text;
  current_version text;
  current_photo_key text;
BEGIN
  PERFORM 1 FROM public.owners o WHERE o.id=requested_owner FOR SHARE;
  IF NOT FOUND THEN RETURN 'unauthenticated'; END IF;
  PERFORM 1 FROM public.owner_sessions ss WHERE ss.owner_id=requested_owner
    AND ss.token_hash=session_hash AND ss.ended_at IS NULL
    AND ss.created_at<=requested_time AND ss.expires_at>requested_time FOR SHARE;
  IF NOT FOUND THEN RETURN 'unauthenticated'; END IF;
  IF expected_version IS NULL OR requested_time IS NULL
     OR new_license_no IS NULL OR char_length(new_license_no) NOT BETWEEN 1 AND 30
     OR btrim(new_license_no, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')=''
     OR new_business_type IS NULL OR new_business_type NOT IN ('instant_sale_manufacturing','bakery')
     OR new_photo_key IS NULL OR NOT starts_with(new_photo_key,'shops/' || requested_shop::text || '/license_photo/') THEN
    RAISE EXCEPTION 'invalid license resubmission' USING ERRCODE='22023';
  END IF;
  SELECT s.license_status,s.xmin::text,s.license_photo_key INTO current_status,current_version,current_photo_key
    FROM public.shops s WHERE s.id=requested_shop AND s.owner_id=requested_owner FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF current_version<>expected_version THEN RETURN 'version_conflict'; END IF;
  IF current_status<>'on_hold' THEN RETURN 'invalid_state'; END IF;
  IF current_photo_key<>new_photo_key THEN
    INSERT INTO public.file_deletions(shop_id,storage_key,source,queued_at)
      VALUES(requested_shop,current_photo_key,'license_photo',requested_time)
      ON CONFLICT (storage_key) DO NOTHING;
  END IF;
  PERFORM public.close_license_on_hold_tasks(requested_shop,requested_time);
  UPDATE public.shops SET food_license_no=new_license_no,food_business_type=new_business_type,
    license_photo_key=new_photo_key,license_status='pending',license_hold_reason=NULL,
    license_reviewed_by=NULL,license_reviewed_at=NULL,updated_at=requested_time WHERE id=requested_shop;
  RETURN 'done';
END
$license_resubmission$;
REVOKE ALL ON FUNCTION resubmit_shop_license(uuid,uuid,text,timestamptz,text,text,text,text) FROM PUBLIC;
