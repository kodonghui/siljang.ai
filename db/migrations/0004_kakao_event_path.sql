-- 0004_kakao_event_path: 카카오 먼저 보내기 길과 버튼 블록 ID(설계 재검토 H7·H8, 2026-11-13 20:59 결정 카드 '추천안대로 (추천)')
-- 사장님 알림은 우리 서비스 채널 봇이 Event API로 카카오 로그인 사용자 번호(appUserId)에 보냄(REQ-183). 그래서 채울 길이 없던 alert_user_key를 지움.
-- 가게 채널 연결은 카드 버튼이 부르는 블록 넷의 블록 ID를 받고 시험 버튼으로 모두 닿아야 연결됨(REQ-179). 연결된 뒤 시험 안내로 먼저 보내기를 봄(REQ-180, REQ-181).
-- 손님 안내·사장님 알림은 카카오가 받은 taskId로 발송 결과를 조회한 뒤에야 보냄(REQ-182, README 5절 E16).
-- 0003_order_input_lock.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0004_kakao_event_path.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 연결된 채널·보낸 안내가 없음. 있으면 블록 ID를 받고 다시 연결 확인해야 함.

-- TBL-001 owners: 알림 받는 곳은 kakao_account_id(appUserId). 친구 여부를 본 시각
ALTER TABLE owners
  DROP CONSTRAINT owners_alert_user_key_uq,
  DROP COLUMN alert_user_key,
  ADD COLUMN alert_friend_checked_at timestamptz;

-- TBL-004 kakao_channels: 버튼 블록 ID 넷, 시험 버튼으로 닿은 블록, 먼저 보내기 시험
ALTER TABLE kakao_channels
  ADD COLUMN card_block_id text CHECK (char_length(card_block_id) BETWEEN 1 AND 100),
  ADD COLUMN orderer_block_id text CHECK (char_length(orderer_block_id) BETWEEN 1 AND 100),
  ADD COLUMN depositor_block_id text CHECK (char_length(depositor_block_id) BETWEEN 1 AND 100),
  ADD COLUMN review_block_id text CHECK (char_length(review_block_id) BETWEEN 1 AND 100),
  ADD COLUMN verified_blocks text[] NOT NULL DEFAULT '{}' CHECK (verified_blocks <@ ARRAY['card', 'orderer_info', 'depositor_name', 'review']::text[]),
  ADD COLUMN test_user_key text CHECK (char_length(test_user_key) BETWEEN 1 AND 100),
  ADD COLUMN event_status text NOT NULL DEFAULT 'unchecked' CHECK (event_status IN ('unchecked', 'checking', 'ready', 'unavailable')),
  ADD COLUMN event_task_id text CHECK (char_length(event_task_id) BETWEEN 1 AND 100),
  ADD COLUMN event_checked_at timestamptz,
  ADD COLUMN event_fail_reason text CHECK (event_fail_reason IN ('app_not_linked', 'wallet_missing', 'event_block', 'event_skill', 'owner_not_friend', 'not_delivered', 'kakao_error'));
ALTER TABLE kakao_channels
  ADD CONSTRAINT kakao_channels_blocks_chk CHECK (status <> 'linked' OR (card_block_id IS NOT NULL AND orderer_block_id IS NOT NULL AND depositor_block_id IS NOT NULL AND review_block_id IS NOT NULL AND verified_blocks @> ARRAY['card', 'orderer_info', 'depositor_name', 'review']::text[])),
  ADD CONSTRAINT kakao_channels_event_chk CHECK ((event_status = 'unavailable') = (event_fail_reason IS NOT NULL) AND (event_status <> 'checking' OR event_task_id IS NOT NULL) AND (event_status NOT IN ('ready', 'unavailable') OR event_checked_at IS NOT NULL) AND (event_status = 'unchecked' OR status IN ('linked', 'retired')));

-- TBL-043 owner_alerts: 발송 결과 확인 중, 카카오 taskId와 결과
ALTER TABLE owner_alerts
  ADD COLUMN kakao_task_id text CHECK (char_length(kakao_task_id) BETWEEN 1 AND 100),
  ADD COLUMN requested_at timestamptz,
  ADD COLUMN delivery_checked_at timestamptz,
  ADD COLUMN fail_code text CHECK (fail_code IN ('not_friend', 'cannot_send', 'skill_error', 'event_setup', 'wallet', 'limit', 'kakao_error', 'unknown'));
ALTER TABLE owner_alerts
  DROP CONSTRAINT owner_alerts_status_check,
  ADD CONSTRAINT owner_alerts_status_check CHECK (status IN ('pending', 'confirming', 'sent', 'not_friend', 'failed', 'batched')),
  ADD CONSTRAINT owner_alerts_kakao_task_chk CHECK (status NOT IN ('confirming', 'sent') OR (kakao_task_id IS NOT NULL AND requested_at IS NOT NULL));
CREATE INDEX owner_alerts_confirming_idx ON owner_alerts (requested_at) WHERE status = 'confirming';

-- TBL-044 notifications: 발송 결과 확인 중, 카카오 taskId와 결과
ALTER TABLE notifications
  ADD COLUMN kakao_task_id text CHECK (char_length(kakao_task_id) BETWEEN 1 AND 100),
  ADD COLUMN requested_at timestamptz,
  ADD COLUMN delivery_checked_at timestamptz,
  ADD COLUMN fail_code text CHECK (fail_code IN ('not_friend', 'cannot_send', 'skill_error', 'event_setup', 'wallet', 'limit', 'kakao_error', 'unknown'));
