-- 위 seed가 만든 표식/세 종류의 합성 행3개만 지운다. 다른 기록/권한은 바꾸지 않는다.
BEGIN;
DO $qa$
DECLARE
  marker jsonb := '{"synthetic_task":35,"synthetic_run":20261124,"synthetic_fixture":1}'::jsonb;
  removed integer;
BEGIN
  IF (SELECT count(*) FROM public.ops_events WHERE detail=marker)<>3
      OR (SELECT count(DISTINCT kind) FROM public.ops_events WHERE detail=marker)<>3
      OR EXISTS(SELECT 1 FROM public.ops_events WHERE detail=marker
        AND kind NOT IN('channel_already_linked','privacy_transfer_missing','ai_failure_burst')) THEN
    RAISE EXCEPTION 'synthetic cleanup guard failed';
  END IF;
  DELETE FROM public.ops_events WHERE detail=marker
    AND kind IN('channel_already_linked','privacy_transfer_missing','ai_failure_burst');
  GET DIAGNOSTICS removed=ROW_COUNT;
  IF removed<>3 THEN RAISE EXCEPTION 'synthetic cleanup row count differs'; END IF;
END $qa$;
SELECT jsonb_build_object('fixtureRowsAfter',count(*)) FROM public.ops_events
WHERE detail='{"synthetic_task":35,"synthetic_run":20261124,"synthetic_fixture":1}'::jsonb;
COMMIT;
