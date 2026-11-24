-- TASK-035: 실제 무료 스테이징의 합성 알림 조회 전용 자료. 외부 실패/발송을 일으키지 않는다.
-- 두 UUID 자리만 정상 사장님 세션의 자기 합성 가게/사장님 값으로 대체한다.
BEGIN;
DO $qa$
DECLARE
  test_shop uuid := '__SYNTHETIC_SHOP_ID__'::uuid;
  test_owner uuid := '__SYNTHETIC_OWNER_ID__'::uuid;
  marker jsonb := '{"synthetic_task":35,"synthetic_run":20261124,"synthetic_fixture":1}'::jsonb;
  inserted integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.shops WHERE id=test_shop AND owner_id=test_owner
      AND name LIKE '%합성%' AND license_status='verified') THEN
    RAISE EXCEPTION 'synthetic shop guard failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ops_events WHERE detail=marker) THEN
    RAISE EXCEPTION 'synthetic fixture already exists';
  END IF;
  INSERT INTO public.ops_events (shop_id,kind,count,detail,created_at) VALUES
    (test_shop,'channel_already_linked',0,marker,transaction_timestamp()),
    (NULL,'privacy_transfer_missing',1,marker,transaction_timestamp()),
    (test_shop,'ai_failure_burst',5,marker,transaction_timestamp()-interval '1 microsecond');
  GET DIAGNOSTICS inserted=ROW_COUNT;
  IF inserted<>3 THEN RAISE EXCEPTION 'synthetic fixture row count differs'; END IF;
END $qa$;
SELECT jsonb_build_object('fixtureRows',count(*),'kinds',count(DISTINCT kind),
  'ownShopRows',count(*) FILTER(WHERE shop_id IS NOT NULL),
  'globalRows',count(*) FILTER(WHERE shop_id IS NULL),
  'numericDetailOnly',bool_and(jsonb_typeof(detail->'synthetic_task')='number'
    AND jsonb_typeof(detail->'synthetic_run')='number' AND jsonb_typeof(detail->'synthetic_fixture')='number'))
FROM public.ops_events
WHERE detail='{"synthetic_task":35,"synthetic_run":20261124,"synthetic_fixture":1}'::jsonb;
COMMIT;