ALTER TABLE notifications
  DROP CONSTRAINT notifications_status_check,
  ADD CONSTRAINT notifications_status_check CHECK (status IN ('pending', 'retrying', 'confirming', 'sent', 'deferred', 'delivered_on_reply', 'dropped')),
  ADD CONSTRAINT notifications_kakao_task_chk CHECK (status NOT IN ('confirming', 'sent') OR (kakao_task_id IS NOT NULL AND requested_at IS NOT NULL));
CREATE INDEX notifications_confirming_idx ON notifications (requested_at) WHERE status = 'confirming';

-- 테이블·컬럼 설명(db/schema.sql과 같은 줄)
COMMENT ON TABLE owner_alerts IS 'TBL-043 사장님 알림(TERM-035): 우리 서비스 채널 봇이 사장님의 카카오 로그인 사용자 번호로 보내는 할 일 종류와 목록 주소';
COMMENT ON COLUMN owners.kakao_account_id IS '카카오 로그인 사용자 번호. 사장님 알림을 보내는 Event API의 appUserId(SPEC-067, REQ-183). 카카오 토큰은 어디에도 두지 않음(SPEC-001, REQ-135)';
COMMENT ON COLUMN owners.alert_channel_friend IS '우리 서비스 채널 친구인지. 로그인 때의 채널 관계 조회와 알림 발송 결과로 고침. 아니면 알림은 ''못 보냄''으로 할 일 목록에만(SPEC-067)';
COMMENT ON COLUMN owners.alert_friend_checked_at IS '우리 채널 친구인지 마지막으로 본 시각(채널 관계 조회나 발송 결과, SPEC-001)';
COMMENT ON COLUMN kakao_channels.check_started_at IS '''연결 확인''을 누른 시각(10분 안에 테스트 메시지와 버튼 블록 넷이 와야 함)';
COMMENT ON COLUMN kakao_channels.card_block_id IS '가게 봇의 ''확인 카드'' 블록 ID. 확인 카드 버튼이 부름(SPEC-008, REQ-179)';
COMMENT ON COLUMN kakao_channels.orderer_block_id IS '가게 봇의 ''주문자 정보'' 블록 ID. 주문자 정보 카드 버튼이 부름(SPEC-072)';
COMMENT ON COLUMN kakao_channels.depositor_block_id IS '가게 봇의 ''입금자 이름'' 블록 ID. 입금 알리기 카드 버튼이 부름(SPEC-033)';
COMMENT ON COLUMN kakao_channels.review_block_id IS '가게 봇의 ''후기'' 블록 ID. 후기 부탁 버튼이 부름(SPEC-061)';
COMMENT ON COLUMN kakao_channels.verified_blocks IS '연결 확인 때 시험 버튼으로 우리 스킬에 닿은 블록(REQ-179)';
COMMENT ON COLUMN kakao_channels.test_user_key IS '연결 확인 때 테스트 메시지를 보낸 사용자 키. 시험 버튼과 시험 안내를 이 사용자로 함(SPEC-008)';
COMMENT ON COLUMN kakao_channels.event_status IS '먼저 보내기(Event API): 아직 안 봄·시험 중·됨·안 됨. 안 되면 손님 안내는 다음 대화 때(REQ-180, REQ-181)';
COMMENT ON COLUMN kakao_channels.event_task_id IS '시험 안내의 카카오 taskId. 발송 결과 조회에 씀(REQ-182)';
COMMENT ON COLUMN kakao_channels.event_checked_at IS '시험 안내의 발송 결과를 받은 시각';
COMMENT ON COLUMN kakao_channels.event_fail_reason IS '먼저 보내기가 안 되는 사유: 채널이 우리 앱에 연결 안 됨·월렛 없음·이벤트 이름이나 배포·안내 스킬·사장님이 가게 채널 친구 아님·닿지 않음·카카오 오류';
COMMENT ON COLUMN owner_alerts.status IS '보낼 것·발송 결과 확인 중·보냄(닿음 확인)·우리 채널 친구가 아님·실패(할 일 목록에만)·다른 알림에 묶임';
COMMENT ON COLUMN owner_alerts.kakao_task_id IS '카카오가 받은 Event API 요청의 taskId. 발송 결과 조회에 씀(SPEC-067, REQ-182)';
COMMENT ON COLUMN owner_alerts.requested_at IS '카카오가 Event API 요청을 받은 시각';
COMMENT ON COLUMN owner_alerts.delivery_checked_at IS '발송 결과를 마지막으로 조회한 시각(1분·5분·30분 뒤)';
COMMENT ON COLUMN owner_alerts.fail_code IS '카카오가 받지 않거나 전하지 못한 사유. unknown은 30분 뒤에도 결과를 모름(SPEC-067)';
COMMENT ON COLUMN notifications.status IS '보낼 것·다시 보낼 것·발송 결과 확인 중·보냄(닿음 확인)·못 보냄(다음 대화 때 먼저)·다음 대화 때 전함·무의미해져 안 보냄';
COMMENT ON COLUMN notifications.kakao_task_id IS '카카오가 받은 Event API 요청의 taskId. 발송 결과 조회에 씀(SPEC-066, REQ-182)';
COMMENT ON COLUMN notifications.requested_at IS '카카오가 Event API 요청을 받은 시각';
COMMENT ON COLUMN notifications.delivery_checked_at IS '발송 결과를 마지막으로 조회한 시각(1분·5분·30분 뒤)';
COMMENT ON COLUMN notifications.fail_code IS '카카오가 받지 않거나 전하지 못한 사유. unknown은 30분 뒤에도 결과를 모름(SPEC-066)';
