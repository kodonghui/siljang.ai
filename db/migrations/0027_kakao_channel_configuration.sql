-- TASK-042/A36: 같은 생성 시각에도 가장 최근에 고른 채널을 안정되게 찾는다.
ALTER TABLE kakao_channels ADD COLUMN configuration_order bigint GENERATED ALWAYS AS IDENTITY NOT NULL;
COMMENT ON COLUMN kakao_channels.configuration_order IS '마지막으로 고른 연결의 순번. 같은 생성 시각에도 현재 설정 하나를 찾고 스킬 키 교체만으로 선택은 바꾸지 않음(API-030/031)';
CREATE INDEX kakao_channels_configuration_idx ON kakao_channels (shop_id, configuration_order DESC) WHERE status <> 'retired';

-- 다른 가게의 지난 선점을 풀 수 있는 좁은 기능. ID/내용은 반환하지 않는다.
-- 모든 채널 설정은 이 잠금 뒤 자기 가게 행을 잠근다. 봇을 맞바꿀 때 잠금 역전을 피한다.
CREATE FUNCTION claim_kakao_bot(requesting_shop uuid, requested_bot text, requested_at timestamptz) RETURNS boolean
LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path = pg_catalog AS $kakao_claim$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('siljang:kakao:channel-configuration:v1',0));
  UPDATE public.kakao_channels SET status='failed',claim_expires_at=NULL
    WHERE shop_id<>requesting_shop AND bot_id=requested_bot AND status='pending' AND claim_expires_at<=requested_at;
  RETURN NOT EXISTS (SELECT 1 FROM public.kakao_channels
    WHERE shop_id<>requesting_shop AND bot_id=requested_bot AND status IN ('pending','linked'));
END
$kakao_claim$;
REVOKE ALL ON FUNCTION claim_kakao_bot(uuid,text,timestamptz) FROM PUBLIC;
