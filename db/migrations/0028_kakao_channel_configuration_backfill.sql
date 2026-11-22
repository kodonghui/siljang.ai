-- TASK-042 리뷰: 0027 전에 있던 행은 heap 순서 대신 만든 시각·ID 순서로 현재 설정 순번을 채운다.
-- 적용한 0027을 고치지 않는다. 새 설정 저장의 DEFAULT도 이 보정 뒤의 순번부터 이어진다.
DO $configuration_backfill$
DECLARE
  channel record;
BEGIN
  LOCK TABLE public.kakao_channels IN ACCESS EXCLUSIVE MODE;
  FOR channel IN SELECT id FROM public.kakao_channels ORDER BY created_at,id LOOP
    UPDATE public.kakao_channels SET configuration_order=DEFAULT WHERE id=channel.id;
  END LOOP;
END
$configuration_backfill$;
