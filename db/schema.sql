-- 수제케이크 주문제작: 데이터베이스 스키마 (CORTHEX 05단계 ERD)
--
-- 원본: 이 파일. 사람이 보는 곳: docs/05-erd/README.md(컨텍스트별 다이어그램과 테이블).
-- 입력: docs/04-functional-spec/spec.md(SPEC-001~071, 상태 머신 1-1~1-8, 공통 규칙 G1~G9, AI-1),
--       docs/01-domain/domain.md(CTX-001~009, TERM-001~074), docs/02-prd/requirements.md(REQ-001~174).
-- 데이터베이스: PostgreSQL. 16에서 검사함(research/cake-erd-2026-11/check_erd.py).
-- 바꾸는 법: 이 파일을 고치고 같은 변경을 db/migrations/에 새 번호로 더함. 적용한 마이그레이션은 고치지 않음.
--
-- 읽는 법
-- - 테이블마다 위에 "-- TBL-번호 이름 (컨텍스트) ← 그 테이블을 읽고 쓰는 SPEC | terms: 용어 ID" 한 줄이 있음.
--   테이블마다 COMMENT ON TABLE도 TBL 번호로 시작함. 테이블 순서는 만드는 순서(참조하는 테이블이 먼저)라 컨텍스트가 섞임.
--   컨텍스트별 목록과 테이블이 없는 용어는 맨 아래.
-- - 이름: 영어 snake_case, 테이블은 복수형. 용어집 코드 이름(TERM)에서 땀. 상태 값도 영어, 한국어 이름은 컬럼 설명에.
-- - 기본 키: 모두 uuid. 손님에게 보이는 번호는 주문번호(orders.order_no) 하나뿐(G6).
-- - 가게 나누기(G1, SPEC-068): 가게에 딸린 테이블은 모두 shop_id를 갖고, 다른 테이블을 (shop_id, 대상_id)로 참조함.
--   그래서 한 가게의 행이 다른 가게의 행을 참조할 수 없음. 참조되는 테이블은 UNIQUE (shop_id, id)를 둠. 가격표 버전에 딸린
--   옵션·도안은 (가격표 버전, 대상_id)로, 여러 값을 고르는 참조(더하는 옵션)는 연결 테이블의 행으로, 함께 맞아야 하는 쌍(상담과
--   손님)은 쌍으로 참조함(설계 재검토 M17).
-- - 시각: timestamptz(UTC로 저장, 계산은 가게 시간대, G8). 날짜만 쓰는 곳(자리·목록)은 가게 시간대의 date.
-- - 돈: 원 단위 정수(integer). 우리는 손님 돈을 받거나 보관하지 않음(REQ-079): 결제·환불 테이블은 가게 계좌에서 일어난 일의 기록.
-- - 외래 키를 지울 때: 모두 ON DELETE RESTRICT. 기록을 지우는 일은 보존 작업(SPEC-065)이 딸린 행부터 직접 함.
-- - 버전(TERM-005): 가격표·운영규정·주문 내용의 version. 이전 버전은 지우지 않음(REQ-027).
-- - 같은 요청 거르기(G2): 카카오 메시지 ID(messages), 카드 키(confirm_cards), 화면 키(request_keys: 요청 지문·처리 상태·
--   처음 결과, 06 DEC-04), 자동으로 하는 일의 이벤트 키(각 테이블의 event_key·hold_key, 형식은 docs/05-erd/README.md 4절 A33).
--   돈이 오가는 기록은 대상마다 하나를 UNIQUE로도 막음(환불의 취소한 주문·변경 요청·문제 신고·결제 안내, 결제 안내마다 확인된 결제
--   하나, 주문을 확정한 결제 orders.confirmed_payment_id, 설계 재검토 M7).
-- - 시크릿(토큰·키·비밀번호)은 어느 테이블에도 두지 않음(REQ-135). 시크릿 저장소의 이름만 둠.
-- - 앱이 지키는 규칙: 테이블 하나로 말할 수 없는 규칙(주문 확정은 결제 확인으로만(데이터베이스는 주문을 확정한 결제를 봄), 환불 합 ≤ 받은 금액,
--   하루 최대 개수 넘기지 않기 등)은 docs/05-erd/README.md 4절에 모아 두고 12단계 테스트로 봄.

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- refund_tiers의 기간 중복 막기(EXCLUDE)에 씀

-- TBL-001 owners (CTX-007) ← SPEC-001, SPEC-067 | terms: TERM-044
CREATE TABLE owners (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 사장님 ID
  kakao_account_id      bigint NOT NULL,                    -- 카카오 로그인 사용자 번호. 사장님 알림을 보내는 Event API의 appUserId(SPEC-067, REQ-183). 카카오 토큰은 어디에도 두지 않음(SPEC-001, REQ-135)
  alert_channel_friend  boolean NOT NULL DEFAULT false,     -- 우리 서비스 채널 친구인지. 로그인 때의 채널 관계 조회와 알림 발송 결과로 고침. 아니면 알림은 '못 보냄'으로 할 일 목록에만(SPEC-067)
  alert_friend_checked_at timestamptz,                      -- 우리 채널 친구인지 마지막으로 본 시각(채널 관계 조회나 발송 결과, SPEC-001)
  last_login_at         timestamptz,                        -- 마지막 로그인 시각
  created_at            timestamptz NOT NULL DEFAULT now(), -- 처음 들어온 시각
  CONSTRAINT owners_kakao_account_uq UNIQUE (kakao_account_id) -- 카카오 계정 하나에 사장님 하나(R2)
);
COMMENT ON TABLE owners IS 'TBL-001 사장님(TERM-044): 카카오 로그인으로 들어오는 가게 주인';

-- TBL-002 operators (CTX-007) ← SPEC-001, SPEC-003, SPEC-078 | terms: TERM-074
CREATE TABLE operators (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 운영자 ID
  email            text NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'), -- 운영자 계정 이메일. 비밀번호·2단계 인증 키는 인증 서비스나 시크릿 저장소에(REQ-135)
  display_name     text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40), -- 화면에 보일 이름
  mfa_enrolled_at  timestamptz,                        -- 2단계 인증을 켠 시각. 빈 동안 운영자 화면에 못 들어옴(R2)
  disabled_at      timestamptz,                        -- 계정을 막은 시각
  created_at       timestamptz NOT NULL DEFAULT now()  -- 만든 시각
);
CREATE UNIQUE INDEX operators_email_uq ON operators (lower(email)); -- 이메일 하나에 운영자 하나
COMMENT ON TABLE operators IS 'TBL-002 운영자(TERM-074): 우리 서비스 쪽 사람, 영업 신고를 눈으로 확인';

-- TBL-003 shops (CTX-007) ← SPEC-001, SPEC-002, SPEC-003, SPEC-006, SPEC-009, SPEC-010, SPEC-011, SPEC-017, SPEC-024, SPEC-025, SPEC-036, SPEC-052, SPEC-053, SPEC-068, SPEC-073, SPEC-077, SPEC-078 | terms: TERM-053
CREATE TABLE shops (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 가게 ID. 모든 기록이 이 값으로 나뉨(SPEC-068)
  owner_id                  uuid NOT NULL REFERENCES owners (id) ON DELETE RESTRICT, -- 가게 주인
  name                      text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40), -- 가게 이름
  contact_phone             text NOT NULL CHECK (contact_phone ~ '^[0-9-]{8,14}$'), -- 가게 연락처(전화번호). 예약 링크 페이지의 가게 신원 정보(REQ-239). 사장님이 가게 설정에서 바로 고침(REQ-244)
  contact_email             text NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 100 AND contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'), -- 전자우편주소. 예약 링크 페이지의 가게 신원 정보(REQ-239). 사장님이 가게 설정에서 바로 고침(REQ-244)
  business_address          text NOT NULL CHECK (char_length(business_address) BETWEEN 1 AND 200), -- 사업장 주소. 예약 링크 페이지와 확정 안내의 가게 신원 정보(REQ-239, REQ-242). 픽업 장소와 다를 수 있음. 사장님이 가게 설정에서 바로 고침(REQ-244)
  pickup_address            text CHECK (char_length(pickup_address) BETWEEN 1 AND 200), -- 픽업 장소(가게 위치). 전날 안내에 포함함(SPEC-052). 등록 필드(SPEC-002)에 없어 가게 설정에서 받음(SPEC-077)
  business_name             text NOT NULL CHECK (char_length(business_name) BETWEEN 1 AND 60), -- 상호. 등록 뒤에는 변경 요청을 운영자가 반영해야 바뀜(REQ-245, TBL-058)
  representative_name       text NOT NULL CHECK (char_length(representative_name) BETWEEN 1 AND 30), -- 대표자 성명. 등록 뒤에는 변경 요청을 운영자가 반영해야 바뀜(REQ-245, TBL-058)
  business_reg_no           text NOT NULL CHECK (business_reg_no ~ '^[0-9]{10}$'), -- 사업자등록번호(검증 숫자는 앱이 봄). 중복돼도 받고 운영자 화면에 중복 표시(SPEC-002). 등록 뒤에는 변경 요청을 운영자가 반영해야 바뀜(REQ-245)
  mail_order_reg_no         text CHECK (char_length(mail_order_reg_no) BETWEEN 1 AND 40), -- 통신판매업 신고번호
  mail_order_authority      text CHECK (char_length(mail_order_authority) BETWEEN 1 AND 40), -- 통신판매업 신고를 받은 기관(예: 서울특별시 마포구청). 신고번호와 함께 있음(REQ-239)
  mail_order_exemption      text CHECK (char_length(mail_order_exemption) BETWEEN 1 AND 200), -- 신고번호 대신 면제 사유
  food_license_no           text NOT NULL CHECK (char_length(food_license_no) BETWEEN 1 AND 30), -- 영업 신고 번호
  food_business_type        text NOT NULL CHECK (food_business_type IN ('instant_sale_manufacturing', 'bakery')), -- 영업 종류: 즉석판매제조·가공업, 제과점영업. 그 밖은 첫 버전에서 받지 않음
  license_photo_key         text NOT NULL,                     -- 신고증 사진 저장 위치. 그 가게 사장님과 운영자만 봄(G1, G6)
  license_status            text NOT NULL DEFAULT 'pending' CHECK (license_status IN ('pending', 'on_hold', 'verified')), -- 영업 신고: 확인 기다림·보류·확인됨(SPEC-003). 확인됨은 결제 계좌가 있고 그 예금주가 대표자·상호와 같은지 운영자가 본 뒤(REQ-197, 4절 A25)
  license_hold_reason       text CHECK (char_length(license_hold_reason) BETWEEN 1 AND 200), -- 보류 이유. 사장님은 자기 가게의 상태와 이 이유만 봄
  license_reviewed_by       uuid REFERENCES operators (id) ON DELETE RESTRICT, -- 마지막으로 확인·보류한 운영자
  license_reviewed_at       timestamptz,                       -- 마지막으로 확인·보류한 시각
  entrustment_terms_version text NOT NULL CHECK (char_length(entrustment_terms_version) BETWEEN 1 AND 20), -- 동의한 개인정보 처리 위탁·재위탁 조건의 버전(REQ-107). 동의 없이는 가게가 생기지 않음
  entrustment_consented_at  timestamptz NOT NULL,              -- 그 조건에 동의한 시각
  time_zone                 text NOT NULL DEFAULT 'Asia/Seoul', -- 가게 시간대. 시각 계산은 이 시간대로(G8)
  completion_photo_enabled  boolean NOT NULL DEFAULT false,    -- 완성 사진 보내기(SPEC-009, 기본 꺼짐)
  idle_close_hours          smallint NOT NULL DEFAULT 24 CHECK (idle_close_hours BETWEEN 1 AND 720), -- 문의 끊김까지 시간(REQ-211, 기본 24시간). 사장님이 바꾸면 저장한 때부터 씀(REQ-243)
  owner_wait_minutes        smallint NOT NULL DEFAULT 120 CHECK (owner_wait_minutes BETWEEN 10 AND 1440), -- 사장님 답 기다리는 시간(REQ-116, 기본 2시간). 바꾸면 그 뒤 시작된 기다림부터(owner_tasks.wait_due_at, REQ-243)
  daily_ai_cost_limit_krw   integer NOT NULL DEFAULT 5000 CHECK (daily_ai_cost_limit_krw BETWEEN 0 AND 1000000), -- 하루 AI 비용 한도(REQ-163, 기본 5,000원). 사장님이 정하고 바꾸면 저장한 때부터 그날 쓴 비용과 견줌(REQ-243)
  booking_slug              text CHECK (booking_slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'), -- 예약 링크(TERM-042) 주소의 가게 몫. 낸 뒤 바뀌지 않음(SPEC-010)
  booking_issued_at         timestamptz,                       -- 예약 링크를 낸 시각
  created_at                timestamptz NOT NULL DEFAULT now(), -- 등록한 시각
  updated_at                timestamptz NOT NULL DEFAULT now(), -- 마지막으로 고친 시각
  CONSTRAINT shops_one_per_owner UNIQUE (owner_id),            -- 카카오 계정 하나에 가게 하나(R2, SPEC-002)
  CONSTRAINT shops_booking_slug_uq UNIQUE (booking_slug),      -- 가게마다 하나인 예약 링크
  CONSTRAINT shops_mail_order_chk CHECK (mail_order_reg_no IS NOT NULL OR mail_order_exemption IS NOT NULL), -- 통신판매업 신고번호나 면제 사유(REQ-239)
  CONSTRAINT shops_mail_order_authority_chk CHECK ((mail_order_reg_no IS NULL) = (mail_order_authority IS NULL)), -- 신고번호와 신고를 받은 기관은 함께(REQ-239)
  CONSTRAINT shops_hold_reason_chk CHECK ((license_status = 'on_hold') = (license_hold_reason IS NOT NULL)), -- 보류에는 이유가 있음(SPEC-003)
  CONSTRAINT shops_reviewed_chk CHECK (license_status = 'pending' OR (license_reviewed_by IS NOT NULL AND license_reviewed_at IS NOT NULL)), -- 확인·보류는 운영자와 시각을 남김
  CONSTRAINT shops_booking_needs_license CHECK (booking_slug IS NULL OR license_status = 'verified'), -- 영업 신고 확인 전에는 예약 링크 없음(REQ-103)
  CONSTRAINT shops_booking_issued_chk CHECK ((booking_slug IS NULL) = (booking_issued_at IS NULL))
);
CREATE INDEX shops_business_reg_no_idx ON shops (business_reg_no); -- 같은 사업자등록번호 중복 표시(SPEC-002)
CREATE INDEX shops_license_queue_idx ON shops (created_at) WHERE license_status = 'pending'; -- 운영자 확인 목록(SPEC-003)
COMMENT ON TABLE shops IS 'TBL-003 가게(TERM-053): 가게 신원 정보·영업 신고·처리 위탁 동의·예약 링크와 가게가 정하는 시간 값';

-- TBL-004 kakao_channels (CTX-007) ← SPEC-008, SPEC-010, SPEC-011, SPEC-017, SPEC-066, SPEC-068, SPEC-075 | terms: TERM-053
CREATE TABLE kakao_channels (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 채널 연결 ID
  shop_id            uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT, -- 채널을 묶은 가게
  bot_id             text NOT NULL,                      -- 오픈빌더 봇 ID. 스킬 요청에서 가게를 찾는 키(SPEC-017)
  channel_public_id  text,                               -- 채널 공개 ID. 예약 링크 페이지의 문의 버튼이 여는 채팅 주소(SPEC-011)
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'linked', 'failed', 'retired')), -- 연결 확인 중·연결됨·연결 안 됨·바꿔서 그만 받음(SPEC-008)
  check_started_at   timestamptz,                        -- '연결 확인'을 누른 시각(10분 안에 연결 문구와 버튼 블록 다섯이 와야 함)
  linked_at          timestamptz,                        -- 연결됨이 된 시각
  retired_at         timestamptz,                        -- 다른 채널로 바꿔 더 받지 않게 된 시각
  card_block_id      text CHECK (char_length(card_block_id) BETWEEN 1 AND 100), -- 가게 봇의 '확인 카드' 블록 ID. 확인 카드 버튼이 부름(SPEC-008, REQ-206)
  orderer_block_id   text CHECK (char_length(orderer_block_id) BETWEEN 1 AND 100), -- 가게 봇의 '주문자 정보' 블록 ID. 주문자 정보 카드 버튼이 부름(SPEC-072)
  allergy_block_id   text CHECK (char_length(allergy_block_id) BETWEEN 1 AND 100), -- 가게 봇의 '알레르기 답' 블록 ID. 알레르기 정보 동의 카드의 버튼이 부르고 AI를 거치지 않고 답을 받음(SPEC-075, REQ-202, REQ-206)
  depositor_block_id text CHECK (char_length(depositor_block_id) BETWEEN 1 AND 100), -- 가게 봇의 '입금자 이름' 블록 ID. 결제 확인 요청 카드 버튼이 부름(SPEC-033)
  review_block_id    text CHECK (char_length(review_block_id) BETWEEN 1 AND 100), -- 가게 봇의 '후기' 블록 ID. 후기 부탁 버튼이 부름(SPEC-061)
  verified_blocks    text[] NOT NULL DEFAULT '{}' CHECK (verified_blocks <@ ARRAY['card', 'orderer_info', 'allergy_answer', 'depositor_name', 'review']::text[]), -- 연결 확인 때 시험 버튼으로 우리 스킬에 닿은 블록(REQ-206)
  test_user_key      text CHECK (char_length(test_user_key) BETWEEN 1 AND 100), -- 연결 확인 때 연결 문구를 보낸 사용자 키. 시험 버튼과 시험 안내를 이 사용자로 함(SPEC-008, REQ-238)
  event_status       text NOT NULL DEFAULT 'unchecked' CHECK (event_status IN ('unchecked', 'checking', 'ready', 'unavailable')), -- 먼저 보내기(Event API): 아직 안 봄·시험 중·됨·안 됨. 안 되면 손님 안내는 다음 대화 때(REQ-180, REQ-181)
  event_task_id      text CHECK (char_length(event_task_id) BETWEEN 1 AND 100), -- 시험 안내의 카카오 taskId. 발송 결과 조회에 씀(REQ-182)
  event_checked_at   timestamptz,                        -- 시험 안내의 발송 결과를 받은 시각
  event_fail_reason  text CHECK (event_fail_reason IN ('app_not_linked', 'wallet_missing', 'event_block', 'event_skill', 'owner_not_friend', 'not_delivered', 'kakao_error')), -- 먼저 보내기가 안 되는 사유: 채널이 우리 앱에 연결 안 됨·월렛 없음·이벤트 이름이나 배포·안내 스킬·사장님이 가게 채널 친구 아님·닿지 않음·카카오 오류
  skill_key_version  smallint NOT NULL DEFAULT 1 CHECK (skill_key_version BETWEEN 1 AND 10000), -- 스킬 키 버전. 키는 서버 시크릿·연결 ID·버전으로 만들고 저장하지 않음(06단계 DEC-08). 사장님이 바꿀 때마다 1 늘림(REQ-237)
  skill_key_issued_at timestamptz NOT NULL DEFAULT now(), -- 지금 버전의 스킬 키를 만든 시각(REQ-237)
  previous_key_until timestamptz,                        -- 바로 앞 버전의 키도 받는 끝 시각: 바꾼 때부터 24시간까지. 바로 끊었거나 바꾼 적이 없으면 비움(REQ-237)
  claim_expires_at   timestamptz,                        -- '연결 확인 중' 선점이 풀리는 시각: 마지막 저장이나 연결 확인 시작에서 30분. 지난 뒤 다른 가게가 같은 봇을 넣으면 이 연결은 '연결 안 됨'(REQ-238)
  created_at         timestamptz NOT NULL DEFAULT now(), -- 만든 시각
  CONSTRAINT kakao_channels_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT kakao_channels_linked_chk CHECK (status <> 'linked' OR linked_at IS NOT NULL),
  CONSTRAINT kakao_channels_retired_chk CHECK ((status = 'retired') = (retired_at IS NOT NULL)),
  CONSTRAINT kakao_channels_blocks_chk CHECK (status <> 'linked' OR (card_block_id IS NOT NULL AND orderer_block_id IS NOT NULL AND allergy_block_id IS NOT NULL AND depositor_block_id IS NOT NULL AND review_block_id IS NOT NULL AND verified_blocks @> ARRAY['card', 'orderer_info', 'allergy_answer', 'depositor_name', 'review']::text[])), -- 연결됨이면 블록 ID 다섯이 있고 시험 버튼으로 모두 닿음(REQ-206)
  CONSTRAINT kakao_channels_event_chk CHECK ((event_status = 'unavailable') = (event_fail_reason IS NOT NULL) AND (event_status <> 'checking' OR event_task_id IS NOT NULL) AND (event_status NOT IN ('ready', 'unavailable') OR event_checked_at IS NOT NULL) AND (event_status = 'unchecked' OR status IN ('linked', 'retired'))), -- 시험 안내는 연결된 뒤. 안 됨에는 사유, 시험 중에는 taskId, 결과에는 받은 시각(REQ-180)
  CONSTRAINT kakao_channels_prev_key_chk CHECK (previous_key_until IS NULL OR (skill_key_version >= 2 AND previous_key_until <= skill_key_issued_at + interval '24 hours')), -- 앞 버전 키는 키를 바꾼 뒤 24시간까지만(REQ-237)
  CONSTRAINT kakao_channels_claim_chk CHECK ((status = 'pending') = (claim_expires_at IS NOT NULL)) -- 선점이 풀리는 시각은 연결 확인 중에만 있음(REQ-238)
);
CREATE UNIQUE INDEX kakao_channels_bot_active_uq ON kakao_channels (bot_id) WHERE status IN ('pending', 'linked'); -- 채널 하나는 가게 하나에만('이미 다른 가게', SPEC-008)
CREATE UNIQUE INDEX kakao_channels_one_linked_per_shop ON kakao_channels (shop_id) WHERE status = 'linked'; -- 가게마다 받는 채널 하나
COMMENT ON TABLE kakao_channels IS 'TBL-004 카카오톡 채널 연결: 손님 메시지를 받는 가게 채널';

-- TBL-005 privacy_policies (CTX-007) ← SPEC-010, SPEC-011, SPEC-018 | terms: none
CREATE TABLE privacy_policies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 처리방침 버전 ID
  shop_id             uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT, -- 처리방침의 가게
  version             integer NOT NULL CHECK (version >= 1), -- 버전. 바뀌면 새 버전
  body                text NOT NULL CHECK (char_length(body) >= 1), -- 처리방침 글
  overseas_transfers  jsonb NOT NULL,                     -- 국외 이전 다섯 항목. 받는 자마다 옮기는 개인정보, 나라·시기·방법, 받는 자, 목적·보유 기간, 거부 방법·절차와 결과(REQ-141)
  published_at        timestamptz NOT NULL DEFAULT now(), -- 낸 시각. 가장 최근 버전을 예약 링크 페이지와 AI 상담 고지에 게시함(REQ-140)
  CONSTRAINT privacy_policies_version_uq UNIQUE (shop_id, version),
  CONSTRAINT privacy_policies_transfers_chk CHECK (CASE WHEN jsonb_typeof(overseas_transfers) = 'array' THEN jsonb_array_length(overseas_transfers) >= 1 ELSE false END) -- 항목이 비면 예약 링크를 내지 않음(SPEC-010)
);
COMMENT ON TABLE privacy_policies IS 'TBL-005 가게 개인정보 처리방침: 국외 이전 다섯 항목 포함, 버전으로 남김';

-- TBL-006 price_lists (CTX-002) ← SPEC-004, SPEC-010, SPEC-011, SPEC-013, SPEC-027 | terms: TERM-047
CREATE TABLE price_lists (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 가격표 버전 ID
  shop_id        uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT, -- 가격표의 가게
  version        integer NOT NULL CHECK (version >= 1), -- 버전(TERM-005). 저장할 때마다 하나 오르고, 바꾼 것이 없으면 새 버전 없음(SPEC-004)
  created_at     timestamptz NOT NULL DEFAULT now(),    -- 이 버전을 저장한 시각
  superseded_at  timestamptz,                           -- 새 버전이 생겨 '이전 버전'이 된 시각. 빈 값이 현재 버전. 이전 버전은 읽기만(REQ-027)
  CONSTRAINT price_lists_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT price_lists_version_uq UNIQUE (shop_id, version)
);
CREATE UNIQUE INDEX price_lists_one_current ON price_lists (shop_id) WHERE superseded_at IS NULL; -- 가게마다 현재 버전 하나
COMMENT ON TABLE price_lists IS 'TBL-006 가격표(TERM-047) 버전: 옵션·옵션 규칙·도안을 버전으로 묶음';

-- TBL-007 price_options (CTX-002) ← SPEC-004, SPEC-011, SPEC-013 | terms: TERM-047
CREATE TABLE price_options (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 옵션 ID
  shop_id        uuid NOT NULL,                          -- 가게
  price_list_id  uuid NOT NULL,                          -- 가격표 버전
  option_group   text NOT NULL CHECK (option_group IN ('size', 'flavor', 'design', 'extra')), -- 크기·맛·디자인·더하는 옵션
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30), -- 옵션 이름
  price_kind     text NOT NULL DEFAULT 'fixed' CHECK (price_kind IN ('fixed', 'from', 'range')), -- 값 표시: 확정·부터·범위
  amount         integer NOT NULL CHECK (amount BETWEEN 0 AND 10000000), -- 값(원). 범위면 아래 끝
  amount_max     integer CHECK (amount_max BETWEEN 0 AND 10000000), -- 범위의 위 끝
  in_standard    boolean NOT NULL DEFAULT true,          -- 기본 디자인 범위 안인지: 사장님이 옵션마다 고르고 가격표 버전에 함께 남음. 값이 '확정'인 옵션만 넣음(price_options_standard_fixed_chk). 범위 밖 옵션을 고르면 맞춤 주문(SPEC-004, SPEC-013, REQ-228, REQ-229)
  position       smallint NOT NULL DEFAULT 0,            -- 보이는 순서
  CONSTRAINT price_options_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT price_options_list_scope UNIQUE (price_list_id, id),
  CONSTRAINT price_options_group_key UNIQUE (price_list_id, id, option_group), -- 더하는 옵션 연결 테이블이 '더하는 옵션'만 참조하는 키(설계 재검토 M17)
  CONSTRAINT price_options_list_fk FOREIGN KEY (shop_id, price_list_id) REFERENCES price_lists (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT price_options_name_uq UNIQUE (price_list_id, option_group, name),
  CONSTRAINT price_options_range_chk CHECK ((price_kind = 'range') = (amount_max IS NOT NULL) AND (amount_max IS NULL OR amount_max >= amount)),
  CONSTRAINT price_options_standard_fixed_chk CHECK (NOT in_standard OR price_kind = 'fixed') -- '부터'·'범위' 값의 옵션은 기본 디자인 범위에 넣지 않음(SPEC-004, REQ-228)
);
COMMENT ON TABLE price_options IS 'TBL-007 가격표 옵션: 크기·맛·디자인 옵션별 값';

-- TBL-008 price_option_rules (CTX-002) ← SPEC-004, SPEC-013 | terms: TERM-047
CREATE TABLE price_option_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 옵션 규칙 ID
  shop_id        uuid NOT NULL,                          -- 가게
  price_list_id  uuid NOT NULL,                          -- 가격표 버전
  rule_kind      text NOT NULL CHECK (rule_kind IN ('exclude', 'surcharge')), -- 함께 못 고름·함께 고르면 더하는 값
  option_a_id    uuid NOT NULL,                          -- 옵션 하나(같은 버전)
  option_b_id    uuid NOT NULL,                          -- 다른 옵션(같은 버전)
  amount         integer CHECK (amount BETWEEN 1 AND 10000000), -- 더하는 값(원)
  CONSTRAINT price_option_rules_list_fk FOREIGN KEY (shop_id, price_list_id) REFERENCES price_lists (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT price_option_rules_a_fk FOREIGN KEY (price_list_id, option_a_id) REFERENCES price_options (price_list_id, id) ON DELETE RESTRICT,
  CONSTRAINT price_option_rules_b_fk FOREIGN KEY (price_list_id, option_b_id) REFERENCES price_options (price_list_id, id) ON DELETE RESTRICT,
  CONSTRAINT price_option_rules_order_chk CHECK (option_a_id < option_b_id), -- 쌍은 한 순서로만 적음
  CONSTRAINT price_option_rules_pair_uq UNIQUE (price_list_id, option_a_id, option_b_id), -- 같은 조합이 허용이자 금지일 수 없음(SPEC-004)
  CONSTRAINT price_option_rules_amount_chk CHECK ((rule_kind = 'surcharge') = (amount IS NOT NULL))
);
COMMENT ON TABLE price_option_rules IS 'TBL-008 옵션 규칙: 함께 못 고르는 옵션과 더하는 값';

-- TBL-009 designs (CTX-002) ← SPEC-004, SPEC-011, SPEC-013 | terms: TERM-020
CREATE TABLE designs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 도안 ID
  shop_id          uuid NOT NULL,                        -- 가게
  price_list_id    uuid NOT NULL,                        -- 이 도안을 담은 가격표 버전(REQ-026)
  price_option_id  uuid,                                 -- 이 도안의 값을 정하는 디자인 옵션(같은 버전)
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30), -- 도안 이름
  image_key        text NOT NULL,                        -- 도안 그림 저장 위치(한 장 10MB, 버전마다 50장까지는 앱이 봄)
  in_standard      boolean NOT NULL DEFAULT true,        -- 기본 디자인 범위 안인지: 사장님이 도안마다 고르고 가격표 버전에 함께 남음. 값을 정하는 디자인 옵션이 범위 밖이면 넣지 않음(앱, SPEC-004, REQ-228)
  position         smallint NOT NULL DEFAULT 0,          -- 보이는 순서
  CONSTRAINT designs_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT designs_list_scope UNIQUE (price_list_id, id),
  CONSTRAINT designs_list_fk FOREIGN KEY (shop_id, price_list_id) REFERENCES price_lists (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT designs_option_fk FOREIGN KEY (price_list_id, price_option_id) REFERENCES price_options (price_list_id, id) ON DELETE RESTRICT,
  CONSTRAINT designs_name_uq UNIQUE (price_list_id, name)
);
COMMENT ON TABLE designs IS 'TBL-009 도안(TERM-020): 가게가 그릴 수 있게 정해 둔 그림, 가격표 버전에 담음';

-- TBL-010 operating_rules (CTX-002) ← SPEC-005, SPEC-010, SPEC-013, SPEC-016, SPEC-029, SPEC-032, SPEC-040, SPEC-041, SPEC-042, SPEC-043, SPEC-058 | terms: TERM-017
CREATE TABLE operating_rules (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 운영규정 버전 ID
  shop_id                     uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT, -- 가게
  version                     integer NOT NULL CHECK (version >= 1), -- 버전(TERM-005). 받은 주문은 그때 버전을 따름(REQ-030)
  quote_valid_hours           smallint NOT NULL DEFAULT 72 CHECK (quote_valid_hours BETWEEN 1 AND 720), -- 견적 유효 기한(REQ-034, 기본 안내 뒤 72시간)
  payment_due_hours           smallint NOT NULL DEFAULT 12 CHECK (payment_due_hours BETWEEN 1 AND 720), -- 결제 기한(TERM-030, REQ-218): 결제 안내가 손님에게 전해진 뒤 기본 12시간, 결제 기한 상한까지
  issue_report_hours          smallint NOT NULL DEFAULT 24 CHECK (issue_report_hours BETWEEN 1 AND 720), -- 문제 신고 기한(REQ-072, 기본 받은 뒤 24시간)
  change_deadline_hours       smallint NOT NULL CHECK (change_deadline_hours BETWEEN 1 AND 720), -- 변경 마감: 픽업 일시 몇 시간 전까지(SPEC-041). 기본값 없음, 가게가 넣음
  cancellation_fee_krw        integer NOT NULL DEFAULT 0 CHECK (cancellation_fee_krw BETWEEN 0 AND 10000000), -- 고정 취소 수수료(TERM-016), 0원~1,000만 원. 저장할 때는 주문 금액과 견주지 않고, 환불 계산에서 비율보다 먼저 빼며 바탕보다 크면 환불 0원(SPEC-016, 4절 A30)
  pre_production_refund_pct   smallint NOT NULL DEFAULT 100 CHECK (pre_production_refund_pct BETWEEN 0 AND 100), -- 제작 전 취소의 환불 비율: 수수료를 뺀 값에 곱하고 원 미만 버림, 기본 전액(REQ-031). 단계별 환불이 없는 버전은 맞춤 재료 주문·제작 시작 뒤 취소에도 씀(SPEC-016)
  pre_production_lowered_ack  boolean NOT NULL DEFAULT false, -- 전액보다 낮출 때 위험과 근거를 보고 '그래도 저장'을 누름(REQ-032)
  date_change_refund_basis    text NOT NULL CHECK (date_change_refund_basis IN ('original_pickup', 'new_pickup')), -- 날짜를 바꾼 주문의 환불 기준일: 처음 픽업일(주문 내용 첫 버전의 픽업 일시)·바꾼 픽업일. 단계별 환불의 남은 시간을 이 픽업 일시까지로 셈(SPEC-016). 기본값 없음, 가게가 정함
  created_at                  timestamptz NOT NULL DEFAULT now(), -- 이 버전을 확정한 시각
  superseded_at               timestamptz,               -- 새 버전이 생긴 시각. 빈 값이 현재 버전
  CONSTRAINT operating_rules_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT operating_rules_version_uq UNIQUE (shop_id, version),
  CONSTRAINT operating_rules_lowered_chk CHECK (pre_production_refund_pct = 100 OR pre_production_lowered_ack) -- 낮추면 확인한 기록이 있어야 저장(REQ-032)
);
CREATE UNIQUE INDEX operating_rules_one_current ON operating_rules (shop_id) WHERE superseded_at IS NULL; -- 가게마다 현재 버전 하나
COMMENT ON TABLE operating_rules IS 'TBL-010 운영규정(TERM-017) 버전: 계산에 쓰는 기한·수수료·비율';

-- TBL-011 rule_clauses (CTX-002) ← SPEC-005, SPEC-016, SPEC-026, SPEC-028, SPEC-041, SPEC-046, SPEC-047, SPEC-048 | terms: TERM-017
CREATE TABLE rule_clauses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 조문 ID
  shop_id             uuid NOT NULL,                     -- 가게
  operating_rules_id  uuid NOT NULL,                     -- 운영규정 버전
  clause_key          text NOT NULL CHECK (clause_key IN ('pre_production_cancel', 'staged_refund', 'cancellation_fee', 'date_change_refund_basis', 'shop_cancel_compensation', 'other_shop_design', 'issue_report_window', 'quote_validity', 'payment_due', 'change_deadline', 'custom')), -- 템플릿의 조문 필드(REQ-031, REQ-033)나 가게가 더한 조문
  position            smallint NOT NULL CHECK (position >= 1), -- 조문 순서(제 몇 조)
  title               text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60), -- 조문 제목
  condition_text      text NOT NULL CHECK (char_length(condition_text) BETWEEN 1 AND 1000), -- 조건
  effect_text         text NOT NULL CHECK (char_length(effect_text) BETWEEN 1 AND 1000), -- 효과. AI가 인용할 때는 이 글자 그대로(AI-1 서버 확인)
  CONSTRAINT rule_clauses_rules_fk FOREIGN KEY (shop_id, operating_rules_id) REFERENCES operating_rules (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT rule_clauses_position_uq UNIQUE (operating_rules_id, position)
);
CREATE UNIQUE INDEX rule_clauses_one_per_key ON rule_clauses (operating_rules_id, clause_key) WHERE clause_key <> 'custom'; -- 템플릿의 조문 필드는 버전마다 하나
COMMENT ON TABLE rule_clauses IS 'TBL-011 운영규정 조문: 조문마다 조건과 효과(REQ-029)';

-- TBL-012 refund_tiers (CTX-002) ← SPEC-005, SPEC-016, SPEC-040 | terms: TERM-017
CREATE TABLE refund_tiers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 단계 ID
  shop_id             uuid NOT NULL,                     -- 가게
  operating_rules_id  uuid NOT NULL,                     -- 운영규정 버전
  hours_before_min    integer NOT NULL CHECK (hours_before_min BETWEEN 0 AND 8760), -- 취소가 기준 픽업 일시 몇 시간 전부터(이 값 포함). 남은 시간은 1시간 미만을 버림(SPEC-016)
  hours_before_max    integer CHECK (hours_before_max BETWEEN 1 AND 8760), -- 몇 시간 전까지(이 값 빼고). 빈 값은 그보다 이른 때 전부
  refund_pct          smallint NOT NULL CHECK (refund_pct BETWEEN 0 AND 100), -- 환불 비율
  CONSTRAINT refund_tiers_rules_fk FOREIGN KEY (shop_id, operating_rules_id) REFERENCES operating_rules (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT refund_tiers_span_chk CHECK (hours_before_max IS NULL OR hours_before_max > hours_before_min),
  CONSTRAINT refund_tiers_no_overlap EXCLUDE USING gist (operating_rules_id WITH =, int4range(hours_before_min, hours_before_max) WITH &&) -- 단계별 환불 기간이 중복되면 저장하지 않음(SPEC-005)
);
COMMENT ON TABLE refund_tiers IS 'TBL-012 단계별 환불: 기준 픽업 일시 몇 시간 전 취소면 몇 퍼센트. 버전마다 0시간부터 끝없음(빈 값)까지 빈 구간 없이 이어지고(앱, SPEC-005) 겹치지 않음(refund_tiers_no_overlap)';

-- TBL-013 business_calendars (CTX-002) ← SPEC-007, SPEC-010, SPEC-011, SPEC-012, SPEC-014, SPEC-024, SPEC-052, SPEC-061 | terms: TERM-048
CREATE TABLE business_calendars (
  shop_id                 uuid PRIMARY KEY REFERENCES shops (id) ON DELETE RESTRICT, -- 가게(가게마다 하나)
  closed_weekdays         smallint[] NOT NULL DEFAULT '{}' CHECK (closed_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]), -- 요일별 휴무(1=월 … 7=일)
  daily_capacity          smallint NOT NULL CHECK (daily_capacity BETWEEN 0 AND 100), -- 하루 최대 개수(TERM-026). 바꾼 값은 그 뒤 잡는 자리에만(R4)
  order_cutoff_days       smallint NOT NULL CHECK (order_cutoff_days BETWEEN 0 AND 30), -- 주문 마감(TERM-027): 픽업일 며칠 전
  order_cutoff_time       time NOT NULL,                 -- 주문 마감: 그날 몇 시
  reply_start             time NOT NULL DEFAULT '09:00', -- 답하는 시간 시작(REQ-118). 사장님 답 기다림은 이 안에서만 셈
  reply_end               time NOT NULL DEFAULT '21:00', -- 답하는 시간 끝
  day_before_notice_time  time NOT NULL DEFAULT '18:00' CHECK (day_before_notice_time BETWEEN '08:00' AND '20:50'), -- 전날 안내 시각(SPEC-052)
  review_request_time     time NOT NULL DEFAULT '11:00' CHECK (review_request_time BETWEEN '08:00' AND '20:50'), -- 후기 부탁 시각(SPEC-061, 인도한 다음 날). 바꾸면 아직 보내지 않은 후기 부탁부터 씀(REQ-243)
  updated_at              timestamptz NOT NULL DEFAULT now(), -- 마지막으로 바꾼 시각
  CONSTRAINT business_calendars_reply_chk CHECK (reply_start < reply_end) -- 시작이 끝보다 앞(SPEC-007)
);
COMMENT ON TABLE business_calendars IS 'TBL-013 영업 캘린더(TERM-048) 설정: 요일 휴무·하루 최대 개수·주문 마감·답하는 시간';

-- TBL-014 calendar_days (CTX-002) ← SPEC-007, SPEC-011, SPEC-012, SPEC-014, SPEC-015 | terms: TERM-048
CREATE TABLE calendar_days (
  shop_id             uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT, -- 가게
  day                 date NOT NULL,                     -- 가게 시간대의 날짜
  closed              boolean NOT NULL DEFAULT false,    -- 날짜별 휴무(요일 휴무는 business_calendars)
  capacity            smallint CHECK (capacity BETWEEN 0 AND 100), -- 그날만 다른 하루 최대 개수. 빈 값은 가게 기준
  manually_closed_at  timestamptz,                       -- 사장님이 누른 그날 주문 마감(SPEC-012). 빈 값이면 열림. 다 찬 날의 마감은 잡힌 자리를 세어서 앎
  updated_at          timestamptz NOT NULL DEFAULT now(), -- 마지막으로 바꾼 시각
  PRIMARY KEY (shop_id, day)                             -- 자리를 잡을 때 이 행을 잠가 하루 최대 개수를 넘지 않게 함(G3)
);
COMMENT ON TABLE calendar_days IS 'TBL-014 영업 캘린더 날짜 행: 날짜별 휴무·마감과 가예약의 잠금 행';

-- TBL-015 payment_accounts (CTX-004) ← SPEC-003, SPEC-006, SPEC-032, SPEC-078 | terms: none
CREATE TABLE payment_accounts (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 결제 수단 ID
  shop_id                    uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT, -- 가게
  bank_name                  text NOT NULL CHECK (char_length(bank_name) BETWEEN 1 AND 30), -- 은행
  account_number_enc         text NOT NULL CHECK (account_number_enc ~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{39,}$'), -- 가게 명의 계좌번호를 앱이 암호화한 값(키 버전:nonce·암호문·태그의 base64url, 5절 E20). 평문은 두지 않음(REQ-191). 숫자와 '-' 10~16자리 확인은 06단계 API가 함. 사장님 화면과 그 가게 손님의 결제 안내를 보일 때만 복호화하고, AI로는 마스킹함(SPEC-006)
  account_last4              text NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'), -- 계좌번호 끝 4자리. 운영자 화면은 이것만 보임(SPEC-003, SPEC-073)
  holder_name                text NOT NULL CHECK (char_length(holder_name) BETWEEN 1 AND 30), -- 예금주
  holder_mismatch_confirmed  boolean,                    -- 예금주가 상호·대표자와 다를 때 '가게 명의가 맞다'는 사장님 답. 같으면 빈 값
  holder_checked_by          uuid REFERENCES operators (id) ON DELETE RESTRICT, -- 영업 신고를 확인하며 예금주가 대표자·상호와 같은지 본 운영자(REQ-197, SPEC-003)
  holder_checked_at          timestamptz,                -- 예금주를 확인한 시각. 확인된 가게가 계좌를 바꾸면 새 예금주는 확인된 대표자·상호나 이 확인을 거친 예금주와 같아야 함(REQ-199, 4절 A25)
  card_payment_url           text CHECK (card_payment_url ~ '^https://'), -- 가게 명의 카드 결제 링크(있으면, REQ-078)
  created_at                 timestamptz NOT NULL DEFAULT now(), -- 등록한 시각
  retired_at                 timestamptz,                -- 바꿔서 그만 쓰게 된 시각. 이미 나간 결제 안내는 옛 행을 그대로 참조함
  CONSTRAINT payment_accounts_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT payment_accounts_holder_checked_chk CHECK ((holder_checked_by IS NULL) = (holder_checked_at IS NULL)) -- 예금주를 확인한 운영자와 시각은 함께
);
CREATE UNIQUE INDEX payment_accounts_one_current ON payment_accounts (shop_id) WHERE retired_at IS NULL; -- 가게마다 지금 쓰는 곳 하나
COMMENT ON TABLE payment_accounts IS 'TBL-015 결제 수단: 가게 명의 계좌(암호화)와 카드 결제 링크. 우리 회사 계좌는 어디에도 없음(REQ-079)';

-- TBL-016 customers (CTX-001) ← SPEC-017, SPEC-022, SPEC-029, SPEC-040, SPEC-065, SPEC-066, SPEC-068, SPEC-069 | terms: TERM-043
CREATE TABLE customers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 손님 ID
  shop_id            uuid NOT NULL,                      -- 가게
  kakao_channel_id   uuid NOT NULL,                      -- 메시지를 보낸 가게 채널
  kakao_user_key     text,                               -- 그 채널의 카카오 사용자 키. 손님 명령은 이 키로 구분함(G1). 상담이 모두 지워지고 주문이 모두 보관 기록이 되면 지움(SPEC-065, REQ-190)
  channel_friend     boolean NOT NULL DEFAULT false,     -- 채널 친구인지. 손님이 말을 걸 때마다 카카오가 알린 값으로 고치고 알리지 않았으면 친구 아님, 먼저 보낸 안내가 친구 아님으로 실패해도 친구 아님(REQ-219). 먼저 보내는 안내는 친구에게만(REQ-120)
  friend_checked_at  timestamptz,                        -- 친구 여부를 마지막으로 본 시각
  created_at         timestamptz NOT NULL DEFAULT now(), -- 처음 말을 건 시각
  purged_at          timestamptz,                        -- 카카오 사용자 키를 지운 시각(SPEC-065, REQ-190). 같은 사용자가 다시 말을 걸면 새 손님 행으로 받음
  CONSTRAINT customers_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT customers_channel_fk FOREIGN KEY (shop_id, kakao_channel_id) REFERENCES kakao_channels (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT customers_user_key_uq UNIQUE (kakao_channel_id, kakao_user_key), -- 채널의 사용자 키마다 손님 하나. 지운 키(빈 값)는 겹쳐도 됨
  CONSTRAINT customers_purged_chk CHECK ((kakao_user_key IS NULL) = (purged_at IS NOT NULL)) -- 키를 지운 손님에만 지운 시각(REQ-190)
);
COMMENT ON TABLE customers IS 'TBL-016 손님(TERM-043): 가게 채널의 카카오 사용자 하나. 이름·연락처는 주문 내용에만';

-- TBL-017 consultations (CTX-001) ← SPEC-017, SPEC-018, SPEC-022, SPEC-023, SPEC-025, SPEC-029, SPEC-065, SPEC-068, SPEC-073 | terms: TERM-046
CREATE TABLE consultations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 상담 ID(AI 호출 기록의 대화 ID)
  shop_id                   uuid NOT NULL,               -- 가게. 채널로 찾은 가게 ID로만 읽고 씀(SPEC-068)
  customer_id               uuid NOT NULL,               -- 손님
  status                    text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awaiting_owner', 'dropped', 'ordered', 'ended', 'deleted')), -- 열림·사장님 답 기다림·문의 끊김·주문으로 전환됨·상담 끝남·지워짐(1-1). 상담 끝남과 지워짐은 다시 열지 않고 손님의 다음 말은 새 상담(REQ-189)
  ai_disclosed_at           timestamptz,                 -- AI 상담 고지(TERM-041)를 보낸 시각(REQ-002). 상담마다 한 번, 이어가는 상담에는 다시 보내지 않음(R5)
  last_customer_message_at  timestamptz,                 -- 손님의 마지막 메시지 시각(문의 끊김 셈, REQ-211)
  dropped_at                timestamptz,                 -- 문의 끊김으로 닫은 시각(30일 지우기 셈, REQ-186)
  ended_at                  timestamptz,                 -- 상담 끝남으로 닫은 시각: 다룬 주문이 모두 끝나고 손님의 마지막 메시지 뒤 가게가 정한 시간이 지남(30일 지우기 셈, SPEC-025, REQ-189)
  turn_trace_id             text,                        -- AI 답을 만드는 중인 차례의 추적 ID. 빈 값이면 쉬는 중. 이어 온 메시지는 다음 차례에 모아 답함(3-3)
  turn_started_at           timestamptz,                 -- 그 차례를 시작한 시각
  opened_at                 timestamptz NOT NULL DEFAULT now(), -- 상담을 연 시각
  deleted_at                timestamptz,                 -- 대화·사진·주문이 되지 않은 초안을 지운 시각(SPEC-065, REQ-186). 이 행은 내용 없이 남기고 주문·AI 호출 기록(비용)이 참조함
  CONSTRAINT consultations_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT consultations_customer_key UNIQUE (shop_id, id, customer_id), -- 주문·확인 카드·손님 안내가 (상담, 손님) 쌍으로 참조하는 키: 그 상담의 손님만(설계 재검토 M17)
  CONSTRAINT consultations_customer_fk FOREIGN KEY (shop_id, customer_id) REFERENCES customers (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT consultations_deleted_chk CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CONSTRAINT consultations_dropped_chk CHECK (status <> 'dropped' OR dropped_at IS NOT NULL),
  CONSTRAINT consultations_ended_chk CHECK (status <> 'ended' OR ended_at IS NOT NULL),
  CONSTRAINT consultations_turn_chk CHECK ((turn_trace_id IS NULL) = (turn_started_at IS NULL))
);
CREATE UNIQUE INDEX consultations_one_live_per_customer ON consultations (customer_id) WHERE status NOT IN ('ended', 'deleted'); -- 손님마다 끝나지도 지워지지도 않은 상담 하나(SPEC-017, REQ-189)
CREATE INDEX consultations_idle_idx ON consultations (last_customer_message_at) WHERE status = 'open'; -- 문의 끊김으로 닫을 상담 찾기(SPEC-025)
CREATE INDEX consultations_dropped_idx ON consultations (dropped_at) WHERE status = 'dropped'; -- 30일 지난 상담 찾기(SPEC-065)
CREATE INDEX consultations_ordered_idx ON consultations (last_customer_message_at) WHERE status = 'ordered'; -- 다룬 주문이 모두 끝나 상담 끝남으로 닫을 상담 찾기(SPEC-025)
CREATE INDEX consultations_ended_idx ON consultations (ended_at) WHERE status = 'ended'; -- 상담 끝남 뒤 30일 지난 상담 찾기(SPEC-065)
COMMENT ON TABLE consultations IS 'TBL-017 상담(TERM-046): 손님 한 사람과 가게의 대화 하나. 다룬 주문이 모두 끝나면 닫고 다음 말은 새 상담(REQ-189)';

-- TBL-018 messages (CTX-001) ← SPEC-017, SPEC-018, SPEC-019, SPEC-020, SPEC-021, SPEC-022, SPEC-065, SPEC-066, SPEC-073 | terms: TERM-046
CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 메시지 ID
  shop_id           uuid NOT NULL,                       -- 가게
  consultation_id   uuid NOT NULL,                       -- 상담
  direction         text NOT NULL CHECK (direction IN ('inbound', 'outbound')), -- 수신·발신
  author            text NOT NULL CHECK (author IN ('customer', 'ai', 'system')), -- 손님·AI 상담·서버가 만든 글(고지·정해진 문장). 사장님 답과 먼저 보내는 안내는 notifications
  kind              text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'photo', 'card', 'unsupported')), -- 글·사진·확인 카드·받지 않는 것(음성·파일·이모티콘)
  kakao_message_id  text,                                -- 들어온 카카오 요청의 ID. 같은 요청은 한 번만(REQ-132). 어떤 값을 쓸지는 오픈빌더 문서로 개발 전 확인
  body_masked       text,                                -- 마스킹한 글: 전화·계좌·카드 번호는 플레이스홀더(SPEC-021). AI·로그는 이것만. 원래 값은 masked_values
  trace_id          text,                                -- 이 메시지를 다룬 차례의 추적 ID(ai_calls와 연결, REQ-131을 잼)
  delivery          text CHECK (delivery IN ('skill_response', 'callback', 'deferred', 'delivered_later', 'failed')), -- 나간 글이 간 길: 바로 답·콜백·다음 대화 때 전할 것·그렇게 전함·실패(SPEC-017)
  created_at        timestamptz NOT NULL DEFAULT now(),  -- 받은 시각이나 만든 시각
  sent_at           timestamptz,                         -- 나간 글을 보낸 시각
  CONSTRAINT messages_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT messages_consultation_fk FOREIGN KEY (shop_id, consultation_id) REFERENCES consultations (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT messages_kakao_id_uq UNIQUE (shop_id, kakao_message_id), -- 같은 카카오 요청은 한 번만(REQ-132)
  CONSTRAINT messages_author_chk CHECK ((direction = 'inbound') = (author = 'customer')),
  CONSTRAINT messages_kakao_id_chk CHECK ((direction = 'inbound') = (kakao_message_id IS NOT NULL)),
  CONSTRAINT messages_delivery_chk CHECK ((direction = 'outbound') = (delivery IS NOT NULL))
);
CREATE INDEX messages_consultation_idx ON messages (consultation_id, created_at); -- 상담의 최근 대화(AI-1의 최근 20차례)
CREATE INDEX messages_deferred_idx ON messages (consultation_id) WHERE delivery = 'deferred'; -- 다음 대화 때 먼저 전할 답(SPEC-017)
COMMENT ON TABLE messages IS 'TBL-018 상담 대화: 들어온 손님 말과 나간 답, 마스킹한 글만 둠';

-- TBL-019 masked_values (CTX-001) ← SPEC-021, SPEC-022, SPEC-049, SPEC-065, SPEC-068, SPEC-073 | terms: none
CREATE TABLE masked_values (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 마스킹한 값 ID
  shop_id          uuid NOT NULL,                        -- 가게
  consultation_id  uuid NOT NULL,                        -- 상담. 플레이스홀더 번호는 상담 안에서 바뀌지 않음
  kind             text NOT NULL CHECK (kind IN ('phone', 'account', 'card', 'long_number')), -- 전화번호·계좌번호·카드번호·8자리 넘는 긴 숫자(주민등록번호처럼 보이는 숫자 포함). 나누는 규칙은 SPEC-021
  placeholder      text NOT NULL CHECK (placeholder ~ '^\[(전화번호|계좌번호|카드번호|긴숫자)[0-9]{1,3}\]$'), -- 플레이스홀더, 예: [전화번호1]
  original_enc     text CHECK (original_enc ~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{39,}$'), -- 원래 값을 앱이 암호화한 값(5절 E20). 전화번호·계좌번호만 둠(REQ-191). 그 가게 사장님 화면과 사유를 적고 연 운영자에게만(REQ-193, SPEC-073)
  value_hmac       text CHECK (value_hmac ~ '^[0-9a-f]{64}$'), -- 같은 값 찾기: 원래 값 대신 비밀 키로 만든 HMAC-SHA256(5절 E20). 전화번호·계좌번호만
  last4            text CHECK (last4 ~ '^[0-9]{4}$'), -- 끝 4자리(운영자 화면의 가린 값, SPEC-073). 카드번호는 이것만 둠. 긴 숫자는 두지 않음(REQ-192)
  created_at       timestamptz NOT NULL DEFAULT now(),   -- 처음 마스킹한 시각
  CONSTRAINT masked_values_consultation_fk FOREIGN KEY (shop_id, consultation_id) REFERENCES consultations (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT masked_values_placeholder_uq UNIQUE (consultation_id, placeholder),
  CONSTRAINT masked_values_value_uq UNIQUE (consultation_id, kind, value_hmac), -- 같은 전화번호·계좌번호는 같은 플레이스홀더(해시로 봄). 해시가 없는 카드번호·긴 숫자는 나올 때마다 새 번호
  CONSTRAINT masked_values_kept_chk CHECK ((kind IN ('phone', 'account')) = (original_enc IS NOT NULL)), -- 원래 값은 전화번호·계좌번호만. 카드번호와 긴 숫자는 원래 값을 두지 않음(REQ-192)
  CONSTRAINT masked_values_hmac_chk CHECK ((original_enc IS NULL) = (value_hmac IS NULL)), -- 원래 값이 있으면 해시도 있음
  CONSTRAINT masked_values_last4_chk CHECK ((kind = 'long_number') = (last4 IS NULL)) -- 긴 숫자만 끝 4자리도 두지 않음
);
COMMENT ON TABLE masked_values IS 'TBL-019 마스킹 원본 값: 플레이스홀더와 암호화한 원래 값(전화번호·계좌번호)과 끝 4자리, 그 가게 사장님 화면과 사유를 적고 연 운영자에게만';

-- TBL-020 order_drafts (CTX-001) ← SPEC-013, SPEC-019, SPEC-020, SPEC-025, SPEC-027, SPEC-028, SPEC-029, SPEC-065, SPEC-072, SPEC-075 | terms: TERM-003, TERM-057
CREATE TABLE order_drafts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 초안 ID
  shop_id               uuid NOT NULL,                   -- 가게
  consultation_id       uuid NOT NULL,                   -- 상담
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted')), -- 채우는 중·주문 요청됨
  revision              integer NOT NULL DEFAULT 1 CHECK (revision >= 1), -- 고칠 때마다 오르는 번호(버전이 아님, TERM-003). 주문 요청 카드가 이 값에 묶임(SPEC-028)
  price_list_id         uuid,                            -- 옵션을 고른 가격표 버전
  pickup_day            date,                            -- 원하는 픽업 날짜(가게 시간대). 날짜만 알아도 남김(SPEC-014, SPEC-020, 설계 재검토 M17)
  pickup_time           time,                            -- 원하는 픽업 시각(가게 시간대). 비어 있으면 아직 모름. 주문 요청 때 날짜와 합쳐 가게 시간대로 픽업 일시(orders.pickup_at)를 만듦(SPEC-029)
  courier_pickup        boolean NOT NULL DEFAULT false,  -- 손님이 부른 퀵(TERM-024)으로 받겠다고 함. 말이 없으면 매장 픽업
  size_option_id        uuid,                            -- 크기
  flavor_option_id      uuid,                            -- 맛
  design_option_id      uuid,                            -- 디자인 옵션
  design_id             uuid,                            -- 고른 도안
  design_notes          text CHECK (char_length(design_notes) <= 500), -- 손님이 말한 디자인 설명
  lettering             text CHECK (char_length(lettering) <= 50), -- 문구(TERM-021), 50자까지(AI-1)
  colors                text CHECK (char_length(colors) <= 100), -- 색
  allergy_answer        text CHECK (char_length(allergy_answer) BETWEEN 1 AND 200), -- 알레르기 답('없음'도 답, REQ-200). 알레르기 정보에 동의한 뒤 전용 블록으로 AI를 거치지 않고 받음(SPEC-075, REQ-202). AI로 보내지 않고(REQ-204) 이 주문 밖에서 쓰지 않음(REQ-236)
  allergy_consent       text CHECK (allergy_consent IN ('agreed', 'declined', 'not_required')), -- 알레르기 정보 동의: 동의함·동의 안 함·동의 필요 없음(배포 설정으로 동의 단계를 끔, REQ-205). 비어 있으면 아직 묻지 않음(SPEC-075). 잠정, 5-2 질문 4
  allergy_consent_version text CHECK (char_length(allergy_consent_version) BETWEEN 1 AND 20), -- 손님이 본 알레르기 정보 동의 글의 버전. 동의함·동의 안 함에만(REQ-201)
  allergy_consent_at    timestamptz,                     -- 동의함·동의 안 함을 누른 시각, 동의 필요 없음이면 알레르기 답 블록을 연 시각(REQ-201, REQ-205)
  excluded_ingredients  text CHECK (char_length(excluded_ingredients) <= 200), -- 빼야 할 재료
  customer_name         text CHECK (char_length(customer_name) BETWEEN 1 AND 30), -- 주문자 이름(SPEC-064·065가 말하는 주문의 이름). 주문 요청 확인 카드 전에 AI를 거치지 않는 입력으로 받음(SPEC-072, REQ-175). AI로 보내지 않음(REQ-178)
  customer_phone        text CHECK (customer_phone ~ '^[0-9-]{8,14}$'), -- 주문자 연락처(픽업·급한 연락). 주문 요청 확인 카드 전에 AI를 거치지 않는 입력으로 받음(SPEC-072, REQ-175). AI로 보내지 않음(REQ-178)
  order_kind            text CHECK (order_kind IN ('standard', 'custom')), -- 가게 규칙이 가른 주문 종류(견적과 같음, SPEC-013). 기본 디자인 범위 밖 옵션·도안, 참고 사진(SPEC-019), 빼야 할 재료, '부터'·'범위' 값이 하나라도 있으면 맞춤(REQ-229)
  created_at            timestamptz NOT NULL DEFAULT now(), -- 만든 시각
  updated_at            timestamptz NOT NULL DEFAULT now(), -- 마지막으로 고친 시각
  CONSTRAINT order_drafts_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT order_drafts_list_key UNIQUE (shop_id, id, price_list_id), -- 더하는 옵션(order_draft_extras)이 초안과 같은 가격표 버전을 참조하는 키(설계 재검토 M17)
  CONSTRAINT order_drafts_consultation_fk FOREIGN KEY (shop_id, consultation_id) REFERENCES consultations (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_drafts_list_fk FOREIGN KEY (shop_id, price_list_id) REFERENCES price_lists (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_drafts_size_fk FOREIGN KEY (price_list_id, size_option_id) REFERENCES price_options (price_list_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_drafts_flavor_fk FOREIGN KEY (price_list_id, flavor_option_id) REFERENCES price_options (price_list_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_drafts_design_option_fk FOREIGN KEY (price_list_id, design_option_id) REFERENCES price_options (price_list_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_drafts_design_fk FOREIGN KEY (price_list_id, design_id) REFERENCES designs (price_list_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_drafts_options_need_list_chk CHECK (price_list_id IS NOT NULL OR (size_option_id IS NULL AND flavor_option_id IS NULL AND design_option_id IS NULL AND design_id IS NULL)), -- 옵션은 버전과 함께. 더하는 옵션은 연결 테이블이 초안의 버전을 외래 키로 묶음(order_draft_extras_draft_fk)
  CONSTRAINT order_drafts_pickup_time_chk CHECK (pickup_time IS NULL OR pickup_day IS NOT NULL), -- 날짜 없이 시각만 있는 초안은 없음(설계 재검토 M17)
  CONSTRAINT order_drafts_allergy_consent_chk CHECK ((allergy_consent IS NULL) = (allergy_consent_at IS NULL) AND coalesce(allergy_consent IN ('agreed', 'declined'), false) = (allergy_consent_version IS NOT NULL)), -- 동의의 답에는 시각이, 동의함·동의 안 함에는 동의 글 버전이(REQ-201)
  CONSTRAINT order_drafts_allergy_answer_chk CHECK (allergy_answer IS NULL OR coalesce(allergy_consent IN ('agreed', 'not_required'), false)) -- 알레르기 답은 동의한 뒤나 동의 단계를 끈 배포에서만(REQ-200, REQ-203, REQ-205)
);
CREATE UNIQUE INDEX order_drafts_one_active ON order_drafts (consultation_id) WHERE status = 'active'; -- 상담마다 채우는 초안 하나
COMMENT ON TABLE order_drafts IS 'TBL-020 주문서 초안(TERM-003): 상담에서 AI가 대화로 채우는 주문 항목';

-- TBL-021 reference_photos (CTX-001) ← SPEC-013, SPEC-019, SPEC-031, SPEC-065 | terms: TERM-019
CREATE TABLE reference_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 사진 ID
  shop_id       uuid NOT NULL,                           -- 가게
  draft_id      uuid NOT NULL,                           -- 붙인 주문서 초안(REQ-003). 주문이 되면 주문이 이 초안을 참조함
  message_id    uuid NOT NULL,                           -- 사진이 온 메시지
  position      smallint NOT NULL DEFAULT 1 CHECK (position BETWEEN 1 AND 10), -- 메시지 안 순서(상담마다 10장까지는 앱이 봄)
  storage_key   text NOT NULL,                           -- 저장 위치. 그 가게 사장님 화면과 그 상담에만 보이고 AI 모델로 보내지 않음(3-3)
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/heic', 'image/webp')), -- 사진 종류
  byte_size     integer NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520), -- 크기(20MB까지)
  created_at    timestamptz NOT NULL DEFAULT now(),      -- 받은 시각
  CONSTRAINT reference_photos_draft_fk FOREIGN KEY (shop_id, draft_id) REFERENCES order_drafts (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT reference_photos_message_fk FOREIGN KEY (shop_id, message_id) REFERENCES messages (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT reference_photos_message_uq UNIQUE (message_id, position) -- 같은 메시지의 사진은 한 번만(SPEC-019)
);
COMMENT ON TABLE reference_photos IS 'TBL-021 참고 사진(TERM-019): 손님이 원하는 디자인을 보여 준 사진';

-- TBL-022 quotes (CTX-001) ← SPEC-013, SPEC-020, SPEC-025, SPEC-027, SPEC-028, SPEC-031, SPEC-032, SPEC-076 | terms: TERM-013, TERM-058
CREATE TABLE quotes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 견적 ID
  shop_id             uuid NOT NULL,                     -- 가게
  draft_id            uuid NOT NULL,                     -- 계산한 주문서 초안
  draft_revision      integer NOT NULL CHECK (draft_revision >= 1), -- 계산할 때 초안의 고친 번호
  price_list_id       uuid NOT NULL,                     -- 계산한 가격표 버전(REQ-007)
  operating_rules_id  uuid NOT NULL,                     -- 유효 기한을 정한 운영규정 버전
  order_kind          text NOT NULL CHECK (order_kind IN ('standard', 'custom')), -- 기본 디자인·맞춤: 고른 옵션·도안이 모두 그 버전의 기본 디자인 범위 안이고 참고 사진·빼야 할 재료가 없고 표시 방식이 '확정'일 때만 기본 디자인(quotes_standard_fixed_chk, SPEC-013, REQ-229)
  display_kind        text NOT NULL CHECK (display_kind IN ('fixed', 'from', 'range')), -- 표시 방식: 확정·부터·범위(REQ-006). 고른 옵션에 '부터'가 있으면 부터, 아니고 '범위'가 있으면 범위(SPEC-013)
  amount              integer NOT NULL CHECK (amount BETWEEN 0 AND 10000000), -- 금액: 고른 옵션 값(범위면 아래 끝)과 더하는 값의 합. '부터'·'범위'면 아래 끝이고 맞춤 주문의 최종 금액은 이 값 이상(SPEC-031, REQ-230)
  amount_max          integer CHECK (amount_max BETWEEN 0 AND 10000000), -- 범위의 위 끝: 범위 옵션의 위 끝과 나머지 값의 합. 사장님이 정한 금액이 이보다 높으면 손님이 새 금액을 확인(SPEC-076)
  basis               jsonb NOT NULL,                    -- 근거: 쓴 옵션 행과 규칙. 사장님 화면에 전부, 손님에게는 금액·표시 방식·유효 기한만(SPEC-013)
  valid_until         timestamptz NOT NULL,              -- 유효 기한(기본 안내 뒤 72시간). 그 전에 가격표 버전이 바뀌면 만료됨(TERM-013)
  quoted_at           timestamptz NOT NULL DEFAULT now(), -- 안내한 시각
  CONSTRAINT quotes_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT quotes_draft_fk FOREIGN KEY (shop_id, draft_id) REFERENCES order_drafts (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT quotes_list_fk FOREIGN KEY (shop_id, price_list_id) REFERENCES price_lists (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT quotes_rules_fk FOREIGN KEY (shop_id, operating_rules_id) REFERENCES operating_rules (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT quotes_range_chk CHECK ((display_kind = 'range') = (amount_max IS NOT NULL) AND (amount_max IS NULL OR amount_max >= amount)),
  CONSTRAINT quotes_standard_fixed_chk CHECK (order_kind = 'custom' OR display_kind = 'fixed'), -- 기본 디자인 주문의 견적은 '확정'만(SPEC-013, REQ-229)
  CONSTRAINT quotes_validity_chk CHECK (valid_until > quoted_at)
);
CREATE INDEX quotes_draft_idx ON quotes (draft_id, quoted_at); -- 초안의 마지막 견적
COMMENT ON TABLE quotes IS 'TBL-022 견적(TERM-013): 가게 규칙이 계산한 금액과 근거, 버전과 유효 기한';

-- TBL-023 orders (CTX-003) ← SPEC-013, SPEC-016, SPEC-024, SPEC-025, SPEC-029, SPEC-030, SPEC-031, SPEC-034, SPEC-036, SPEC-037, SPEC-038, SPEC-039, SPEC-040, SPEC-041, SPEC-042, SPEC-045, SPEC-046, SPEC-047, SPEC-048, SPEC-050, SPEC-052, SPEC-054, SPEC-055, SPEC-056, SPEC-059, SPEC-060, SPEC-061, SPEC-062, SPEC-064, SPEC-065, SPEC-068, SPEC-070, SPEC-073, SPEC-076 | terms: TERM-001
CREATE TABLE orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 주문 ID(손님에게 보이지 않음)
  shop_id                  uuid NOT NULL,                -- 가게
  order_no                 text NOT NULL CHECK (order_no ~ '^[0-9A-Z]{6,12}$'), -- 주문번호: 손님에게 보이는 유일한 번호. 차례 번호가 아닌 무작위라 주문 수가 드러나지 않음(G6)
  customer_id              uuid NOT NULL,                -- 요청한 카카오 사용자. 변경·취소·신고는 이 사용자만(REQ-062)
  consultation_id          uuid NOT NULL,                -- 요청한 상담
  draft_id                 uuid,                         -- 요청한 주문서 초안. 참고 사진은 이 초안에 붙어 있음. 재제작 주문은 빈 값
  kind                     text NOT NULL CHECK (kind IN ('standard', 'custom')), -- 기본 디자인 주문(TERM-039)·맞춤 주문(TERM-038). 가게 규칙이 가른 값
  status                   text NOT NULL CHECK (status IN ('requested', 'awaiting_payment', 'payment_overdue', 'confirmed', 'received', 'no_pickup', 'rejected', 'cancelled')), -- 주문 요청됨·결제 기다림·결제 기한 지남·확정·받음(픽업 완료됨·퀵으로 보냄)·미수령·거절됨·취소됨(1-2)
  version                  integer NOT NULL DEFAULT 1 CHECK (version >= 1), -- 주문 내용의 지금 버전(TERM-005). 카드·변경 요청이 이 값에 묶임(G3, G9). 상태만 바꾸는 쓰기에는 오르지 않아 동시 쓰기는 잠금 번호(lock_version)로 견줌(A6)
  price_list_id            uuid NOT NULL,                -- 금액을 계산한 가격표 버전(REQ-030)
  operating_rules_id       uuid NOT NULL,                -- 동의한 운영규정 버전. 환불·변경 마감은 이 버전으로(REQ-030, REQ-055)
  details_confirmed_at     timestamptz,                  -- 주문 내용 확인(TERM-009)한 시각
  terms_consented_at       timestamptz,                  -- 취소·환불 규정 동의(TERM-040)한 시각. 주문 요청과 같은 행에 함께 남겨 하나만 남을 수 없음(REQ-054)
  pickup_at                timestamptz NOT NULL,         -- 픽업 일시(TERM-023). 현재 버전의 주문 내용과 같음(orders_current_details_fk)
  pickup_day               date NOT NULL,                -- 가게 시간대의 픽업 날짜(자리·목록용, 픽업 일시에서 셈)
  amount                   integer NOT NULL CHECK (amount BETWEEN 0 AND 10000000), -- 현재 버전의 금액(원). 현재 버전의 주문 내용과 같음(orders_current_details_fk)
  requested_at             timestamptz NOT NULL DEFAULT now(), -- 주문 요청(TERM-010) 시각
  accepted_at              timestamptz,                  -- 사장님 수락(TERM-011) 시각. 1-2에 수락 상태가 없어 상태가 아닌 시각으로 둠
  accepted_version         integer,                      -- 수락한 버전. 결제 안내 금액의 기준(REQ-076)
  confirmed_at             timestamptz,                  -- 주문 확정(TERM-012) 시각. 결제 확인됨으로만(REQ-060). 받음·미수령의 시각은 productions에
  confirmed_payment_id     uuid,                         -- 주문을 확정한 확인된 결제(첫 결제나 다시 낸 결제, SPEC-034, SPEC-036). 주문 확정 뒤 상태면 꼭 있음(재제작 주문은 빼고). 그 결제 확인을 취소하면 비우고 결제 기다림으로 돌림(SPEC-070, 트리거 payments_confirmed_void, 설계 재검토 M7)
  rejected_at              timestamptz,                  -- 맞춤 주문을 거절한 시각
  reject_reason            text CHECK (char_length(reject_reason) <= 200), -- 거절 사유
  cancelled_at             timestamptz,                  -- 취소된 시각
  cancel_kind              text CHECK (cancel_kind IN ('customer', 'shop', 'no_payment', 'no_answer')), -- 손님이 취소함·가게 사정으로 취소됨·결제 없어 취소됨(사장님이 고르거나 픽업 일시까지 고르지 않음, REQ-217)·답 없어 닫힘(맞춤 주문 요청에 그 픽업 날짜의 주문 마감까지 사장님 답이 없음, REQ-213)
  cancel_reason            text CHECK (char_length(cancel_reason) BETWEEN 1 AND 200), -- 가게 사정 취소의 사유(SPEC-048)
  remake_of_order_id       uuid,                         -- 재제작(TERM-034) 주문이면 돈을 낸 원래 주문(R21). 재제작 주문을 가리키지 않음(트리거 orders_remake_root). 가격표·운영규정 버전은 원래 주문 것(SPEC-060, 4절 A31)
  finished_at              timestamptz,                  -- 주문이 끝난 시각: 받음·미수령·거절됨·취소됨이고 보내지 않은 환불·열린 신고·변경 요청·결제 안내·할 일이 없고, 원래 주문은 끝나지 않은 재제작 주문도 없음(SPEC-025, SPEC-060, SPEC-065, 트리거 orders_remake_finish). 그 뒤 늦은 신고나 들어온 입금 대조로 다시 열리면 개인정보를 지우기 전까지는 비움(A22)
  personal_data_purged_at  timestamptz,                  -- 끝나고 30일 뒤 개인정보를 지우고 보관 기록(kept_records)으로 나눈 시각(SPEC-065, REQ-185, REQ-187). 이 주문은 화면·API·AI가 읽지 않음(A22)
  updated_at               timestamptz NOT NULL DEFAULT now(), -- 마지막으로 바뀐 시각
  lock_version             integer NOT NULL DEFAULT 1 CHECK (lock_version >= 1), -- 잠금 번호: 이 행을 쓸 때마다(상태·시각·금액·버전) 하나 오름. 읽은 값과 같을 때만 씀(A6, E15, 설계 재검토 H12). 06단계 주문의 revision(DEC-05)
  CONSTRAINT orders_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT orders_no_uq UNIQUE (shop_id, order_no),
  CONSTRAINT orders_draft_uq UNIQUE (draft_id),         -- 초안 하나에 주문 하나
  CONSTRAINT orders_customer_fk FOREIGN KEY (shop_id, customer_id) REFERENCES customers (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT orders_consultation_fk FOREIGN KEY (shop_id, consultation_id, customer_id) REFERENCES consultations (shop_id, id, customer_id) ON DELETE RESTRICT, -- 요청한 상담과 그 상담의 손님(설계 재검토 M17)
  CONSTRAINT orders_draft_fk FOREIGN KEY (shop_id, draft_id) REFERENCES order_drafts (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT orders_list_fk FOREIGN KEY (shop_id, price_list_id) REFERENCES price_lists (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT orders_rules_fk FOREIGN KEY (shop_id, operating_rules_id) REFERENCES operating_rules (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT orders_remake_fk FOREIGN KEY (shop_id, remake_of_order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT orders_consent_chk CHECK (remake_of_order_id IS NOT NULL OR (draft_id IS NOT NULL AND details_confirmed_at IS NOT NULL AND terms_consented_at IS NOT NULL)), -- 내용 확인·규정 동의 없이는 주문 요청 없음(REQ-053, REQ-054)
  CONSTRAINT orders_remake_chk CHECK (remake_of_order_id IS NULL OR (draft_id IS NULL AND amount = 0)), -- 재제작은 결제 없는 주문(REQ-074)
  CONSTRAINT orders_requested_custom_chk CHECK (status <> 'requested' OR kind = 'custom'), -- 사장님 답을 기다리는 요청은 맞춤 주문만. 기본 디자인은 바로 결제 기다림(1-2)
  CONSTRAINT orders_accept_custom_chk CHECK (kind = 'custom' OR accepted_at IS NULL), -- 수락은 맞춤 주문만(TERM-011)
  CONSTRAINT orders_accepted_before_payment_chk CHECK (kind <> 'custom' OR remake_of_order_id IS NOT NULL OR status IN ('requested', 'rejected', 'cancelled') OR accepted_at IS NOT NULL), -- 맞춤 주문은 수락 뒤에만 결제로(REQ-058)
  CONSTRAINT orders_accepted_version_chk CHECK ((accepted_at IS NULL) = (accepted_version IS NULL)),
  CONSTRAINT orders_confirmed_chk CHECK (status NOT IN ('confirmed', 'received', 'no_pickup') OR confirmed_at IS NOT NULL), -- 확정 시각 없이 주문 확정 뒤 상태 없음
  CONSTRAINT orders_confirmed_payment_chk CHECK ((status NOT IN ('confirmed', 'received', 'no_pickup') OR confirmed_payment_id IS NOT NULL OR remake_of_order_id IS NOT NULL) AND (confirmed_payment_id IS NULL OR confirmed_at IS NOT NULL)), -- 주문 확정 뒤 상태면 주문을 확정한 결제가 있음(재제작 주문은 빼고). 주문 확정은 결제 확인으로만(REQ-060, 설계 재검토 M7)
  CONSTRAINT orders_rejected_chk CHECK ((status = 'rejected') = (rejected_at IS NOT NULL)),
  CONSTRAINT orders_rejected_custom_chk CHECK (status <> 'rejected' OR kind = 'custom'),
  CONSTRAINT orders_cancel_chk CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancel_kind IS NOT NULL)),
  CONSTRAINT orders_shop_cancel_reason_chk CHECK ((cancel_kind IS NOT DISTINCT FROM 'shop') = (cancel_reason IS NOT NULL)), -- 가게 사정 취소에는 사유(SPEC-048)
  CONSTRAINT orders_no_answer_chk CHECK (cancel_kind IS DISTINCT FROM 'no_answer' OR (kind = 'custom' AND accepted_at IS NULL AND remake_of_order_id IS NULL)), -- 답 없어 닫힘은 수락하지 않은 맞춤 주문 요청만(REQ-213)
  CONSTRAINT orders_finished_chk CHECK (finished_at IS NULL OR status IN ('received', 'no_pickup', 'rejected', 'cancelled')), -- 끝난 주문은 받음·미수령·거절됨·취소됨 가운데 하나(SPEC-025)
  CONSTRAINT orders_purged_chk CHECK (personal_data_purged_at IS NULL OR finished_at IS NOT NULL) -- 개인정보를 지운 주문은 끝난 주문이고 다시 열지 않음(SPEC-065, A22)
);
CREATE INDEX orders_customer_idx ON orders (customer_id, requested_at); -- 내 주문(SPEC-040)
CREATE INDEX orders_day_idx ON orders (shop_id, pickup_day, status); -- 날짜별 제작 목록·오늘·내일 픽업(SPEC-050, SPEC-052, SPEC-054)
CREATE INDEX orders_owner_queue_idx ON orders (shop_id, status) WHERE status IN ('requested', 'payment_overdue'); -- 사장님이 정할 주문(SPEC-031, SPEC-037)
CREATE INDEX orders_purge_due_idx ON orders (finished_at) WHERE finished_at IS NOT NULL AND personal_data_purged_at IS NULL; -- 끝나고 30일 지난 주문 찾기(SPEC-065)
COMMENT ON TABLE orders IS 'TBL-023 주문(TERM-001): 주문 요청부터 확정·변경·취소·받음까지의 상태와 버전';

-- TBL-024 confirm_cards (CTX-001) ← SPEC-028, SPEC-029, SPEC-033, SPEC-040, SPEC-041, SPEC-046, SPEC-053, SPEC-057, SPEC-058, SPEC-063, SPEC-065, SPEC-069, SPEC-072, SPEC-075, SPEC-076 | terms: none
CREATE TABLE confirm_cards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 카드 ID
  shop_id          uuid NOT NULL,                        -- 가게
  consultation_id  uuid NOT NULL,                        -- 카드를 보낸 상담
  customer_id      uuid NOT NULL,                        -- 카드를 받은 사용자. 이 사용자만 누름(G9)
  card_key         text NOT NULL CHECK (char_length(card_key) BETWEEN 16 AND 64), -- 버튼에 포함한 카드 키(G2)
  kind             text NOT NULL CHECK (kind IN ('order_request', 'payment_claim', 'change_request', 'cancel', 'issue_report', 'consent_withdrawal', 'orderer_info', 'allergy_info', 'photo_consent', 'amount_confirm')), -- 주문 요청·입금 알리기·변경 요청·취소·신고·동의 철회(SPEC-069)·주문자 정보(SPEC-072, 주문 요청 카드 앞에서 이름·연락처를 받음)·알레르기 정보(SPEC-075, 주문자 정보 카드 앞에서 따로 동의를 받음)·사진 게시 동의(SPEC-053, 완성 사진 안내의 버튼)·새 금액 확인(SPEC-076, 결제 안내를 전할 때 계좌 대신)
  draft_id         uuid,                                 -- 주문 요청·주문자 정보·알레르기 정보 카드의 초안
  draft_revision   integer,                              -- 묶인 초안 고친 번호(SPEC-028)
  order_id         uuid,                                 -- 대상 주문. 주문 요청 카드는 누른 뒤 생긴 주문
  order_version    integer,                              -- 묶인 주문 버전(G9)
  payload          jsonb NOT NULL,                       -- 서버가 저장된 값으로 만든 카드 내용(요약·금액·규정 버전·환불 계산값). AI가 쓰지 않음. 주문이 끝나고 30일 뒤 빈 객체({})로 비움(SPEC-065)
  expires_at       timestamptz NOT NULL,                 -- 보낸 뒤 30분(G9)
  used_at          timestamptz,                          -- 누른 시각. 한 카드는 한 번만 명령을 내림
  outcome          text CHECK (outcome IN ('done', 'stale', 'expired')), -- 명령함·버전이 바뀌어 거절(새 카드)·기한 지나 거절(새 카드)
  created_at       timestamptz NOT NULL DEFAULT now(),   -- 보낸 시각
  CONSTRAINT confirm_cards_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT confirm_cards_key_uq UNIQUE (shop_id, card_key), -- 같은 카드 키는 한 번만(G2)
  CONSTRAINT confirm_cards_consultation_fk FOREIGN KEY (shop_id, consultation_id, customer_id) REFERENCES consultations (shop_id, id, customer_id) ON DELETE RESTRICT, -- 카드를 보낸 상담과 그 상담의 손님(설계 재검토 M17)
  CONSTRAINT confirm_cards_customer_fk FOREIGN KEY (shop_id, customer_id) REFERENCES customers (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT confirm_cards_draft_fk FOREIGN KEY (shop_id, draft_id) REFERENCES order_drafts (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT confirm_cards_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT confirm_cards_draft_chk CHECK ((kind IN ('order_request', 'orderer_info', 'allergy_info')) = (draft_id IS NOT NULL AND draft_revision IS NOT NULL)),
  CONSTRAINT confirm_cards_order_chk CHECK (kind IN ('order_request', 'orderer_info', 'allergy_info') OR (order_id IS NOT NULL AND order_version IS NOT NULL)),
  CONSTRAINT confirm_cards_used_chk CHECK ((used_at IS NULL) = (outcome IS NULL)),
  CONSTRAINT confirm_cards_expiry_chk CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes') -- 30분 기한(G9)
);
COMMENT ON TABLE confirm_cards IS 'TBL-024 손님 확인 카드: 상담·사용자·버전·30분 기한에 묶인 명령 버튼(G9)';

-- TBL-025 change_requests (CTX-003) ← SPEC-024, SPEC-035, SPEC-041, SPEC-042, SPEC-043, SPEC-044, SPEC-045, SPEC-046, SPEC-048, SPEC-065, SPEC-070, SPEC-076 | terms: TERM-001
CREATE TABLE change_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 변경 요청 ID
  shop_id          uuid NOT NULL,                        -- 가게
  order_id         uuid NOT NULL,                        -- 바꾸려는 주문(확정된 주문만, R16)
  card_id          uuid NOT NULL,                        -- 손님이 누른 변경 요청 카드
  base_version     integer NOT NULL CHECK (base_version >= 1), -- 카드에 묶인 주문 버전. 현재 버전과 다르면 받지 않음(REQ-133)
  changes          jsonb NOT NULL,                       -- 바꾸려는 내용(디자인·문구·날짜·시간). 주문이 끝나고 30일 뒤 빈 객체({})로 비움(SPEC-065)
  new_pickup_at    timestamptz,                          -- 날짜·시간을 바꾸면 새 픽업 일시
  needs_owner_day  boolean NOT NULL DEFAULT false,       -- 새 날이 휴무일이거나 마감된 날이라 사장님이 휴무일임이나 초과해 받는 것을 확인한 뒤에만 받음(SPEC-041, REQ-221, REQ-226)
  status           text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'awaiting_difference', 'applied', 'rejected', 'closed_no_difference', 'closed_by_cancel', 'closed_no_answer')), -- 요청됨·차액 결제 기다림(손님의 새 금액 확인과 차액 맞추는 중을 포함하고 차액 결제 안내의 상태로 가름)·반영됨·거절됨·차액 없어 닫힘(차액 결제 기한 지남·손님이 새 금액을 받지 않음·변경 닫기)·주문 취소로 닫힘·답 없어 닫힘(1-5). 답 없어 닫힘은 변경 마감까지 사장님 답이 없을 때(REQ-214)
  amount_delta     integer CHECK (amount_delta BETWEEN -10000000 AND 10000000), -- 수락할 때 금액 차이: 사장님이 고른 방향(그대로·올라감·내려감)과 양수 차이 금액으로 앱이 셈(올라감 +, 내려감 -, 그대로 0). 사장님이 부호를 넣지 않음(SPEC-042, 설계 재검토 M5)
  reject_reason    text CHECK (char_length(reject_reason) <= 200), -- 거절 사유
  decided_at       timestamptz,                          -- 사장님이 답한 시각
  applied_version  integer,                              -- 반영으로 생긴 주문 버전
  applied_at       timestamptz,                          -- 반영한 시각
  closed_at        timestamptz,                          -- 반영되지 않고 종료된 시각
  created_at       timestamptz NOT NULL DEFAULT now(),   -- 요청한 시각
  lock_version     integer NOT NULL DEFAULT 1 CHECK (lock_version >= 1), -- 잠금 번호: 이 행을 쓸 때마다(상태·답·반영·닫힘) 하나 오름. 읽은 값과 같을 때만 씀(A6, E15, 설계 재검토 H12). 06단계 변경 요청의 revision(DEC-05)
  CONSTRAINT change_requests_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT change_requests_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT change_requests_card_fk FOREIGN KEY (shop_id, card_id) REFERENCES confirm_cards (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT change_requests_card_uq UNIQUE (card_id),  -- 카드 하나에 변경 요청 하나(G2)
  CONSTRAINT change_requests_difference_chk CHECK (status <> 'awaiting_difference' OR coalesce(amount_delta, 0) > 0), -- 차액 결제는 금액이 오를 때만(REQ-067)
  CONSTRAINT change_requests_applied_chk CHECK ((status = 'applied') = (applied_at IS NOT NULL AND applied_version IS NOT NULL)),
  CONSTRAINT change_requests_applied_version_chk CHECK (applied_version IS NULL OR applied_version = base_version + 1), -- 버전이 같을 때만 반영하고 버전은 하나 오름(SPEC-045)
  CONSTRAINT change_requests_decided_chk CHECK (status NOT IN ('awaiting_difference', 'rejected') OR decided_at IS NOT NULL),
  CONSTRAINT change_requests_no_answer_chk CHECK (status <> 'closed_no_answer' OR (closed_at IS NOT NULL AND decided_at IS NULL)) -- 답 없어 닫힘은 사장님이 답하지 않은 채 변경 마감에 닫은 것(REQ-214)
);
CREATE UNIQUE INDEX change_requests_one_open_per_order ON change_requests (order_id) WHERE status IN ('requested', 'awaiting_difference'); -- 한 주문에 열린 변경 요청 하나(1-5)
COMMENT ON TABLE change_requests IS 'TBL-025 변경 요청: 확정된 주문을 바꾸자는 손님 요청과 사장님 답(1-5)';

-- TBL-026 order_details (CTX-003) ← SPEC-016, SPEC-029, SPEC-031, SPEC-033, SPEC-040, SPEC-045, SPEC-050, SPEC-054, SPEC-059, SPEC-060, SPEC-064, SPEC-065, SPEC-073, SPEC-076 | terms: TERM-004
CREATE TABLE order_details (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 주문 내용 버전 ID
  shop_id               uuid NOT NULL,                   -- 가게
  order_id              uuid NOT NULL,                   -- 주문
  version               integer NOT NULL CHECK (version >= 1), -- 버전(TERM-005): 요청 1, 금액 변경 수락·변경 반영마다 하나 오름
  source                text NOT NULL CHECK (source IN ('request', 'owner_amount_change', 'change_request', 'remake')), -- 이 버전이 생긴 이유: 주문 요청·금액 변경 수락·변경 반영·재제작
  change_request_id     uuid,                            -- 변경 반영으로 생긴 버전의 변경 요청
  quote_id              uuid,                            -- 요청 때 쓴 견적
  price_list_id         uuid NOT NULL,                   -- 옵션의 가격표 버전
  pickup_at             timestamptz NOT NULL,            -- 픽업 일시(TERM-023)
  courier_pickup        boolean NOT NULL DEFAULT false,  -- 손님이 부른 퀵(TERM-024)으로 받음. 오늘 픽업 목록의 퀵 여부(REQ-092)
  size_option_id        uuid,                            -- 크기
  flavor_option_id      uuid,                            -- 맛
  design_option_id      uuid,                            -- 디자인 옵션
  design_id             uuid,                            -- 도안
  design_notes          text CHECK (char_length(design_notes) <= 500), -- 디자인 설명. 주문이 끝나고 30일 뒤 비움(SPEC-065)
  lettering             text CHECK (char_length(lettering) <= 50), -- 문구(TERM-021). 철자는 손님이 쓴 그대로(SPEC-028). 주문이 끝나고 30일 뒤 비움(SPEC-065)
  colors                text CHECK (char_length(colors) <= 100), -- 색
  allergy_answer        text CHECK (char_length(allergy_answer) BETWEEN 1 AND 200), -- 알레르기 답. 알레르기 정보에 동의한 주문에만(REQ-200, REQ-203). 이 주문 밖에서 쓰지 않고 장부에 적지 않고 AI로 보내지 않음(REQ-236, REQ-204, SPEC-064). 주문이 끝나고 30일 뒤 지움(SPEC-065)
  allergy_consent       text NOT NULL CHECK (allergy_consent IN ('agreed', 'declined', 'not_required')), -- 초안에서 옮긴 알레르기 정보 동의: 동의함·동의 안 함('알레르기 정보 동의 안 함'으로 보임, SPEC-050)·동의 필요 없음(REQ-201, REQ-205). 지우기는 이 동의 기록을 남김(SPEC-065)
  allergy_consent_version text CHECK (char_length(allergy_consent_version) BETWEEN 1 AND 20), -- 손님이 본 알레르기 정보 동의 글의 버전. 동의함·동의 안 함에만(REQ-201)
  allergy_consent_at    timestamptz NOT NULL,            -- 알레르기 정보 동의의 답을 남긴 시각(초안에서 옮김)
  excluded_ingredients  text CHECK (char_length(excluded_ingredients) <= 200), -- 빼야 할 재료. 주문이 끝나고 30일 뒤 비움(SPEC-065)
  customer_name         text CHECK (char_length(customer_name) BETWEEN 1 AND 30), -- 주문자 이름. 주문이 끝나고 30일 뒤 비우고 보관 기록으로 옮김(SPEC-065, REQ-185)
  customer_phone        text CHECK (customer_phone ~ '^[0-9-]{8,14}$'), -- 주문자 연락처. 주문이 끝나고 30일 뒤 지움(SPEC-065)
  amount                integer NOT NULL CHECK (amount BETWEEN 0 AND 10000000), -- 이 버전의 금액(원)
  amount_change_reason  text CHECK (char_length(amount_change_reason) BETWEEN 1 AND 200), -- 금액 변경 수락의 사유(SPEC-031)
  created_at            timestamptz NOT NULL DEFAULT now(), -- 이 버전이 생긴 시각
  CONSTRAINT order_details_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_details_change_fk FOREIGN KEY (shop_id, change_request_id) REFERENCES change_requests (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_details_quote_fk FOREIGN KEY (shop_id, quote_id) REFERENCES quotes (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_details_list_fk FOREIGN KEY (shop_id, price_list_id) REFERENCES price_lists (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_details_size_fk FOREIGN KEY (price_list_id, size_option_id) REFERENCES price_options (price_list_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_details_flavor_fk FOREIGN KEY (price_list_id, flavor_option_id) REFERENCES price_options (price_list_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_details_design_option_fk FOREIGN KEY (price_list_id, design_option_id) REFERENCES price_options (price_list_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_details_design_fk FOREIGN KEY (price_list_id, design_id) REFERENCES designs (price_list_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_details_version_uq UNIQUE (order_id, version), -- 버전마다 한 행, 이전 버전은 지우지 않음
  CONSTRAINT order_details_change_uq UNIQUE (change_request_id), -- 같은 변경을 두 번 반영하지 않음(SPEC-045)
  CONSTRAINT order_details_current_key UNIQUE (order_id, version, price_list_id, amount, pickup_at), -- orders가 현재 버전을 참조하는 키
  CONSTRAINT order_details_list_key UNIQUE (shop_id, id, price_list_id), -- 더하는 옵션(order_detail_extras)이 그 버전과 같은 가격표 버전을 참조하는 키(설계 재검토 M17)
  CONSTRAINT order_details_source_chk CHECK ((source = 'change_request') = (change_request_id IS NOT NULL)),
  CONSTRAINT order_details_first_chk CHECK ((version = 1) = (source IN ('request', 'remake'))), -- 첫 버전은 요청이나 재제작
  CONSTRAINT order_details_amount_reason_chk CHECK ((source = 'owner_amount_change') = (amount_change_reason IS NOT NULL)),
  CONSTRAINT order_details_allergy_consent_chk CHECK ((allergy_consent IN ('agreed', 'declined')) = (allergy_consent_version IS NOT NULL)), -- 동의함·동의 안 함에는 동의 글 버전이(REQ-201)
  CONSTRAINT order_details_allergy_answer_chk CHECK (allergy_answer IS NULL OR allergy_consent IN ('agreed', 'not_required')) -- 동의하지 않은 주문에는 알레르기 답이 없음(REQ-203)
);
COMMENT ON TABLE order_details IS 'TBL-026 주문 내용(TERM-004): 주문에 붙은 항목과 금액을 버전마다 한 행씩';

-- 주문 행의 버전·가격표 버전·금액·픽업 일시는 그 버전의 주문 내용 행과 늘 같음. 주문과 첫 버전을 한 트랜잭션에서 쓰므로 확인은 트랜잭션 끝에 함
ALTER TABLE orders ADD CONSTRAINT orders_current_details_fk FOREIGN KEY (id, version, price_list_id, amount, pickup_at)
  REFERENCES order_details (order_id, version, price_list_id, amount, pickup_at) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- TBL-027 handoffs (CTX-001) ← SPEC-014, SPEC-015, SPEC-017, SPEC-020, SPEC-021, SPEC-022, SPEC-023, SPEC-024, SPEC-025, SPEC-026, SPEC-029, SPEC-030, SPEC-040, SPEC-053, SPEC-056, SPEC-065 | terms: TERM-008, TERM-018
CREATE TABLE handoffs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 에스컬레이션 건 ID
  shop_id                uuid NOT NULL,                  -- 가게
  consultation_id        uuid NOT NULL,                  -- 상담
  source_message_id      uuid NOT NULL,                  -- 에스컬레이션한 손님 말. 같은 메시지는 한 번만 에스컬레이션함(SPEC-022). 열린 동안 온 새 질문은 덧붙은 질문(handoff_questions)으로 남음
  order_id               uuid,                           -- 관련 주문(있으면)
  reason                 text NOT NULL CHECK (reason IN ('edibility', 'cannot_answer', 'closed_day', 'legal_medical', 'customer_request', 'other_user', 'pre_receipt_issue', 'ai_failure', 'ai_cost_limit', 'callback_timeout', 'masking_failed', 'empty_answer', 'clause_missing')), -- 에스컬레이션한 사유: 먹어도 되는지·답할 수 없음·마감된 날·법·의료·손님 요청·다른 사용자·받기 전 문제·AI 실패·AI 비용 한도·콜백 시간 초과·마스킹 실패·빈 답·조문 없음
  requested_day          date,                           -- 마감된 날에 추가로 받을지 묻는 질문의 날짜(SPEC-014). 마감된 날 질문에만 있고, 다른 열린 건이 있어도 날짜마다 따로 건(handoffs_one_open_day_per_consultation, 설계 재검토 M17)
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed_no_answer')), -- 열림·답함·답 없어 닫힘(남긴 지 7일, REQ-216)
  answer_text            text CHECK (char_length(answer_text) BETWEEN 1 AND 1000), -- 사장님 답. AI가 고치지 않고 그대로 전함(SPEC-023)
  day_decision           text CHECK (day_decision IN ('accepted', 'declined')), -- 마감된 날: 추가 수락·받지 않음
  day_accept_expires_at  timestamptz,                    -- 추가 수락한 날에 주문 요청으로 자리를 잡을 수 있는 기한(24시간, SPEC-023)
  day_used_order_id      uuid,                           -- 추가 수락을 쓴 주문 요청: 그 날짜에 마감 후 추가 수락(slot_holds.overbooked)으로 자리를 잡은 주문. 추가 수락 하나는 주문 요청 하나에만(SPEC-023, SPEC-029, 4절 A34)
  appended_alerted_at    timestamptz,                    -- '새 질문 덧붙음' 알림을 마지막으로 보낸 시각(하루 한 번까지, SPEC-022)
  answered_at            timestamptz,                    -- 답한 시각
  closed_at              timestamptz,                    -- 답 없어 닫힌 시각(남긴 지 7일, REQ-216). 그 뒤 상담은 문의 끊김으로 닫히고 지워질 수 있음(1-1)
  created_at             timestamptz NOT NULL DEFAULT now(), -- 에스컬레이션한 시각
  CONSTRAINT handoffs_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT handoffs_consultation_fk FOREIGN KEY (shop_id, consultation_id) REFERENCES consultations (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT handoffs_message_fk FOREIGN KEY (shop_id, source_message_id) REFERENCES messages (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT handoffs_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT handoffs_day_used_fk FOREIGN KEY (shop_id, day_used_order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT handoffs_source_uq UNIQUE (source_message_id),
  CONSTRAINT handoffs_day_used_uq UNIQUE (day_used_order_id), -- 추가 수락 하나는 주문 요청 하나에만(SPEC-023, 설계 재검토 M17)
  CONSTRAINT handoffs_answered_chk CHECK ((status = 'answered') = (answered_at IS NOT NULL)),
  CONSTRAINT handoffs_answer_chk CHECK (status <> 'answered' OR answer_text IS NOT NULL OR day_decision IS NOT NULL),
  CONSTRAINT handoffs_day_chk CHECK ((reason = 'closed_day') = (requested_day IS NOT NULL) AND (day_decision IS NULL OR requested_day IS NOT NULL)), -- 날짜는 마감된 날 질문에만, 추가 수락·받지 않음은 날짜가 있는 건에만
  CONSTRAINT handoffs_day_used_chk CHECK (day_used_order_id IS NULL OR day_decision IS NOT DISTINCT FROM 'accepted'), -- 추가 수락한 건만 주문 요청이 씀(설계 재검토 M17)
  CONSTRAINT handoffs_day_accept_chk CHECK ((day_decision IS NOT DISTINCT FROM 'accepted') = (day_accept_expires_at IS NOT NULL)),
  CONSTRAINT handoffs_closed_chk CHECK ((status = 'closed_no_answer') = (closed_at IS NOT NULL)) -- 답 없어 닫힘에만 닫힌 시각
);
CREATE UNIQUE INDEX handoffs_one_open_per_consultation ON handoffs (consultation_id) WHERE status = 'open' AND reason <> 'closed_day'; -- 열린 에스컬레이션 건이 있으면 새 질문은 그 건의 덧붙은 질문(SPEC-022). 마감된 날 질문 건은 빼고 셈
CREATE UNIQUE INDEX handoffs_one_open_day_per_consultation ON handoffs (consultation_id, requested_day) WHERE status = 'open' AND reason = 'closed_day'; -- 마감된 날 질문은 상담과 날짜마다 열린 건 하나(SPEC-014, 설계 재검토 M17)
CREATE INDEX handoffs_open_age_idx ON handoffs (created_at) WHERE status = 'open'; -- 남긴 지 7일 지난 열린 에스컬레이션 건 찾기(SPEC-024, REQ-216)
COMMENT ON TABLE handoffs IS 'TBL-027 에스컬레이션 건(TERM-008): AI가 답하지 않고 사장님께 에스컬레이션한 손님 질문';

-- TBL-028 issue_details (CTX-001) ← SPEC-057, SPEC-058, SPEC-059, SPEC-065 | terms: TERM-032
CREATE TABLE issue_details (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 신고 내용 ID
  shop_id          uuid NOT NULL,                        -- 가게
  consultation_id  uuid NOT NULL,                        -- 상담
  order_id         uuid,                                 -- 받은 주문(픽업 완료됨·퀵으로 보냄). 모으는 동안은 비어 있을 수 있고 신고 때는 있어야 함
  description      text CHECK (char_length(description) BETWEEN 1 AND 1000), -- 설명. 사진 없이도 신고할 수 있음. 신고된 것은 주문이 끝난 날부터 3년 뒤 비움(SPEC-065, REQ-188)
  health_concern   boolean NOT NULL DEFAULT false,       -- 먹고 아프다는 말: 정해진 문장을 덧붙이고 사장님께 바로 알림(SPEC-057)
  status           text NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting', 'reported', 'abandoned')), -- 모으는 중·신고됨·그만둠
  created_at       timestamptz NOT NULL DEFAULT now(),   -- 모으기 시작한 시각
  updated_at       timestamptz NOT NULL DEFAULT now(),   -- 마지막으로 더한 시각
  content_purged_at timestamptz,                         -- 신고된 설명과 사진을 지운 시각(주문이 끝난 날부터 3년, SPEC-065, REQ-188)
  CONSTRAINT issue_details_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT issue_details_consultation_fk FOREIGN KEY (shop_id, consultation_id) REFERENCES consultations (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT issue_details_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT issue_details_order_chk CHECK (status <> 'reported' OR order_id IS NOT NULL), -- 신고에는 주문번호가 있음(SPEC-057)
  CONSTRAINT issue_details_purged_chk CHECK (content_purged_at IS NULL OR (status = 'reported' AND description IS NULL)) -- 지운 것은 신고된 것이고 설명이 없음(REQ-188)
);
CREATE UNIQUE INDEX issue_details_one_collecting ON issue_details (consultation_id) WHERE status = 'collecting'; -- 상담마다 모으는 신고 내용 하나
COMMENT ON TABLE issue_details IS 'TBL-028 신고 내용(TERM-032): 신고 전에 AI가 모은 사진·설명·주문번호';

-- TBL-029 issue_photos (CTX-001) ← SPEC-057, SPEC-059, SPEC-065 | terms: TERM-032
CREATE TABLE issue_photos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 신고 사진 ID
  shop_id           uuid NOT NULL,                       -- 가게
  issue_details_id  uuid NOT NULL,                       -- 신고 내용
  message_id        uuid,                                -- 사진이 온 메시지. 상담을 지울 때 신고된 사진은 메시지 연결만 비우고 주문이 끝난 날부터 3년 남김(SPEC-065, REQ-187)
  position          smallint NOT NULL CHECK (position BETWEEN 1 AND 5), -- 순서(5장까지, SPEC-057)
  storage_key       text NOT NULL,                       -- 저장 위치. AI 모델로 보내지 않음(3-3)
  content_type      text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/heic', 'image/webp')), -- 사진 종류
  byte_size         integer NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520), -- 크기(20MB까지)
  created_at        timestamptz NOT NULL DEFAULT now(),  -- 받은 시각
  CONSTRAINT issue_photos_details_fk FOREIGN KEY (shop_id, issue_details_id) REFERENCES issue_details (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT issue_photos_message_fk FOREIGN KEY (shop_id, message_id) REFERENCES messages (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT issue_photos_position_uq UNIQUE (issue_details_id, position)
);
COMMENT ON TABLE issue_photos IS 'TBL-029 신고 사진: 신고 내용에 붙은 사진(5장까지)';

-- TBL-030 issue_reports (CTX-003) ← SPEC-058, SPEC-059, SPEC-060, SPEC-061 | terms: TERM-031
CREATE TABLE issue_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 문제 신고 ID
  shop_id            uuid NOT NULL,                      -- 가게
  order_id           uuid NOT NULL,                      -- 받은 주문
  issue_details_id   uuid NOT NULL,                      -- 모은 신고 내용(TERM-032)
  card_id            uuid NOT NULL,                      -- 손님이 누른 신고 카드
  follows_report_id  uuid,                               -- 같은 주문의 두 번째 신고면 첫 신고(연결, SPEC-058)
  late               boolean NOT NULL,                   -- 운영규정의 신고 기한 뒤에 옴(REQ-072)
  status             text NOT NULL DEFAULT 'reported' CHECK (status IN ('reported', 'decided', 'closed')), -- 신고됨·보상 정해짐·닫힘(1-6)
  compensation       text CHECK (compensation IN ('remake', 'partial_refund', 'full_refund', 'none')), -- 보상(TERM-033): 재제작·일부 환불·전액 환불·보상 없음. 사장님만 정함(REQ-073)
  decided_at         timestamptz,                        -- 보상을 정한 시각
  remake_order_id    uuid,                               -- 재제작 주문(TERM-034). 보상 하나에 하나(SPEC-060)
  closed_at          timestamptz,                        -- 보상 안내를 보내고 닫은 시각
  reported_at        timestamptz NOT NULL DEFAULT now(), -- 신고한 시각
  CONSTRAINT issue_reports_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT issue_reports_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT issue_reports_details_fk FOREIGN KEY (shop_id, issue_details_id) REFERENCES issue_details (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT issue_reports_card_fk FOREIGN KEY (shop_id, card_id) REFERENCES confirm_cards (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT issue_reports_follows_fk FOREIGN KEY (shop_id, follows_report_id) REFERENCES issue_reports (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT issue_reports_remake_fk FOREIGN KEY (shop_id, remake_order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT issue_reports_details_uq UNIQUE (issue_details_id),
  CONSTRAINT issue_reports_card_uq UNIQUE (card_id),     -- 버튼 두 번에 신고 하나(G2)
  CONSTRAINT issue_reports_remake_uq UNIQUE (remake_order_id),
  CONSTRAINT issue_reports_decided_chk CHECK ((status IN ('decided', 'closed')) = (compensation IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT issue_reports_closed_chk CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT issue_reports_remake_chk CHECK (remake_order_id IS NULL OR compensation IS NOT DISTINCT FROM 'remake')
);
COMMENT ON TABLE issue_reports IS 'TBL-030 문제 신고(TERM-031): 받은 주문의 신고와 사장님이 정한 보상(1-6)';

-- TBL-031 payment_requests (CTX-004) ← SPEC-006, SPEC-015, SPEC-016, SPEC-024, SPEC-029, SPEC-030, SPEC-031, SPEC-032, SPEC-033, SPEC-034, SPEC-035, SPEC-036, SPEC-037, SPEC-038, SPEC-039, SPEC-042, SPEC-043, SPEC-044, SPEC-046, SPEC-047, SPEC-048, SPEC-059, SPEC-065, SPEC-066, SPEC-068, SPEC-070, SPEC-071, SPEC-076 | terms: TERM-049
CREATE TABLE payment_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 결제 안내 ID
  shop_id             uuid NOT NULL,                     -- 가게
  order_id            uuid NOT NULL,                     -- 주문. 재제작 주문에는 없음(트리거 payment_requests_remake, SPEC-060)
  kind                text NOT NULL CHECK (kind IN ('first', 'reissue', 'difference')), -- 첫 결제·다시 낸 결제(결제 기한 연장, TERM-037)·차액 결제(R13). 날짜 변경·재제작에는 없음
  change_request_id   uuid,                              -- 차액 결제의 변경 요청
  event_key           text NOT NULL,                     -- 같은 이벤트의 결제 안내는 한 번(REQ-154). 형식 pay:{대상 ID}:{결제 종류}. 대상은 첫 결제면 주문, 다시 낸 결제면 기한이 지난 결제 안내, 차액 결제면 변경 요청(4절 A33)
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'mismatch', 'paid', 'expired', 'closed')), -- 나감·확인 요청됨·맞추는 중·확인됨·기한 지남·닫힘(1-3)
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1), -- 비교해 쓰는 번호(G3)
  amount              integer NOT NULL CHECK (amount BETWEEN 1 AND 10000000), -- 안내 금액: 수락한 버전(기본 디자인은 요청한 버전)의 금액(REQ-076). 차액 결제는 사장님이 고른 방향과 차이 금액으로 셈한 오른 금액(SPEC-042)
  requested_amount    integer CHECK (requested_amount BETWEEN 0 AND 10000000), -- 금액을 정하거나 바꿔 수락한 맞춤 주문에서 손님이 요청한 견적 금액('부터'·'범위'면 아래 끝). 표시 방식과 위 끝은 그 주문 첫 버전의 견적(order_details.quote_id)에서 읽어 함께 보임(REQ-231). 다시 낸 결제도 같은 값
  needs_amount_confirm boolean NOT NULL DEFAULT false, -- 새 금액 확인이 필요한 결제 안내: 손님이 본 금액(견적이 금액 하나면 그 금액, '부터'면 아래 끝, '범위'면 위 끝)보다 높게 정한 맞춤 주문의 첫 결제와 확인 전에 다시 낸 결제, 금액이 오르는 변경의 차액 결제. 손님이 확인하기 전에는 계좌를 보이지 않고 결제 기한은 상한(SPEC-076, REQ-232)
  amount_confirmed_at timestamptz,                    -- 손님이 새 금액을 확인한 시각. 이때가 전해진 시각(payment_requests_amount_delivered_chk). 확인 전에 들어온 돈을 사장님이 결제로 확인('입금됨'·'대조 완료')하면 그 시각(SPEC-034)
  amount_declined_at  timestamptz,                    -- 손님이 새 금액을 받지 않은 시각. 결제 안내를 닫음: 맞춤 주문은 손님 취소(주문 취소), 변경은 변경 요청이 차액 없어 닫힘(REQ-233)
  amount_card_id      uuid,                           -- 손님이 누른 새 금액 확인 카드(SPEC-076). 사장님의 결제 확인으로 남긴 확인이면 빈 값
  payment_account_id  uuid NOT NULL,                     -- 이 안내에 포함한 가게 계좌. 계좌를 바꿔도 나간 안내는 그대로
  card_payment_url    text CHECK (card_payment_url ~ '^https://'), -- 이 안내에 포함한 카드 결제 링크(있으면)
  issued_at           timestamptz NOT NULL DEFAULT now(), -- 낸 시각. 결제 기한은 이때가 아니라 손님에게 전해진 시각부터 셈(REQ-218)
  delivered_at        timestamptz,                       -- 결제 안내가 손님에게 전해진 시각: 대화 중 답으로 보임·먼저 보낸 안내가 닿음·다음 대화 때 전함(SPEC-032). 새 금액 확인이 필요하면 손님이 확인한 시각(SPEC-076). 빈 값이면 '아직 못 전함'(SPEC-037)
  due_at              timestamptz NOT NULL,              -- 결제 기한(TERM-030): 전해진 시각에 운영규정의 결제 기한을 더한 때와 결제 기한 상한 가운데 이른 쪽. 전해지기 전에는 상한(REQ-218)
  due_cap_at          timestamptz NOT NULL,              -- 결제 기한 상한: 첫 결제·다시 낸 결제는 그 픽업 날짜의 주문 마감(이미 지났으면 픽업 일시), 차액 결제는 변경 마감(REQ-218, R18). 낼 때 정함. 확인 요청됨도 이때 기한 지남(REQ-223)
  claimed_at          timestamptz,                       -- 손님이 입금했다고 알려 결제 확인을 요청한 시각(REQ-224). 기한 전이면 결제 기한 상한까지 자리를 지킴(R14, REQ-223)
  claim_card_id       uuid,                              -- 손님이 누른 입금 알리기 카드
  claim_rejected_at   timestamptz,                       -- 사장님이 '미입금'을 고른 시각. 확인 요청은 결제 안내마다 한 번이라 다시 받지 않음(SPEC-033)
  depositor_name      text CHECK (char_length(depositor_name) BETWEEN 1 AND 30), -- 입금자 이름(입금 대조, TERM-063). 손님이 결제 확인을 요청할 때 AI를 거치지 않는 입력으로 받고, 따로 넣지 않으면 주문자 이름(SPEC-033, REQ-176). AI로 보내지 않음(REQ-178). 주문이 끝나고 30일 뒤 지움(SPEC-065)
  mismatch_amount     integer CHECK (mismatch_amount BETWEEN 1 AND 100000000), -- 다르게 들어온 금액(R15). 안내 금액의 10배까지(SPEC-035)
  mismatch_at         timestamptz,                       -- '금액 불일치'를 남긴 시각. 맞추는 중에는 결제 기한을 멈춤(REQ-161)
  arrived_amount      integer CHECK (arrived_amount BETWEEN 1 AND 100000000), -- 들어온 금액(받은 금액의 몫, REQ-165). 입금됨은 안내 금액, 맞추는 중은 다르게 들어온 금액(모자란 금액이 마저 들어오면 안내 금액, 더 들어온 채 대조 완료면 그대로), 결제로 확인하지 않은 들어온 입금은 사장님이 남긴 금액(SPEC-071)
  arrived_at          timestamptz,                       -- 들어온 금액을 남긴 시각. 결제 확인 취소(SPEC-070)면 지움
  paid_at             timestamptz,                       -- 확인됨이 된 시각
  expired_at          timestamptz,                       -- 기한 지남이 된 시각
  closed_at           timestamptz,                       -- 닫힌 시각
  close_reason        text CHECK (close_reason IN ('superseded', 'order_cancelled', 'change_closed')), -- 새 결제 안내·주문 취소(맞춤 주문의 새 금액을 받지 않음 포함)·변경 요청이 닫힘(차액의 새 금액을 받지 않음·변경 닫기 포함)
  CONSTRAINT payment_requests_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT payment_requests_match_key UNIQUE (id, order_id, amount), -- payments가 같은 주문·같은 금액으로만 참조하게 함
  CONSTRAINT payment_requests_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT payment_requests_change_fk FOREIGN KEY (shop_id, change_request_id) REFERENCES change_requests (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT payment_requests_account_fk FOREIGN KEY (shop_id, payment_account_id) REFERENCES payment_accounts (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT payment_requests_claim_card_fk FOREIGN KEY (shop_id, claim_card_id) REFERENCES confirm_cards (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT payment_requests_amount_card_fk FOREIGN KEY (shop_id, amount_card_id) REFERENCES confirm_cards (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT payment_requests_event_uq UNIQUE (shop_id, event_key),
  CONSTRAINT payment_requests_difference_chk CHECK ((kind = 'difference') = (change_request_id IS NOT NULL)),
  CONSTRAINT payment_requests_requested_amount_chk CHECK (requested_amount IS NULL OR kind IN ('first', 'reissue')), -- 다시 낸 결제도 같은 요청 금액을 보임(REQ-231)
  CONSTRAINT payment_requests_needs_confirm_chk CHECK (CASE WHEN kind = 'difference' THEN needs_amount_confirm ELSE NOT needs_amount_confirm OR amount > coalesce(requested_amount, amount) END), -- 차액 결제는 늘 새 금액 확인(금액이 오를 때만 있음), 첫 결제·다시 낸 결제는 정한 금액이 요청한 금액보다 높을 때만(SPEC-076, REQ-232)
  CONSTRAINT payment_requests_amount_answer_chk CHECK ((amount_confirmed_at IS NULL OR amount_declined_at IS NULL) AND (needs_amount_confirm OR (amount_confirmed_at IS NULL AND amount_declined_at IS NULL AND amount_card_id IS NULL))), -- 확인과 받지 않음은 하나만, 새 금액 확인이 필요한 결제 안내에만
  CONSTRAINT payment_requests_amount_delivered_chk CHECK (NOT needs_amount_confirm OR delivered_at IS NOT DISTINCT FROM amount_confirmed_at), -- 새 금액 확인이 필요하면 손님이 확인한 때가 전해진 때(REQ-232)
  CONSTRAINT payment_requests_amount_claim_chk CHECK (NOT needs_amount_confirm OR claimed_at IS NULL OR amount_confirmed_at IS NOT NULL), -- 새 금액을 확인하기 전에는 결제 확인 요청 없음(SPEC-033)
  CONSTRAINT payment_requests_amount_paid_chk CHECK (status <> 'paid' OR NOT needs_amount_confirm OR amount_confirmed_at IS NOT NULL), -- 확인 전 들어온 돈을 결제로 확인하면 그 시각을 손님의 확인으로 남김(SPEC-034)
  CONSTRAINT payment_requests_amount_declined_chk CHECK (amount_declined_at IS NULL OR status = 'closed'), -- 새 금액을 받지 않으면 결제 안내를 닫음(REQ-233)
  CONSTRAINT payment_requests_due_chk CHECK (due_at > issued_at),
  CONSTRAINT payment_requests_due_cap_chk CHECK (due_at <= due_cap_at), -- 결제 기한은 상한을 넘지 않음(REQ-218)
  CONSTRAINT payment_requests_delivered_chk CHECK ((delivered_at IS NOT NULL OR due_at = due_cap_at) AND (delivered_at IS NULL OR delivered_at >= issued_at)), -- 전해지기 전에는 상한이 결제 기한(SPEC-032)
  CONSTRAINT payment_requests_claimed_chk CHECK (status <> 'claimed' OR (claimed_at IS NOT NULL AND claim_rejected_at IS NULL)),
  CONSTRAINT payment_requests_claim_rejected_chk CHECK (claim_rejected_at IS NULL OR claimed_at IS NOT NULL),
  CONSTRAINT payment_requests_mismatch_chk CHECK (status <> 'mismatch' OR (mismatch_amount IS NOT NULL AND mismatch_at IS NOT NULL)),
  CONSTRAINT payment_requests_mismatch_amount_chk CHECK (mismatch_amount IS NULL OR mismatch_amount <= amount * 10),
  CONSTRAINT payment_requests_arrived_chk CHECK ((arrived_amount IS NULL) = (arrived_at IS NULL)),
  CONSTRAINT payment_requests_arrived_amount_chk CHECK (arrived_amount IS NULL OR arrived_amount <= amount * 10), -- 안내 금액의 10배까지(SPEC-035, SPEC-071)
  CONSTRAINT payment_requests_arrived_status_chk CHECK (status NOT IN ('open', 'claimed') OR arrived_amount IS NULL), -- 나감·확인 요청됨에는 들어온 금액이 없음
  CONSTRAINT payment_requests_arrived_paid_chk CHECK (status <> 'paid' OR (arrived_amount IS NOT NULL AND arrived_amount >= amount)), -- 확인됨은 안내 금액 이상이 들어옴
  CONSTRAINT payment_requests_arrived_mismatch_chk CHECK (status <> 'mismatch' OR arrived_amount IS NOT DISTINCT FROM mismatch_amount), -- 맞추는 중의 들어온 금액은 다르게 들어온 금액
  CONSTRAINT payment_requests_paid_chk CHECK ((status = 'paid') = (paid_at IS NOT NULL)),
  CONSTRAINT payment_requests_expired_chk CHECK (status <> 'expired' OR expired_at IS NOT NULL),
  CONSTRAINT payment_requests_closed_chk CHECK ((status = 'closed') = (closed_at IS NOT NULL AND close_reason IS NOT NULL))
);
CREATE UNIQUE INDEX payment_requests_one_open_per_order ON payment_requests (order_id) WHERE status IN ('open', 'claimed', 'mismatch'); -- 한 주문에 열린 결제 안내 하나(1-3)
CREATE INDEX payment_requests_due_idx ON payment_requests (due_at) WHERE status = 'open'; -- 기한 지남 찾기. 확인 요청됨·맞추는 중은 빠짐(R14, R15)
CREATE INDEX payment_requests_claim_cap_idx ON payment_requests (due_cap_at) WHERE status = 'claimed'; -- 결제 기한 상한이 지난 확인 요청 찾기(SPEC-037, REQ-223)
CREATE INDEX payment_requests_shop_status_idx ON payment_requests (shop_id, status); -- 입금 대조 화면(TERM-063)
COMMENT ON TABLE payment_requests IS 'TBL-031 결제 안내: 금액·결제 방법·결제 기한을 담은 안내와 그 상태(1-3)';

-- TBL-032 payments (CTX-004) ← SPEC-016, SPEC-034, SPEC-035, SPEC-036, SPEC-040, SPEC-043, SPEC-046, SPEC-047, SPEC-059, SPEC-070 | terms: TERM-049, TERM-014
CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 확인된 결제 ID
  shop_id             uuid NOT NULL,                     -- 가게
  order_id            uuid NOT NULL,                     -- 주문
  payment_request_id  uuid NOT NULL,                     -- 확인한 결제 안내
  amount              integer NOT NULL CHECK (amount BETWEEN 1 AND 10000000), -- 확인된 금액 = 안내 금액. 받은 금액은 결제 안내의 들어온 금액으로 셈(REQ-165). 선결제(TERM-014)는 가게 계좌로 감
  resolution          text NOT NULL DEFAULT 'exact' CHECK (resolution IN ('exact', 'shortfall_paid', 'excess_returned')), -- 입금됨·대조 완료(모자란 금액이 입금됨)·대조 완료(더 들어온 금액은 환불로 돌려줌, SPEC-047)(R15)
  confirmed_at        timestamptz NOT NULL DEFAULT now(), -- 사장님이 확인한 시각
  voided_at           timestamptz,                       -- 사장님이 잘못 누른 결제 확인을 취소한 시각(SPEC-070). 취소한 결제는 받은 금액에 들지 않음
  void_reason         text CHECK (char_length(void_reason) BETWEEN 1 AND 200), -- 결제 확인을 취소한 사유(REQ-169). 손님 안내에는 적지 않음
  CONSTRAINT payments_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT payments_request_fk FOREIGN KEY (shop_id, payment_request_id) REFERENCES payment_requests (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT payments_match_fk FOREIGN KEY (payment_request_id, order_id, amount) REFERENCES payment_requests (id, order_id, amount) ON DELETE RESTRICT, -- 확인된 결제는 그 안내의 주문·금액과 같음(REQ-081)
  CONSTRAINT payments_order_key UNIQUE (shop_id, order_id, id), -- 주문을 확정한 결제를 참조하는 키(orders_confirmed_payment_fk, 설계 재검토 M7)
  CONSTRAINT payments_void_chk CHECK ((voided_at IS NULL) = (void_reason IS NULL)) -- 결제 확인 취소에는 사유(REQ-169)
);
CREATE UNIQUE INDEX payments_one_live_per_request ON payments (payment_request_id) WHERE voided_at IS NULL; -- 결제 안내 하나에 확인된 결제 하나(REQ-153, 결제 확인을 취소한 것은 빼고). '입금됨'을 두 번 눌러도 하나(REQ-132)
CREATE INDEX payments_order_idx ON payments (order_id); -- 확인된 결제 합(SPEC-016)
COMMENT ON TABLE payments IS 'TBL-032 확인된 결제(TERM-049): 결제 안내마다 하나(결제 확인을 취소한 것은 빼고), 사장님이 입금 대조로 확인';

-- 주문을 확정한 결제는 그 주문의 확인된 결제(설계 재검토 M7). payments가 orders 뒤에 만들어지므로 여기서 더함
ALTER TABLE orders ADD CONSTRAINT orders_confirmed_payment_fk FOREIGN KEY (shop_id, id, confirmed_payment_id)
  REFERENCES payments (shop_id, order_id, id) ON DELETE RESTRICT;

-- TBL-033 refunds (CTX-004) ← SPEC-016, SPEC-035, SPEC-036, SPEC-040, SPEC-045, SPEC-046, SPEC-047, SPEC-048, SPEC-049, SPEC-059, SPEC-065, SPEC-070, SPEC-071, SPEC-073 | terms: TERM-049
CREATE TABLE refunds (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 환불 ID
  shop_id                uuid NOT NULL,                  -- 가게
  order_id               uuid NOT NULL,                  -- 주문. 재제작 주문의 취소·보상 환불은 원래 주문에 남김(트리거 refunds_remake, SPEC-060, 4절 A31)
  cause                  text NOT NULL CHECK (cause IN ('customer_cancel', 'shop_cancel', 'change_reduced', 'compensation', 'paid_after_cancel', 'over_received')), -- 손님 취소·가게 사정 취소·금액이 내려간 변경·보상·취소 뒤 들어온 입금·더 들어온 금액(안내 금액을 넘은 몫, 기한 뒤 차액, SPEC-071)
  change_request_id      uuid,                           -- 금액이 내려간 변경
  issue_report_id        uuid,                           -- 보상의 문제 신고
  payment_request_id     uuid,                           -- 돌려줄 들어온 입금의 결제 안내(취소 뒤 들어온 입금·더 들어온 금액, SPEC-071)
  cancelled_order_id     uuid,                           -- 취소 환불(손님 취소·가게 사정 취소)이면 취소한 주문: 그 주문이나 그 재제작 주문(트리거 refunds_cancelled). 취소한 주문마다 환불 하나(refunds_cancelled_uq, 4절 A33, 설계 재검토 M7)
  event_key              text NOT NULL,                  -- 같은 환불을 두 번 정하지 않음(G2). 형식 refund:{대상 ID}:{사유}. 대상은 취소한 주문·변경 요청·문제 신고·결제 안내이고 대상마다 하나는 UNIQUE로도 막음(4절 A33)
  decision               text NOT NULL CHECK (decision IN ('full', 'partial', 'none')), -- 전액 환불·일부 환불·환불 없이 취소(REQ-085). 금액이 내려간 변경은 차액 돌려주기라 전액 환불이 없음(refunds_change_decision_chk, SPEC-047)
  amount                 integer NOT NULL CHECK (amount BETWEEN 0 AND 100000000), -- 정한 환불 금액. 주문의 환불 합은 받은 금액(결제 안내의 들어온 금액 합)을 넘지 않음(REQ-165, 앱이 주문 행을 잠그고 셈). 보상이 아니면 계산값 이상(REQ-170). 상한은 들어온 금액의 상한과 같은 1억 원
  calculated_amount      integer NOT NULL CHECK (calculated_amount BETWEEN 0 AND 100000000), -- 가게 규칙의 계산값(SPEC-016, 4절 A30). 손님 취소는 바탕(받은 금액 - 이미 정한 환불 - 따로 정할 환불)에서 취소 수수료(TERM-016)를 먼저 빼고(바탕보다 크면 0) 비율을 곱해 원 미만 버림. 가게 사정 취소는 바탕 전액, 금액이 내려간 변경은 내려간 금액, 보상은 고른 금액. 취소 뒤 들어온 입금·더 들어온 금액은 그 결제 안내에서 결제로 확인하지 않은 몫(들어온 금액 - 취소하지 않은 확인된 결제)을 넘지 않음(트리거 refunds_unconfirmed, 4절 A29)
  calc_basis             jsonb NOT NULL,                 -- 근거: 운영규정 버전·조문·취소 시각·맞춤 재료 주문 시각·제작 시작 시각·받은 금액의 몫(확인된 결제와 결제로 확인하지 않은 들어온 금액, REQ-084, REQ-165)
  override_reason        text CHECK (char_length(override_reason) BETWEEN 1 AND 200), -- 계산값과 다른 금액을 고른 사유 1~200자(SPEC-047, REQ-084). 다르면 꼭(refunds_override_chk), 보상이 아니면 높을 때만 다를 수 있음(refunds_floor_chk). 보상은 고른 금액이 계산값이라 비움
  method                 text CHECK (method IN ('bank_transfer', 'card_cancel')), -- 가게 계좌에서 반환·카드 결제 취소
  refund_bank_name       text CHECK (char_length(refund_bank_name) BETWEEN 1 AND 30), -- 환불받을 손님 은행(SPEC-049). 주문이 끝나고 30일 뒤 지움(SPEC-065)
  refund_account_enc     text CHECK (refund_account_enc ~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{39,}$'), -- 환불받을 손님 계좌번호를 앱이 암호화한 값(5절 E20, REQ-191). 숫자와 '-' 형식은 06단계 API가 봄. 그 가게 사장님 화면의 이 환불과 사유를 적고 연 운영자에게만, AI·로그 0번(R19, REQ-193). 주문이 끝나고 30일 뒤 지움(SPEC-065)
  refund_account_last4   text CHECK (refund_account_last4 ~ '^[0-9]{4}$'), -- 환불받을 계좌번호 끝 4자리(운영자 화면의 가린 값, SPEC-073). 주문이 끝나고 30일 뒤 지움(SPEC-065)
  refund_holder_name     text CHECK (char_length(refund_holder_name) BETWEEN 1 AND 30), -- 환불받을 계좌의 예금주. 주문이 끝나고 30일 뒤 지움(SPEC-065)
  decided_at             timestamptz NOT NULL DEFAULT now(), -- 정한 시각
  sent_at                timestamptz,                    -- 사장님이 '보냄'을 표시한 시각(REQ-172). 우리는 돈을 옮기지 않음(REQ-079). 그 전까지 환불 보내기 할 일이 남음(REQ-173)
  CONSTRAINT refunds_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT refunds_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT refunds_change_fk FOREIGN KEY (shop_id, change_request_id) REFERENCES change_requests (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT refunds_issue_fk FOREIGN KEY (shop_id, issue_report_id) REFERENCES issue_reports (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT refunds_request_fk FOREIGN KEY (shop_id, payment_request_id) REFERENCES payment_requests (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT refunds_cancelled_fk FOREIGN KEY (shop_id, cancelled_order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT refunds_event_uq UNIQUE (shop_id, event_key),
  CONSTRAINT refunds_cancelled_uq UNIQUE (cancelled_order_id), -- 취소한 주문마다 취소 환불 하나(4절 A33, 설계 재검토 M7)
  CONSTRAINT refunds_change_uq UNIQUE (change_request_id), -- 금액이 내려간 변경 요청마다 환불 하나
  CONSTRAINT refunds_issue_uq UNIQUE (issue_report_id), -- 문제 신고마다 보상 환불 하나(보상은 신고마다 하나, SPEC-059)
  CONSTRAINT refunds_request_uq UNIQUE (payment_request_id), -- 결제 안내마다 들어온 입금의 환불 하나(SPEC-071)
  CONSTRAINT refunds_decision_chk CHECK ((decision = 'none') = (amount = 0)),
  CONSTRAINT refunds_override_chk CHECK (amount = calculated_amount OR override_reason IS NOT NULL),
  CONSTRAINT refunds_floor_chk CHECK (cause = 'compensation' OR amount >= calculated_amount), -- 보상이 아닌 환불은 계산값보다 낮게 정하지 못함(REQ-170). 환불 없이 취소는 계산값 0원일 때만
  CONSTRAINT refunds_change_chk CHECK ((cause = 'change_reduced') = (change_request_id IS NOT NULL)),
  CONSTRAINT refunds_change_decision_chk CHECK (cause <> 'change_reduced' OR decision <> 'full'), -- 금액이 내려간 변경은 차액 돌려주기(일부 환불, 계산값 0원이면 환불 없음)만(SPEC-047)
  CONSTRAINT refunds_issue_chk CHECK ((cause = 'compensation') = (issue_report_id IS NOT NULL)),
  CONSTRAINT refunds_request_chk CHECK ((cause IN ('paid_after_cancel', 'over_received')) = (payment_request_id IS NOT NULL)),
  CONSTRAINT refunds_cancelled_chk CHECK ((cause IN ('customer_cancel', 'shop_cancel')) = (cancelled_order_id IS NOT NULL)), -- 취소 환불에만 취소한 주문
  CONSTRAINT refunds_sent_chk CHECK (sent_at IS NULL OR (decision <> 'none' AND method IS NOT NULL)),
  CONSTRAINT refunds_account_pair_chk CHECK ((refund_account_enc IS NULL) = (refund_account_last4 IS NULL)) -- 암호화한 계좌번호와 끝 4자리는 함께
);
CREATE INDEX refunds_order_idx ON refunds (order_id); -- 환불 합(REQ-165)
COMMENT ON TABLE refunds IS 'TBL-033 환불: 사장님이 계산값을 보고 정한 환불과 보낸 표시';

-- TBL-034 slot_holds (CTX-002) ← SPEC-011, SPEC-012, SPEC-014, SPEC-015, SPEC-029, SPEC-030, SPEC-031, SPEC-033, SPEC-035, SPEC-036, SPEC-037, SPEC-038, SPEC-042, SPEC-043, SPEC-044, SPEC-045, SPEC-046, SPEC-048, SPEC-060, SPEC-070, SPEC-076 | terms: TERM-007
CREATE TABLE slot_holds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 자리 ID
  shop_id             uuid NOT NULL,                     -- 가게
  day                 date NOT NULL,                     -- 자리의 날짜(가게 시간대)
  order_id            uuid NOT NULL,                     -- 자리를 가진 주문
  payment_request_id  uuid,                              -- 잡힘이면 그 결제 안내. 그 결제 기한까지 잡고, 확인 요청됨이면 결제 기한 상한까지(R13, REQ-223). 금액이 오르는 날짜 변경의 새 날 자리는 차액 결제 안내(REQ-234)
  hold_key            text NOT NULL,                     -- 같은 주문의 같은 가예약은 한 번(SPEC-015). 형식 hold:{주문 ID}:{결제 안내 ID}, 날짜 변경은 hold:{주문 ID}:{변경 요청 ID}, 재제작은 hold:{주문 ID}:remake(4절 A33)
  status              text NOT NULL CHECK (status IN ('held', 'fixed', 'released', 'done')), -- 가예약됨·확정됨·해제됨·종료됨(1-4). 한 주문에 잡힌 자리와 확정된 자리는 각각 하나까지이고, 둘이 함께 있는 것은 차액을 기다리는 날짜 변경뿐(트리거 slot_holds_pair, REQ-234)
  overbooked          boolean NOT NULL DEFAULT false,    -- 마감 후 추가 수락: 다 찬 날이나 휴무일에 사장님이 확인하고 받은 자리(R10, REQ-221, REQ-226). 그날은 다른 손님에게 계속 마감(REQ-045)
  fixed_at            timestamptz,                       -- 확정 자리가 된 시각(결제 확인됨, 날짜 변경의 새 날(차액을 기다린 새 날 자리는 변경 반영 때), 재제작)
  released_at         timestamptz,                       -- 풀린 시각
  release_reason      text CHECK (release_reason IN ('payment_overdue', 'order_cancelled', 'date_changed', 'change_closed')), -- 결제 기한 지남·주문 취소·날짜 변경의 옛 날·변경 요청이 반영되지 않고 닫혀 차액을 기다린 새 날을 풂(REQ-234)
  done_at             timestamptz,                       -- 픽업 일시가 지나 종료된 시각
  created_at          timestamptz NOT NULL DEFAULT now(), -- 잡은 시각
  CONSTRAINT slot_holds_day_fk FOREIGN KEY (shop_id, day) REFERENCES calendar_days (shop_id, day) ON DELETE RESTRICT,
  CONSTRAINT slot_holds_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT slot_holds_request_fk FOREIGN KEY (shop_id, payment_request_id) REFERENCES payment_requests (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT slot_holds_key_uq UNIQUE (shop_id, hold_key),
  CONSTRAINT slot_holds_held_chk CHECK (status <> 'held' OR payment_request_id IS NOT NULL), -- 잡힘은 결제 안내의 기한까지
  CONSTRAINT slot_holds_fixed_chk CHECK (status NOT IN ('fixed', 'done') OR fixed_at IS NOT NULL),
  CONSTRAINT slot_holds_released_chk CHECK ((status = 'released') = (released_at IS NOT NULL AND release_reason IS NOT NULL)),
  CONSTRAINT slot_holds_done_chk CHECK ((status = 'done') = (done_at IS NOT NULL))
);
CREATE UNIQUE INDEX slot_holds_one_held_per_order ON slot_holds (order_id) WHERE status = 'held'; -- 주문 하나에 잡힌 자리 하나
CREATE UNIQUE INDEX slot_holds_one_fixed_per_order ON slot_holds (order_id) WHERE status = 'fixed'; -- 주문 하나에 확정된 자리 하나. 잡힌 자리와 함께 있는 것은 차액을 기다리는 날짜 변경뿐(트리거 slot_holds_pair, REQ-234)
CREATE INDEX slot_holds_day_live_idx ON slot_holds (shop_id, day) WHERE status IN ('held', 'fixed', 'done'); -- 날짜별 그날 자리 세기(잡힘 + 확정된 자리 + 종료됨, 1-4)
COMMENT ON TABLE slot_holds IS 'TBL-034 그날 자리(TERM-007): 하루 최대 개수 가운데 한 주문에 묶은 자리(1-4)';

-- TBL-035 productions (CTX-005) ← SPEC-016, SPEC-036, SPEC-045, SPEC-050, SPEC-051, SPEC-053, SPEC-054, SPEC-055, SPEC-058, SPEC-060, SPEC-061, SPEC-070 | terms: TERM-050
CREATE TABLE productions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 제작 ID
  shop_id                     uuid NOT NULL,             -- 가게
  order_id                    uuid NOT NULL,             -- 확정된 주문(재제작 주문 포함)
  needs_custom_material       boolean NOT NULL DEFAULT false, -- 맞춤 재료(TERM-022)가 필요한지. 제작 목록에 보임
  custom_material_ordered_at  timestamptz,               -- 맞춤 재료 주문 시각(환불 근거, REQ-089)
  production_started_at       timestamptz,               -- 제작 시작 시각(환불 근거, REQ-090)
  completed_at                timestamptz,               -- 완성 표시 시각
  changed_after_start         boolean NOT NULL DEFAULT false, -- 재료 주문·제작 시작 뒤 변경이 반영됨. 제작 목록의 '변경됨'(SPEC-045)
  handed_over_at              timestamptz,               -- 인도 시각(REQ-091). 있으면 주문은 받음(4절 A27)
  handover_kind               text CHECK (handover_kind IN ('pickup', 'courier')), -- 픽업 완료됨·퀵(TERM-024)으로 보냄
  no_pickup_at                timestamptz,               -- 미수령(TERM-025) 표시 시각. 인도 시각 없이 있으면 주문은 미수령(4절 A27)
  discarded_at                timestamptz,               -- 미수령 케이크 폐기 시각(REQ-094)
  created_at                  timestamptz NOT NULL DEFAULT now(), -- 제작 목록에 오른 시각(주문 확정)
  CONSTRAINT productions_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT productions_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT productions_order_uq UNIQUE (order_id),     -- 확정된 주문 하나에 제작 하나
  CONSTRAINT productions_handover_chk CHECK ((handed_over_at IS NULL) = (handover_kind IS NULL)),
  CONSTRAINT productions_discard_chk CHECK (discarded_at IS NULL OR (no_pickup_at IS NOT NULL AND handed_over_at IS NULL)) -- 폐기는 미수령 뒤, 폐기한 케이크는 인도할 수 없음(SPEC-055)
);
COMMENT ON TABLE productions IS 'TBL-035 제작(TERM-050): 확정된 주문 하나의 제작부터 인도까지의 시각';

-- TBL-036 production_undos (CTX-005) ← SPEC-051 | terms: TERM-050
CREATE TABLE production_undos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 되돌림 ID
  shop_id        uuid NOT NULL,                          -- 가게
  production_id  uuid NOT NULL,                          -- 제작
  mark           text NOT NULL CHECK (mark IN ('custom_material_ordered', 'production_started', 'completed')), -- 되돌린 표시
  marked_at      timestamptz NOT NULL,                   -- 되돌린 원래 시각
  undone_at      timestamptz NOT NULL DEFAULT now(),     -- 되돌린 시각
  CONSTRAINT production_undos_production_fk FOREIGN KEY (shop_id, production_id) REFERENCES productions (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_undos_window_chk CHECK (undone_at >= marked_at AND undone_at <= marked_at + interval '5 minutes') -- 되돌리기는 5분 안에만(SPEC-051)
);
COMMENT ON TABLE production_undos IS 'TBL-036 제작 표시 되돌린 기록: 잘못 누른 시각을 5분 안에 되돌린 것';

-- TBL-037 completion_photos (CTX-005) ← SPEC-011, SPEC-053, SPEC-063 | terms: TERM-050
CREATE TABLE completion_photos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 완성 사진 ID
  shop_id        uuid NOT NULL,                          -- 가게
  production_id  uuid NOT NULL,                          -- 제작
  position       smallint NOT NULL CHECK (position BETWEEN 1 AND 5), -- 순서(5장까지, SPEC-053)
  storage_key    text NOT NULL,                          -- 저장 위치
  content_type   text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/heic', 'image/webp')), -- 사진 종류
  byte_size      integer NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520), -- 크기(20MB까지)
  created_at     timestamptz NOT NULL DEFAULT now(),     -- 올린 시각
  CONSTRAINT completion_photos_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT completion_photos_production_fk FOREIGN KEY (shop_id, production_id) REFERENCES productions (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT completion_photos_position_uq UNIQUE (production_id, position)
);
COMMENT ON TABLE completion_photos IS 'TBL-037 완성 사진: 사장님이 완성 표시 때 올린 사진';

-- TBL-038 reviews (CTX-006) ← SPEC-062 | terms: TERM-051
CREATE TABLE reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 후기 버전 ID
  shop_id        uuid NOT NULL,                          -- 가게
  order_id       uuid NOT NULL,                          -- 받은 주문(REQ-095)
  version        integer NOT NULL CHECK (version >= 1),  -- 고치면 새 버전(SPEC-062)
  body           text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000), -- 후기 글
  created_at     timestamptz NOT NULL DEFAULT now(),     -- 남긴 시각
  superseded_at  timestamptz,                            -- 새 버전이 생긴 시각
  CONSTRAINT reviews_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT reviews_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT reviews_version_uq UNIQUE (order_id, version)
);
CREATE UNIQUE INDEX reviews_one_current_per_order ON reviews (order_id) WHERE superseded_at IS NULL; -- 주문마다 후기 하나(SPEC-062)
COMMENT ON TABLE reviews IS 'TBL-038 후기(TERM-051): 받은 주문에 손님이 남긴 글';

-- TBL-039 review_photos (CTX-006) ← SPEC-011, SPEC-062, SPEC-063 | terms: TERM-051
CREATE TABLE review_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 후기 사진 ID
  shop_id       uuid NOT NULL,                           -- 가게
  review_id     uuid NOT NULL,                           -- 후기 버전
  position      smallint NOT NULL CHECK (position BETWEEN 1 AND 5), -- 순서(5장까지)
  storage_key   text NOT NULL,                           -- 저장 위치
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/heic', 'image/webp')), -- 사진 종류
  byte_size     integer NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520), -- 크기(20MB까지)
  created_at    timestamptz NOT NULL DEFAULT now(),      -- 올린 시각
  CONSTRAINT review_photos_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT review_photos_review_fk FOREIGN KEY (shop_id, review_id) REFERENCES reviews (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT review_photos_position_uq UNIQUE (review_id, position)
);
COMMENT ON TABLE review_photos IS 'TBL-039 후기 사진: 후기에 붙은 사진(5장까지)';

-- TBL-040 photo_consents (CTX-006) ← SPEC-053, SPEC-062, SPEC-063 | terms: TERM-051
CREATE TABLE photo_consents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 게시 동의 ID
  shop_id              uuid NOT NULL,                    -- 가게
  order_id             uuid NOT NULL,                    -- 주문
  scope                text NOT NULL CHECK (scope IN ('completion_photo', 'review_photo')), -- 완성 사진 한 장의 동의(완성 사진 안내의 버튼, SPEC-053)·후기 사진 한 장의 동의(SPEC-062)
  completion_photo_id  uuid,                             -- 완성 사진의 동의면 그 사진. 안내 하나의 답을 그 안내에 붙인 사진마다 남김(REQ-207)
  review_photo_id      uuid,                             -- 후기 사진의 동의면 그 사진(REQ-208)
  consented            boolean NOT NULL DEFAULT false,   -- 동의 여부. 기본 '동의 안 함'(REQ-207, REQ-208)
  decided_at           timestamptz NOT NULL DEFAULT now(), -- 답한 시각
  withdrawn_at         timestamptz,                      -- 손님이 동의를 철회한 시각. 그 사진을 포트폴리오에서 먼저 내린 뒤 씀(REQ-098, SPEC-063)
  publishable          boolean NOT NULL DEFAULT false,   -- 포트폴리오에 올릴 수 있음: 동의했고 철회하지 않은 것과 늘 같음. 올라 있는 항목이 이 값을 참조해 올린 채로는 철회를 쓰지 못함(REQ-209, 4절 A26). 잠정, 5-2 질문 6
  CONSTRAINT photo_consents_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT photo_consents_live_key UNIQUE (shop_id, id, publishable), -- 포트폴리오 항목이 '게시 가능'인 동의를 참조하는 키
  CONSTRAINT photo_consents_review_photo_key UNIQUE (shop_id, id, review_photo_id), -- 포트폴리오 항목의 후기 사진이 이 동의의 사진인지 보는 키
  CONSTRAINT photo_consents_completion_photo_key UNIQUE (shop_id, id, completion_photo_id), -- 포트폴리오 항목의 완성 사진이 이 동의의 사진인지 보는 키
  CONSTRAINT photo_consents_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT photo_consents_photo_fk FOREIGN KEY (shop_id, review_photo_id) REFERENCES review_photos (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT photo_consents_completion_photo_fk FOREIGN KEY (shop_id, completion_photo_id) REFERENCES completion_photos (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT photo_consents_scope_chk CHECK ((scope = 'review_photo') = (review_photo_id IS NOT NULL) AND (scope = 'completion_photo') = (completion_photo_id IS NOT NULL)), -- 동의마다 사진 한 장
  CONSTRAINT photo_consents_withdraw_chk CHECK (withdrawn_at IS NULL OR consented),
  CONSTRAINT photo_consents_publishable_chk CHECK (publishable = (consented AND withdrawn_at IS NULL)) -- 게시 가능은 동의함·철회 안 함
);
CREATE UNIQUE INDEX photo_consents_completion_photo_uq ON photo_consents (completion_photo_id) WHERE scope = 'completion_photo'; -- 완성 사진마다 동의 하나(REQ-207)
CREATE UNIQUE INDEX photo_consents_review_photo_uq ON photo_consents (review_photo_id) WHERE scope = 'review_photo'; -- 사진마다 동의 하나(SPEC-062)
COMMENT ON TABLE photo_consents IS 'TBL-040 사진 게시 동의: 완성 사진과 후기 사진 한 장마다 받은 동의와 철회';

-- TBL-041 portfolio_items (CTX-006) ← SPEC-011, SPEC-063 | terms: TERM-052
CREATE TABLE portfolio_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 포트폴리오 항목 ID
  shop_id              uuid NOT NULL,                    -- 가게
  photo_consent_id     uuid NOT NULL,                    -- 근거가 되는 게시 동의. 그 사진의 동의이고 동의함·철회 안 함이어야 올림(REQ-209)
  review_photo_id      uuid,                             -- 올린 후기 사진
  completion_photo_id  uuid,                             -- 올린 완성 사진(완성 사진 안내에서 받은 동의, REQ-207)
  published_at         timestamptz NOT NULL DEFAULT now(), -- 올린 시각
  unpublished_at       timestamptz,                      -- 내린 시각. 예약 링크 페이지에서 5분 안에 사라짐(SPEC-063)
  unpublish_reason     text CHECK (unpublish_reason IN ('consent_withdrawn', 'owner_removed')), -- 동의 철회·사장님이 내림
  consent_live         boolean DEFAULT true CHECK (consent_live), -- 올라 있는 동안 참, 내리면 비움. 근거 동의의 게시 가능을 참조해 동의하고 철회하지 않은 사진만 올라 있게 함(REQ-209, 5절 E22)
  CONSTRAINT portfolio_items_consent_fk FOREIGN KEY (shop_id, photo_consent_id) REFERENCES photo_consents (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT portfolio_items_review_photo_fk FOREIGN KEY (shop_id, review_photo_id) REFERENCES review_photos (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT portfolio_items_completion_photo_fk FOREIGN KEY (shop_id, completion_photo_id) REFERENCES completion_photos (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT portfolio_items_consent_live_fk FOREIGN KEY (shop_id, photo_consent_id, consent_live) REFERENCES photo_consents (shop_id, id, publishable) ON DELETE RESTRICT, -- 올라 있으면 동의가 게시 가능. 철회는 먼저 내린 뒤(4절 A26)
  CONSTRAINT portfolio_items_consent_review_photo_fk FOREIGN KEY (shop_id, photo_consent_id, review_photo_id) REFERENCES photo_consents (shop_id, id, review_photo_id) ON DELETE RESTRICT, -- 후기 사진은 그 사진의 동의로만
  CONSTRAINT portfolio_items_consent_completion_photo_fk FOREIGN KEY (shop_id, photo_consent_id, completion_photo_id) REFERENCES photo_consents (shop_id, id, completion_photo_id) ON DELETE RESTRICT, -- 완성 사진은 그 사진의 동의로만
  CONSTRAINT portfolio_items_one_photo_chk CHECK ((review_photo_id IS NULL) <> (completion_photo_id IS NULL)), -- 사진 하나
  CONSTRAINT portfolio_items_unpublish_chk CHECK ((unpublished_at IS NULL) = (unpublish_reason IS NULL)),
  CONSTRAINT portfolio_items_live_chk CHECK ((unpublished_at IS NULL) = (consent_live IS NOT NULL)) -- 올라 있는 항목만 동의가 살아 있음을 봄
);
CREATE UNIQUE INDEX portfolio_items_review_photo_live ON portfolio_items (review_photo_id) WHERE unpublished_at IS NULL; -- 같은 사진은 한 번만 올림
CREATE UNIQUE INDEX portfolio_items_completion_photo_live ON portfolio_items (completion_photo_id) WHERE unpublished_at IS NULL;
CREATE INDEX portfolio_items_consent_idx ON portfolio_items (photo_consent_id) WHERE unpublished_at IS NULL; -- 동의를 철회하면 먼저 내릴 행 찾기
COMMENT ON TABLE portfolio_items IS 'TBL-041 포트폴리오(TERM-052): 손님이 게시에 동의한 사진만 올린 목록';

-- TBL-042 owner_tasks (CTX-008) ← SPEC-003, SPEC-007, SPEC-022, SPEC-023, SPEC-024, SPEC-029, SPEC-031, SPEC-033, SPEC-034, SPEC-035, SPEC-036, SPEC-037, SPEC-041, SPEC-042, SPEC-045, SPEC-046, SPEC-047, SPEC-048, SPEC-049, SPEC-058, SPEC-059, SPEC-064, SPEC-065, SPEC-067, SPEC-071, SPEC-077 | terms: TERM-059
CREATE TABLE owner_tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 할 일 ID
  shop_id             uuid NOT NULL,                     -- 가게
  kind                text NOT NULL CHECK (kind IN ('handoff', 'custom_order', 'change_request', 'issue_report', 'payment_claim', 'payment_mismatch', 'payment_overdue', 'refund_decision', 'paid_after_cancel', 'ledger_relink', 'license_on_hold', 'calendar_conflict', 'refund_send', 'arrival_check')), -- 에스컬레이션 건·맞춤 주문·변경 요청·문제 신고·결제 확인 요청·맞추는 중·결제 기한 지남·환불 결정·취소 뒤 들어온 입금·장부 다시 연결·영업 신고 보류·영업 캘린더 기준을 넘는 날·환불 보내기(REQ-173)·들어온 입금 대조(REQ-167)
  event_key           text NOT NULL,                     -- 할 일을 만든 이벤트 키. 할 일마다 한 번(G2). 형식 task:{만든 이벤트}:{대상 ID}(4절 A33)
  order_id            uuid,                              -- 관련 주문
  handoff_id          uuid,                              -- 에스컬레이션 건
  change_request_id   uuid,                              -- 변경 요청
  issue_report_id     uuid,                              -- 문제 신고
  payment_request_id  uuid,                              -- 결제 안내
  refund_id           uuid,                              -- 보낼 환불(환불 보내기, REQ-173)
  wait_status         text CHECK (wait_status IN ('waiting', 'late', 'answered', 'closed_no_answer')), -- 사장님 답 기다림(1-7): 기다림·지연(지연 안내와 다시 알림 뒤 할 일 목록에 남음)·답함·답 없어 닫힘. 에스컬레이션 건·맞춤 주문·변경 요청·문제 신고·결제 확인 요청·맞추는 중·환불 결정만(REQ-215)
  wait_due_at         timestamptz,                       -- 지연 안내를 보낼 시각: 기다리는 시간을 답하는 시간 안에서만 셈(REQ-118). 답 없어 닫는 때(1-7)와 다름
  late_notice_at      timestamptz,                       -- 손님에게 지연 안내(TERM-036)를 낸 시각(한 번, REQ-116, REQ-156, REQ-215)
  realerted_at        timestamptz,                       -- 사장님께 다시 알린 시각(한 번): 지연 뒤(REQ-117, REQ-215), 환불 보내기는 환불을 정하고 24시간 뒤(REQ-173)
  detail              jsonb,                             -- 보일 글감(보류 이유, 기준을 넘는 날과 주문 수 등). 손님 연락처·계좌·알레르기 없음. 주문이 끝나고 30일 뒤 비움(SPEC-065)
  opened_at           timestamptz NOT NULL DEFAULT now(), -- 생긴 시각
  closed_at           timestamptz,                       -- 사장님이 처리해 닫히거나 답 없어 닫힌 시각(SPEC-067, 1-7)
  CONSTRAINT owner_tasks_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT owner_tasks_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT owner_tasks_handoff_fk FOREIGN KEY (shop_id, handoff_id) REFERENCES handoffs (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT owner_tasks_change_fk FOREIGN KEY (shop_id, change_request_id) REFERENCES change_requests (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT owner_tasks_issue_fk FOREIGN KEY (shop_id, issue_report_id) REFERENCES issue_reports (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT owner_tasks_request_fk FOREIGN KEY (shop_id, payment_request_id) REFERENCES payment_requests (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT owner_tasks_refund_fk FOREIGN KEY (shop_id, refund_id) REFERENCES refunds (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT owner_tasks_event_uq UNIQUE (shop_id, event_key),
  CONSTRAINT owner_tasks_wait_kind_chk CHECK ((kind IN ('handoff', 'custom_order', 'change_request', 'issue_report', 'payment_claim', 'payment_mismatch', 'refund_decision')) = (wait_status IS NOT NULL AND wait_due_at IS NOT NULL)), -- 지연 안내는 이 일곱에만(REQ-116, REQ-156, REQ-215)
  CONSTRAINT owner_tasks_subject_chk CHECK (
    (kind <> 'handoff' OR handoff_id IS NOT NULL)
    AND (kind <> 'change_request' OR change_request_id IS NOT NULL)
    AND (kind <> 'issue_report' OR issue_report_id IS NOT NULL)
    AND (kind NOT IN ('payment_claim', 'payment_mismatch', 'arrival_check') OR payment_request_id IS NOT NULL)
    AND (kind <> 'refund_send' OR refund_id IS NOT NULL)
    AND (kind NOT IN ('custom_order', 'payment_overdue', 'refund_decision', 'paid_after_cancel', 'refund_send', 'arrival_check') OR order_id IS NOT NULL)), -- 할 일마다 참조할 대상이 있음
  CONSTRAINT owner_tasks_late_chk CHECK (wait_status IS DISTINCT FROM 'late' OR late_notice_at IS NOT NULL), -- 지연은 지연 안내 뒤. 지연 안내 전에 닫는 때가 오면 지연 안내 없이 닫힘(1-7)
  CONSTRAINT owner_tasks_answered_chk CHECK (wait_status IS NULL OR (wait_status IN ('answered', 'closed_no_answer')) = (closed_at IS NOT NULL)), -- 기다림은 답함·답 없어 닫힘일 때 닫힘
  CONSTRAINT owner_tasks_no_answer_chk CHECK (wait_status IS DISTINCT FROM 'closed_no_answer' OR kind IN ('handoff', 'custom_order', 'change_request', 'payment_claim')) -- 답 없어 닫힘은 닫는 때가 있는 넷만. 맞추는 중·환불 결정·문제 신고는 사장님만 끝냄(1-7)
);
CREATE INDEX owner_tasks_open_idx ON owner_tasks (shop_id, opened_at) WHERE closed_at IS NULL; -- 할 일 목록(TERM-059)
CREATE INDEX owner_tasks_wait_due_idx ON owner_tasks (wait_due_at) WHERE wait_status = 'waiting'; -- 지연 안내 보낼 것 찾기(SPEC-024)
COMMENT ON TABLE owner_tasks IS 'TBL-042 사장님 할 일: 사장님이 정할 일과 사장님 답 기다림(1-7)';

-- TBL-043 owner_alerts (CTX-008) ← SPEC-003, SPEC-006, SPEC-022, SPEC-024, SPEC-044, SPEC-046, SPEC-048, SPEC-050, SPEC-057, SPEC-058, SPEC-064, SPEC-065, SPEC-067, SPEC-076, SPEC-078 | terms: TERM-035
CREATE TABLE owner_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 사장님 알림 ID
  shop_id          uuid NOT NULL,                        -- 가게
  owner_task_id    uuid,                                 -- 알린 할 일. 상담을 지울 때 그 상담의 에스컬레이션 할 일은 지우고 이 연결만 비움(SPEC-065, 설계 재검토 H3)
  kind             text NOT NULL CHECK (kind IN ('new_task', 'task_realert', 'handoff_appended', 'health_concern', 'ledger_failing', 'license_on_hold', 'order_cancelled', 'change_not_applied', 'payment_account_changed', 'identity_change_applied', 'identity_change_on_hold')), -- 새 할 일·지연 뒤 다시 알림·새 질문 덧붙음·먹고 아프다는 신고·장부 적기 실패·영업 신고 보류·주문 취소됨(SPEC-050)·변경 반영 안 됨(SPEC-044)·결제 받을 계좌 바뀜(할 일 없이 알림만, 계좌번호 없음, SPEC-067, REQ-198)·사업자 정보 변경 반영됨·보류됨(할 일 없이 알림만, SPEC-078, REQ-245)
  event_key        text NOT NULL,                        -- 알림마다 한 번(SPEC-067). 형식 alert:{알린 일}:{할 일 ID나 대상 ID}, 하루 한 번까지인 다시 알림은 뒤에 :{가게 날짜}(4절 A33)
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirming', 'sent', 'not_friend', 'failed', 'batched')), -- 보낼 것·발송 결과 확인 중·보냄(닿음 확인)·우리 채널 친구가 아님·실패(할 일 목록에만)·다른 알림에 묶임
  batched_into_id  uuid,                                 -- 1분 안 같은 종류는 하나로 묶어 보냄(SPEC-067)
  attempts         smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4), -- 보낸 횟수(처음과 1분·5분·30분 뒤, G4)
  next_attempt_at  timestamptz,                          -- 다음에 보낼 시각
  sent_at          timestamptz,                          -- 보낸 시각
  kakao_task_id    text CHECK (char_length(kakao_task_id) BETWEEN 1 AND 100), -- 카카오가 받은 Event API 요청의 taskId. 발송 결과 조회에 씀(SPEC-067, REQ-182)
  requested_at     timestamptz,                          -- 카카오가 Event API 요청을 받은 시각
  delivery_checked_at timestamptz,                       -- 발송 결과를 마지막으로 조회한 시각(1분·5분·30분 뒤)
  fail_code        text CHECK (fail_code IN ('not_friend', 'cannot_send', 'skill_error', 'event_setup', 'wallet', 'limit', 'kakao_error', 'unknown')), -- 카카오가 받지 않거나 전하지 못한 사유. unknown은 30분 뒤에도 결과를 모름(SPEC-067)
  created_at       timestamptz NOT NULL DEFAULT now(),   -- 만든 시각
  CONSTRAINT owner_alerts_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT owner_alerts_task_fk FOREIGN KEY (shop_id, owner_task_id) REFERENCES owner_tasks (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT owner_alerts_batch_fk FOREIGN KEY (shop_id, batched_into_id) REFERENCES owner_alerts (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT owner_alerts_event_uq UNIQUE (shop_id, event_key),
  CONSTRAINT owner_alerts_batched_chk CHECK ((status = 'batched') = (batched_into_id IS NOT NULL)),
  CONSTRAINT owner_alerts_sent_chk CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT owner_alerts_kakao_task_chk CHECK (status NOT IN ('confirming', 'sent') OR (kakao_task_id IS NOT NULL AND requested_at IS NOT NULL)) -- 확인 중·보냄은 카카오가 받은 요청이 있음(REQ-182)
);
CREATE INDEX owner_alerts_due_idx ON owner_alerts (next_attempt_at) WHERE status = 'pending'; -- 보낼 알림
CREATE INDEX owner_alerts_confirming_idx ON owner_alerts (requested_at) WHERE status = 'confirming'; -- 발송 결과를 조회할 알림(REQ-182)
COMMENT ON TABLE owner_alerts IS 'TBL-043 사장님 알림(TERM-035): 우리 서비스 채널 봇이 사장님의 카카오 로그인 사용자 번호로 보내는 할 일 종류와 목록 주소';

-- TBL-044 notifications (CTX-008) ← SPEC-022, SPEC-023, SPEC-024, SPEC-029, SPEC-031, SPEC-032, SPEC-035, SPEC-036, SPEC-039, SPEC-042, SPEC-044, SPEC-045, SPEC-047, SPEC-048, SPEC-052, SPEC-053, SPEC-059, SPEC-061, SPEC-065, SPEC-066, SPEC-070 | terms: TERM-054
CREATE TABLE notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 알림 ID
  shop_id          uuid NOT NULL,                        -- 가게
  customer_id      uuid NOT NULL,                        -- 받을 손님
  consultation_id  uuid NOT NULL,                        -- 그 손님의 상담. 상담이 문의 끊김이어도 이 안내는 보내고, 못 보내면 다음 대화 때(새 상담이면 고지 뒤) 먼저 전함(REQ-122, REQ-212)
  order_id         uuid,                                 -- 관련 주문
  kind             text NOT NULL CHECK (kind IN ('owner_reply', 'delay_notice', 'channel_add', 'custom_rejected', 'payment_request', 'payment_mismatch', 'order_confirmed', 'cancelled', 'change_result', 'change_not_applied', 'refund', 'compensation', 'day_before', 'completion_photo', 'review_request', 'refund_sent', 'payment_corrected', 'no_answer_closed')), -- 사장님 답·지연 안내(TERM-036)·채널 추가 권함·맞춤 거절·결제 안내·금액 불일치·확정 안내·취소·변경 결과(반영·거절)·변경 안 됨·환불·보상·전날 안내·완성 사진·후기 부탁·환불 보냄(REQ-172)·결제 확인 정정(REQ-169)·답 없어 닫힘(맞춤 주문 요청·변경 요청·에스컬레이션 건, REQ-213, REQ-214, REQ-216)
  event_key        text NOT NULL,                        -- 같은 주문의 같은 이벤트는 한 번(REQ-154). 형식 notice:{대상 ID}:{안내 종류}(4절 A33)
  template_key     text NOT NULL,                        -- 서버의 정해진 템플릿. AI가 쓰지 않고 광고를 넣지 않음(REQ-111)
  body             text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000), -- 보낼 글. 다른 손님 정보·내부 ID 없음(G6). 결제 안내의 가게 계좌번호는 넣지 않고 자리만 두어 안내를 보일 때 채움(SPEC-032, REQ-191). 주문이 끝나고 30일 뒤나 상담을 지울 때 행째 지움(SPEC-065)
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'confirming', 'sent', 'deferred', 'delivered_on_reply', 'dropped')), -- 보낼 것·다시 보낼 것·발송 결과 확인 중·보냄(닿음 확인)·못 보냄(다음 대화 때 먼저)·다음 대화 때 전함·무의미해져 안 보냄
  scheduled_for    timestamptz,                          -- 정해진 시각 안내(전날·후기)의 보낼 시각. 가게 시간 08:00~20:50 안(REQ-123)
  attempts         smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4), -- 보낸 횟수(처음과 1분·5분·30분 뒤, G4)
  next_attempt_at  timestamptz,                          -- 다음에 보낼 시각
  sent_at          timestamptz,                          -- 보낸(전한) 시각
  kakao_task_id    text CHECK (char_length(kakao_task_id) BETWEEN 1 AND 100), -- 카카오가 받은 Event API 요청의 taskId. 발송 결과 조회에 씀(SPEC-066, REQ-182)
  requested_at     timestamptz,                          -- 카카오가 Event API 요청을 받은 시각
  delivery_checked_at timestamptz,                       -- 발송 결과를 마지막으로 조회한 시각(1분·5분·30분 뒤)
  fail_code        text CHECK (fail_code IN ('not_friend', 'cannot_send', 'skill_error', 'event_setup', 'wallet', 'limit', 'kakao_error', 'unknown')), -- 카카오가 받지 않거나 전하지 못한 사유. unknown은 30분 뒤에도 결과를 모름(SPEC-066)
  created_at       timestamptz NOT NULL DEFAULT now(),   -- 만든 시각
  CONSTRAINT notifications_customer_fk FOREIGN KEY (shop_id, customer_id) REFERENCES customers (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT notifications_consultation_fk FOREIGN KEY (shop_id, consultation_id, customer_id) REFERENCES consultations (shop_id, id, customer_id) ON DELETE RESTRICT, -- 안내할 상담과 그 상담의 손님(설계 재검토 M17)
  CONSTRAINT notifications_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT notifications_event_uq UNIQUE (shop_id, event_key),
  CONSTRAINT notifications_sent_chk CHECK ((status IN ('sent', 'delivered_on_reply')) = (sent_at IS NOT NULL)),
  CONSTRAINT notifications_kakao_task_chk CHECK (status NOT IN ('confirming', 'sent') OR (kakao_task_id IS NOT NULL AND requested_at IS NOT NULL)) -- 확인 중·보냄은 카카오가 받은 요청이 있음(REQ-182)
);
CREATE INDEX notifications_due_idx ON notifications (next_attempt_at) WHERE status IN ('pending', 'retrying'); -- 보낼 것
CREATE INDEX notifications_deferred_idx ON notifications (customer_id, created_at) WHERE status = 'deferred'; -- 그 손님이 말을 걸면 먼저 전함(REQ-122)
CREATE INDEX notifications_confirming_idx ON notifications (requested_at) WHERE status = 'confirming'; -- 발송 결과를 조회할 안내(REQ-182)
COMMENT ON TABLE notifications IS 'TBL-044 알림(TERM-054): 손님에게 먼저 보내는 안내 하나';

-- TBL-045 ledger_links (CTX-009) ← SPEC-009, SPEC-064 | terms: TERM-028
CREATE TABLE ledger_links (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 장부 연결 ID
  shop_id             uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT, -- 가게
  provider            text NOT NULL DEFAULT 'google_sheets' CHECK (provider IN ('google_sheets')), -- 장부 종류(첫 버전은 구글 시트)
  spreadsheet_id      text NOT NULL,                     -- 고른 시트 파일
  sheet_name          text NOT NULL,                     -- 고른 시트 탭
  our_columns         jsonb NOT NULL,                    -- 우리가 쓰는 열의 헤더와 자리. 같은 이름의 사장님 열이 있으면 오른쪽 빈 열(SPEC-009)
  credential_ref      text NOT NULL,                     -- 구글 OAuth 토큰이 있는 시크릿 저장소의 이름. 토큰 자체는 두지 않음(REQ-135)
  status              text NOT NULL DEFAULT 'linked' CHECK (status IN ('linked', 'auth_lost', 'unlinked')), -- 연결됨·권한 해제됨·사장님이 끊음
  failure_alerted_at  timestamptz,                       -- 24시간 실패·권한 해제됨을 사장님께 알린 시각(한 번, REQ-159)
  linked_at           timestamptz NOT NULL DEFAULT now(), -- 연결한 시각
  unlinked_at         timestamptz,                       -- 끊은 시각
  CONSTRAINT ledger_links_unlinked_chk CHECK ((status = 'unlinked') = (unlinked_at IS NOT NULL))
);
CREATE UNIQUE INDEX ledger_links_one_live_per_shop ON ledger_links (shop_id) WHERE status <> 'unlinked'; -- 가게마다 연결된 장부 하나
COMMENT ON TABLE ledger_links IS 'TBL-045 장부(TERM-028) 연결: 사장님 구글 시트와의 연결';

-- TBL-046 ledger_rows (CTX-009) ← SPEC-060, SPEC-064 | terms: TERM-055
CREATE TABLE ledger_rows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 장부 행 ID
  shop_id           uuid NOT NULL,                       -- 가게
  order_id          uuid NOT NULL,                       -- 주문. 재제작 주문의 행은 두지 않고 그 이벤트를 원래 주문 행에 적음(트리거 ledger_rows_remake, R21, SPEC-064)
  first_written_at  timestamptz,                         -- 처음 적은 시각
  last_written_at   timestamptz,                         -- 마지막으로 고친 시각
  CONSTRAINT ledger_rows_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT ledger_rows_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT ledger_rows_order_uq UNIQUE (order_id)     -- 주문 하나에 장부 한 행(REQ-126). 시트에서는 주문번호로 그 행을 찾음
);
COMMENT ON TABLE ledger_rows IS 'TBL-046 장부 행(TERM-055): 장부에 옮겨 적는 주문 한 행의 우리 쪽 기록';

-- TBL-047 ledger_writes (CTX-009) ← SPEC-009, SPEC-036, SPEC-039, SPEC-045, SPEC-046, SPEC-047, SPEC-048, SPEC-054, SPEC-055, SPEC-060, SPEC-064, SPEC-070, SPEC-076 | terms: TERM-055
CREATE TABLE ledger_writes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 장부 쓰기 ID
  shop_id          uuid NOT NULL,                        -- 가게
  ledger_row_id    uuid NOT NULL,                        -- 장부 행
  event_key        text NOT NULL,                        -- 이벤트마다 한 번(REQ-132). 형식 ledger:{대상 ID}:{이벤트 종류}, 재제작은 ledger:{대상 ID}:remake:{재제작 주문의 일}. 대상은 그 일을 만든 기록(주문 확정은 주문을 확정한 결제, 변경은 변경 요청, 환불은 환불, 4절 A33)
  event_kind       text NOT NULL CHECK (event_kind IN ('confirmed', 'changed', 'cancelled', 'refund', 'handed_over', 'no_pickup', 'remake', 'refund_sent', 'payment_voided')), -- 확정·변경·취소·환불·인도·미수령·재제작(원래 주문 행에 재제작 주문의 만듦·변경·인도·미수령·취소, SPEC-060)·환불 보냄(REQ-172)·결제 확인 취소(REQ-169)
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'written', 'alerted', 'unlinked')), -- 기다림·다시 적기·적힘·사장님께 알림·연결 끊김(1-8)
  attempts         smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0), -- 적기를 해 본 횟수
  next_attempt_at  timestamptz,                          -- 다음 시도(1분·5분·30분·2시간·6시간, 그 뒤 하루 한 번)
  first_failed_at  timestamptz,                          -- 처음 실패한 시각(24시간 실패 셈, R3)
  last_error_kind  text,                                 -- 마지막 실패 종류(내용·시크릿 없음)
  written_at       timestamptz,                          -- 적힌 시각. 적을 때는 그 주문의 지금 값으로(옛 값이 새 값을 덮지 않음)
  created_at       timestamptz NOT NULL DEFAULT now(),   -- 남긴 시각
  CONSTRAINT ledger_writes_row_fk FOREIGN KEY (shop_id, ledger_row_id) REFERENCES ledger_rows (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT ledger_writes_event_uq UNIQUE (shop_id, event_key),
  CONSTRAINT ledger_writes_written_chk CHECK ((status = 'written') = (written_at IS NOT NULL))
);
CREATE INDEX ledger_writes_due_idx ON ledger_writes (next_attempt_at) WHERE status IN ('pending', 'retrying'); -- 적을 것
COMMENT ON TABLE ledger_writes IS 'TBL-047 장부 쓰기: 이벤트마다 한 번 남기고 실패하면 다시 적음(1-8)';

-- TBL-048 ai_calls (CTX-001) ← SPEC-017, SPEC-020, SPEC-021, SPEC-068, SPEC-077 | terms: TERM-045
CREATE TABLE ai_calls (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- AI 호출 ID
  shop_id             uuid NOT NULL,                     -- 가게
  consultation_id     uuid NOT NULL,                     -- 대화 ID. 상담마다 비용 합(REQ-150)
  trace_id            text NOT NULL,                     -- 요청 추적 ID: 손님 메시지 한 차례의 그래프 실행(AI-1)
  attempt             smallint NOT NULL DEFAULT 1 CHECK (attempt >= 1), -- 차례 안 호출 순번(1부터, 위 끝 없음). 차례마다 호출 상한(8번)은 AI-1이 호출 전에 막음
  call_kind           text NOT NULL DEFAULT 'first' CHECK (call_kind IN ('first', 'after_tool', 'retry', 'regenerate')), -- 다시 한 종류: 처음·도구 뒤 이어 하기·다시 하기(시간 초과·429·5xx)·다시 쓰기(서버 확인을 지나지 못한 답·빈 답). 처음은 순번 1에만
  provider            text NOT NULL,                     -- 모델 회사(고르는 날 정함, AI-1)
  model               text NOT NULL,                     -- 모델
  prompt_version      text NOT NULL,                     -- 프롬프트 버전
  reasoning           jsonb,                             -- 추론 설정(effort·thinking 등)
  sent_at             timestamptz NOT NULL,              -- 보낸 시각
  first_token_ms      integer CHECK (first_token_ms >= 0), -- 보낸 뒤 첫 토큰까지(밀리초)
  total_ms            integer CHECK (total_ms >= 0),     -- 끝까지(밀리초)
  input_tokens        integer CHECK (input_tokens >= 0), -- 입력 토큰
  output_tokens       integer CHECK (output_tokens >= 0), -- 출력 토큰
  cache_read_tokens   integer CHECK (cache_read_tokens >= 0), -- 캐시에서 읽은 토큰
  cache_write_tokens  integer CHECK (cache_write_tokens >= 0), -- 캐시에 쓴 토큰
  cost_usd            numeric(12, 6) CHECK (cost_usd >= 0), -- 비용(달러, 모델 회사 요금표)
  cost_krw            numeric(12, 2) CHECK (cost_krw >= 0), -- 비용(원). 가게 하루 AI 비용 한도의 셈(REQ-163)
  cost_basis          text,                              -- 요금표 버전과 환율 기준
  result              text NOT NULL CHECK (result IN ('success', 'failure', 'timeout', 'limit_reached')), -- 결과: 성공·실패·시간 초과·한도(가게 하루 한도나 모델 사용 한도)
  stop_reason         text,                              -- 모델 회사가 준 멈춘 사유
  error_kind          text,                              -- 실패 종류(내용 없이)
  fallback_reason     text CHECK (fallback_reason IN ('schema_invalid', 'amount_mismatch', 'forbidden_phrase', 'clause_mismatch', 'placeholder_or_ad', 'card_not_allowed', 'empty_answer', 'model_error', 'timeout', 'cost_limit', 'call_limit')), -- 정해진 문장이나 에스컬레이션을 쓴 이유(AI-1의 서버 확인·실패·차례마다 호출 상한)
  created_at          timestamptz NOT NULL DEFAULT now(), -- 남긴 시각
  CONSTRAINT ai_calls_shop_scope UNIQUE (shop_id, id),
  CONSTRAINT ai_calls_consultation_fk FOREIGN KEY (shop_id, consultation_id) REFERENCES consultations (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT ai_calls_attempt_uq UNIQUE (trace_id, attempt),
  CONSTRAINT ai_calls_kind_chk CHECK ((call_kind = 'first') = (attempt = 1)), -- 처음은 순번 1에만(설계 재검토 RC-07)
  CONSTRAINT ai_calls_success_chk CHECK (result <> 'success' OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND cost_krw IS NOT NULL)) -- 성공한 호출은 토큰과 비용을 남김(REQ-150)
);
CREATE INDEX ai_calls_shop_time_idx ON ai_calls (shop_id, sent_at); -- 가게 하루 비용 합(REQ-163)
CREATE INDEX ai_calls_consultation_idx ON ai_calls (consultation_id); -- 상담별 비용(REQ-150)
COMMENT ON TABLE ai_calls IS 'TBL-048 AI 호출 기록: 호출마다 모델·프롬프트 버전·토큰·시간·비용·결과. 대화 글·개인정보·시크릿 없음';

-- TBL-049 ai_tool_calls (CTX-001) ← SPEC-013, SPEC-014, SPEC-020, SPEC-021, SPEC-026, SPEC-040, SPEC-065 | terms: none
CREATE TABLE ai_tool_calls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 도구 호출 ID
  shop_id          uuid NOT NULL,                        -- 가게
  ai_call_id       uuid NOT NULL,                        -- 도구를 호출한 AI 호출
  consultation_id  uuid NOT NULL,                        -- 대화 ID
  tool_name        text NOT NULL CHECK (tool_name IN ('quote', 'check_day', 'read_clause', 'read_my_orders')), -- 읽기 도구만: 견적 계산·날짜 판정·조문 읽기·내 주문 읽기(AI-1)
  target_id        uuid,                                 -- 대상 ID(초안·조문·주문)
  args_masked      jsonb NOT NULL,                       -- 개인정보를 마스킹한 인자
  result           text NOT NULL CHECK (result IN ('ok', 'error', 'denied')), -- 됨·오류·거절(다른 사용자·다른 가게)
  duration_ms      integer CHECK (duration_ms >= 0),     -- 걸린 시간(밀리초)
  called_at        timestamptz NOT NULL DEFAULT now(),   -- 호출한 시각
  CONSTRAINT ai_tool_calls_call_fk FOREIGN KEY (shop_id, ai_call_id) REFERENCES ai_calls (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT ai_tool_calls_consultation_fk FOREIGN KEY (shop_id, consultation_id) REFERENCES consultations (shop_id, id) ON DELETE RESTRICT
);
CREATE INDEX ai_tool_calls_call_idx ON ai_tool_calls (ai_call_id); -- 호출마다 도구 목록
COMMENT ON TABLE ai_tool_calls IS 'TBL-049 AI 도구 호출 기록: 이름·결과·대화 ID·대상 ID·마스킹한 인자';

-- TBL-050 request_keys (공통) ← SPEC-002, SPEC-003, SPEC-004, SPEC-005, SPEC-007, SPEC-031, SPEC-034, SPEC-038, SPEC-039, SPEC-042, SPEC-047, SPEC-048, SPEC-051, SPEC-054, SPEC-059, SPEC-065, SPEC-070, SPEC-071, SPEC-077, SPEC-078 | terms: none
CREATE TABLE request_keys (
  actor_kind       text NOT NULL CHECK (actor_kind IN ('owner', 'operator')), -- 누른 쪽: 사장님·운영자
  actor_id         uuid NOT NULL,                        -- 그 사람의 ID(owners.id나 operators.id)
  request_key      text NOT NULL CHECK (char_length(request_key) BETWEEN 16 AND 64), -- 화면이 만든 요청 키(G2)
  command          text NOT NULL,                        -- 명령 이름
  request_hash     text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'), -- 요청 지문: 명령·경로의 ID·본문을 정한 차례로 이어 시크릿 저장소의 키로 만든 HMAC-SHA256(16진수 64자). 같은 키에 지문이 다르면 422 idempotency_key_reused(06 DEC-04). 본문의 값은 지문으로만 남음
  state            text NOT NULL DEFAULT 'processing' CHECK (state IN ('processing', 'done')), -- 처리 중·끝남. 처리 중에 같은 키가 오면 409 request_in_progress(06 DEC-04)
  processing_expires_at timestamptz,                     -- 처리 중의 기한(받은 시각 + 60초). 끝나지 않고 지나면(서버가 멈춤) 같은 키·같은 지문의 다음 요청이 이 행을 이어받아 처음부터 처리함(5절 E27)
  response_status  smallint CHECK (response_status BETWEEN 200 AND 499), -- 끝남: 처음 결과의 HTTP 상태 코드. 같은 키가 다시 오면 같은 코드로 돌려줌. 입력 검사 실패(422)·서버 오류(5xx)는 남기지 않고 처리 중 행을 지워 다시 보낼 수 있게 함(06 DEC-04)
  response_code    text CHECK (char_length(response_code) BETWEEN 1 AND 60), -- 끝남: 처음 결과의 종류(G7의 결과나 오류 코드)
  response_ref     jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(response_ref) = 'object'), -- 처음 결과가 가리킨 기록의 ID(예: 결제 안내·주문). 같은 키가 다시 오면 그 기록의 지금 상태를 다시 읽어 본문을 만듦(06 DEC-04). ID만 두고 개인정보·시크릿은 두지 않음
  created_at       timestamptz NOT NULL DEFAULT now(),   -- 처음 받은 시각. 24시간이 지나면 지우기(SPEC-065)가 지움(06 DEC-04)
  done_at          timestamptz,                          -- 끝난 시각
  PRIMARY KEY (actor_kind, actor_id, request_key),
  CONSTRAINT request_keys_state_chk CHECK ((state = 'processing') = (processing_expires_at IS NOT NULL) AND (state = 'done') = (done_at IS NOT NULL) AND (state = 'done') = (response_status IS NOT NULL) AND (response_status IS NULL) = (response_code IS NULL)) -- 처리 중에는 기한만, 끝남에는 처음 결과와 끝난 시각(5절 E27)
);
COMMENT ON TABLE request_keys IS 'TBL-050 요청 키: 사장님·운영자 화면 명령의 요청 지문·처리 상태·처음 결과(같은 키는 한 번만, G2, 06 DEC-04)';

-- TBL-051 ops_events (공통) ← SPEC-008, SPEC-010, SPEC-017, SPEC-029, SPEC-065 | terms: none
CREATE TABLE ops_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 운영 기록 ID
  shop_id     uuid REFERENCES shops (id) ON DELETE RESTRICT, -- 가게. 가게와 무관하면 빈 값
  kind        text NOT NULL CHECK (kind IN ('purge_run', 'order_request_dropped_full', 'ai_failure_burst', 'message_rate_limited', 'channel_already_linked', 'privacy_transfer_missing')), -- 지난 기록 지우기·다 찬 날이라 남기지 않은 주문 요청(R11)·5분에 5번 AI 실패(운영자 알림)·손님 메시지 한도·이미 다른 가게에 묶인 채널(운영자 알림, SPEC-008)·처리방침 국외 이전 항목 빔(운영자 알림, SPEC-010)
  count       integer NOT NULL DEFAULT 1 CHECK (count >= 0), -- 건수
  detail      jsonb,                                     -- 종류별 건수 같은 숫자만(내용·개인정보·시크릿 없음)
  created_at  timestamptz NOT NULL DEFAULT now()         -- 남긴 시각
);
CREATE INDEX ops_events_kind_time_idx ON ops_events (kind, created_at); -- 종류별로 보기
COMMENT ON TABLE ops_events IS 'TBL-051 운영 기록: 내용 없이 건수만 남기는 운영 이벤트와 운영자 화면의 알림';

-- TBL-052 kept_records (CTX-003) ← SPEC-065, SPEC-073 | terms: none
CREATE TABLE kept_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 보관 기록 ID
  shop_id              uuid NOT NULL,                  -- 가게
  order_id             uuid NOT NULL,                  -- 보관 기록이 된 주문. 주문 내용 버전·결제·환불·문제 신고 행은 그 주문에 그대로 남음
  customer_name        text CHECK (char_length(customer_name) BETWEEN 1 AND 30), -- 주문자 이름: 계약 기록에서 손님을 알아볼 정보로 주문 내용에서 옮겨 둠(REQ-185). 주문자 정보가 없는 재제작 주문은 빈 값(원래 주문의 보관 기록에 있음)
  finished_at          timestamptz NOT NULL,           -- 주문이 끝난 시각(보관 기간의 셈)
  contract_keep_until  timestamptz NOT NULL,           -- 계약·결제 기록을 둘 때까지: 끝난 날부터 5년(REQ-187, 잠정). 지나면 이 행을 지움(REQ-188)
  issue_keep_until     timestamptz,                    -- 문제 신고 기록을 둘 때까지: 끝난 날부터 3년(REQ-187, 잠정). 그 주문에 신고가 없으면 빈 값
  issue_purged_at      timestamptz,                    -- 문제 신고의 설명·사진을 지운 시각(REQ-188)
  created_at           timestamptz NOT NULL DEFAULT now(), -- 보관 기록으로 나눈 시각(끝나고 30일 뒤)
  CONSTRAINT kept_records_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT kept_records_order_uq UNIQUE (order_id),   -- 주문 하나에 보관 기록 하나
  CONSTRAINT kept_records_keep_chk CHECK (contract_keep_until > finished_at AND (issue_keep_until IS NULL OR (issue_keep_until > finished_at AND issue_keep_until <= contract_keep_until))), -- 보관 기간은 끝난 뒤이고 신고 기록이 계약 기록보다 길지 않음
  CONSTRAINT kept_records_issue_purged_chk CHECK (issue_purged_at IS NULL OR issue_keep_until IS NOT NULL) -- 신고 기록을 지운 표시는 신고가 있는 주문에만
);
CREATE INDEX kept_records_contract_due_idx ON kept_records (contract_keep_until); -- 5년 지난 보관 기록 찾기(SPEC-065)
CREATE INDEX kept_records_issue_due_idx ON kept_records (issue_keep_until) WHERE issue_keep_until IS NOT NULL AND issue_purged_at IS NULL; -- 3년 지난 문제 신고 찾기(SPEC-065)
COMMENT ON TABLE kept_records IS 'TBL-052 보관 기록: 끝나고 30일이 지난 주문을 지금 데이터와 나눈 표시와 주문자 이름. 계약·결제 기록은 5년, 문제 신고 기록은 3년(잠정, 5-2 질문 7)';

-- TBL-053 access_logs (공통) ← SPEC-065, SPEC-073, SPEC-074 | terms: none
CREATE TABLE access_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 접속기록 ID
  shop_id       uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT, -- 어느 가게의 손님 기록인지
  actor_kind    text NOT NULL CHECK (actor_kind IN ('owner', 'operator')), -- 접속한 사람: 사장님·운영자. 손님(정보주체)·카카오 스킬·서버 작업은 남기지 않음(SPEC-074)
  owner_id      uuid REFERENCES owners (id) ON DELETE RESTRICT, -- 접속한 사장님
  operator_id   uuid REFERENCES operators (id) ON DELETE RESTRICT, -- 접속한 운영자
  action        text NOT NULL CHECK (action IN ('read', 'change', 'open_original', 'open_kept')), -- 수행업무: 읽음·바꿈·원래 값 열기·보관 기록 열기(SPEC-073, SPEC-074)
  api_id        text NOT NULL CHECK (api_id ~ '^API-[0-9]{3}$'), -- 부른 06단계 API 번호
  request_path  text NOT NULL CHECK (char_length(request_path) BETWEEN 1 AND 300 AND strpos(request_path, '?') = 0), -- 요청 경로. ID만 담기고 쿼리 문자열은 넣지 않음(SPEC-074)
  subject_ids   jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(subject_ids) = 'array'), -- 처리한 정보주체: 손님 ID 목록(값 없이 ID만). 손님 행은 지우지 않아 2년 동안 가리킬 수 있음
  target_kind   text CHECK (target_kind IN ('masked_value', 'order_contact', 'refund_account', 'kept_record', 'consultation_text')), -- 연 대상: 대화 속 원래 값·주문자 이름과 연락처·환불 계좌·보관 기록·상담의 대화 글(SPEC-073, REQ-227)
  target_id     uuid,                                     -- 연 대상의 ID(상담의 대화 글은 상담 ID). 대상 행이 지워져도 이 기록은 2년 남으므로 외래 키를 두지 않음
  reason        text CHECK (char_length(reason) BETWEEN 5 AND 200), -- 운영자가 적은 사유(원래 값·보관 기록 열기, REQ-195)
  client_ip     text NOT NULL CHECK (client_ip ~ '^[0-9A-Fa-f:.]{2,45}$'), -- 접속지: 요청한 IP
  accessed_at   timestamptz NOT NULL DEFAULT now(),       -- 접속 일시. 2년이 지나면 지우기가 지움(SPEC-065, REQ-196)
  CONSTRAINT access_logs_actor_chk CHECK ((actor_kind = 'owner') = (owner_id IS NOT NULL) AND (actor_kind = 'operator') = (operator_id IS NOT NULL)), -- 사장님이나 운영자 한쪽만
  CONSTRAINT access_logs_open_chk CHECK ((action IN ('open_original', 'open_kept')) = (reason IS NOT NULL AND target_kind IS NOT NULL AND target_id IS NOT NULL)), -- 열기에는 사유와 대상이 있고 읽음·바꿈에는 없음
  CONSTRAINT access_logs_open_operator_chk CHECK (action IN ('read', 'change') OR actor_kind = 'operator'), -- 원래 값·보관 기록 열기는 운영자만(REQ-195)
  CONSTRAINT access_logs_target_chk CHECK (target_kind IS NULL OR (action = 'open_kept') = (target_kind = 'kept_record')) -- 보관 기록은 보관 기록 열기로만
);
CREATE INDEX access_logs_accessed_idx ON access_logs (accessed_at); -- 2년 지난 행 찾기(SPEC-065)
CREATE INDEX access_logs_shop_time_idx ON access_logs (shop_id, accessed_at); -- 가게별 점검(내부 관리계획, 「개인정보의 안전성 확보조치 기준」 제8조②)
COMMENT ON TABLE access_logs IS 'TBL-053 접속기록: 사장님·운영자가 손님 개인정보를 읽거나 바꾸거나 연 요청마다 한 행. 고치지 않고 2년 보관(REQ-196, 「개인정보의 안전성 확보조치 기준」 제8조①③)';

-- 접속기록은 고치거나 비우지 못하고, 2년이 지난 행만 지울 수 있음(SPEC-074, 4절 A24). 지금 시각(now())으로 2년을 봄
CREATE FUNCTION access_logs_guard() RETURNS trigger
LANGUAGE plpgsql AS $guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.accessed_at <= now() - interval '2 years' THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'access_logs_guard: 접속기록은 고치지 않고 2년이 지나야 지움(%)', TG_OP USING ERRCODE = 'restrict_violation';
END
$guard$;
CREATE TRIGGER access_logs_guard BEFORE UPDATE OR DELETE ON access_logs FOR EACH ROW EXECUTE FUNCTION access_logs_guard();
CREATE TRIGGER access_logs_guard_truncate BEFORE TRUNCATE ON access_logs FOR EACH STATEMENT EXECUTE FUNCTION access_logs_guard();

-- 받음·미수령인 주문은 제작 행의 인도·미수령 시각과 짝이 맞아야 커밋됨(설계 재검토 M9, 4절 A27, 5절 E3). 주문 상태와 제작 행을
-- 한 트랜잭션에서 쓰므로 트랜잭션 끝에 봄(지연 제약 트리거). 받음이면 인도 시각이 있고, 미수령이면 인도 시각 없이 미수령 시각이 있음
CREATE FUNCTION orders_production_sync_check() RETURNS trigger
LANGUAGE plpgsql AS $sync$
DECLARE
  target uuid;
  order_status text;
  handed timestamptz;
  missed timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    target := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target := OLD.order_id;
  ELSE
    target := NEW.order_id;
  END IF;
  SELECT o.status INTO order_status FROM orders o WHERE o.id = target;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT p.handed_over_at, p.no_pickup_at INTO handed, missed FROM productions p WHERE p.order_id = target;
  IF (order_status = 'received') <> (handed IS NOT NULL)
     OR (order_status = 'no_pickup') <> (missed IS NOT NULL AND handed IS NULL) THEN
    RAISE EXCEPTION 'orders_production_sync: 주문 상태(%)와 제작 행의 인도·미수령 시각이 맞지 않음', order_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$sync$;
CREATE CONSTRAINT TRIGGER orders_production_sync AFTER INSERT OR UPDATE OF status ON orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_production_sync_check();
CREATE CONSTRAINT TRIGGER productions_order_sync AFTER INSERT OR UPDATE OF handed_over_at, no_pickup_at OR DELETE ON productions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_production_sync_check();

-- 취소 뒤 들어온 입금·더 들어온 금액의 환불 계산값은 그 결제 안내에서 결제로 확인하지 않은 몫(들어온 금액 - 결제 확인을 취소하지 않은
-- 확인된 결제)을 넘지 않음(SPEC-016, SPEC-071, 4절 A29, Codex 후속). 환불 행을 쓸 때 봄. 결제 안내가 없거나 다른 가게의 것이면
-- CHECK(refunds_request_chk)와 외래 키(refunds_request_fk)가 막으므로 넘김
CREATE FUNCTION refunds_unconfirmed_check() RETURNS trigger
LANGUAGE plpgsql AS $unconfirmed$
DECLARE
  arrived integer;
  confirmed bigint;
BEGIN
  IF NEW.cause NOT IN ('paid_after_cancel', 'over_received') OR NEW.payment_request_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT r.arrived_amount INTO arrived FROM payment_requests r WHERE r.id = NEW.payment_request_id AND r.shop_id = NEW.shop_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(sum(p.amount), 0) INTO confirmed FROM payments p WHERE p.payment_request_id = NEW.payment_request_id AND p.voided_at IS NULL;
  IF NEW.calculated_amount > coalesce(arrived, 0) - confirmed THEN
    RAISE EXCEPTION 'refunds_unconfirmed: 환불 계산값(%원)이 그 결제 안내에서 결제로 확인하지 않은 몫(%원)을 넘음', NEW.calculated_amount, coalesce(arrived, 0) - confirmed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$unconfirmed$;
CREATE TRIGGER refunds_unconfirmed BEFORE INSERT OR UPDATE OF cause, payment_request_id, calculated_amount ON refunds FOR EACH ROW EXECUTE FUNCTION refunds_unconfirmed_check();

-- 재제작 주문(TERM-034)은 결제 없는 주문이라 돈과 장부를 원래 주문에 남김(SPEC-060, SPEC-016, R21, 4절 A31, 설계 재검토 M13).
-- 재제작 주문은 돈을 낸 원래 주문을 가리키고(재제작의 재제작도 그 원래 주문), 재제작 주문에는 결제 안내·환불·장부 행을 두지 않음.
-- 가리킨 주문이 없거나 다른 가게의 것이면 외래 키(orders_remake_fk, 각 테이블의 주문 외래 키)가 막으므로 넘김
CREATE FUNCTION orders_remake_root_check() RETURNS trigger
LANGUAGE plpgsql AS $remake_root$
BEGIN
  IF NEW.remake_of_order_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM orders o WHERE o.id = NEW.remake_of_order_id AND o.shop_id = NEW.shop_id AND o.remake_of_order_id IS NOT NULL) THEN
    RAISE EXCEPTION 'orders_remake_root: 재제작 주문(%)을 가리키는 재제작은 돈을 낸 원래 주문에 이어야 함', NEW.remake_of_order_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$remake_root$;
CREATE TRIGGER orders_remake_root BEFORE INSERT OR UPDATE OF remake_of_order_id ON orders FOR EACH ROW EXECUTE FUNCTION orders_remake_root_check();
CREATE FUNCTION remake_money_check() RETURNS trigger
LANGUAGE plpgsql AS $remake_money$
BEGIN
  IF EXISTS (SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.shop_id = NEW.shop_id AND o.remake_of_order_id IS NOT NULL) THEN
    RAISE EXCEPTION '%: 재제작 주문(%)에는 결제 안내·환불·장부 행을 두지 않고 원래 주문에 남김', TG_NAME, NEW.order_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$remake_money$;
CREATE TRIGGER payment_requests_remake BEFORE INSERT OR UPDATE OF order_id ON payment_requests FOR EACH ROW EXECUTE FUNCTION remake_money_check();
CREATE TRIGGER refunds_remake BEFORE INSERT OR UPDATE OF order_id ON refunds FOR EACH ROW EXECUTE FUNCTION remake_money_check();
CREATE TRIGGER ledger_rows_remake BEFORE INSERT OR UPDATE OF order_id ON ledger_rows FOR EACH ROW EXECUTE FUNCTION remake_money_check();

-- 원래 주문은 그 재제작 주문(TERM-034)이 모두 끝날 때까지 끝나지 않음(SPEC-060, SPEC-065, 4절 A22·A31, 설계 재검토 M13의 Codex 자동 검토 의견).
-- 재제작 주문의 취소·다시 신고의 환불을 원래 주문에 남기므로, 원래 주문이 먼저 끝나 지워지면 그 환불을 남길 곳이 없음. 끝난 시각을
-- 원래 주문과 재제작 주문에 한 트랜잭션에서 쓰므로 트랜잭션 끝에 봄(지연 제약 트리거). 끝난 재제작 주문을 다시 열면 원래 주문도 다시 엶
CREATE FUNCTION orders_remake_finish_check() RETURNS trigger
LANGUAGE plpgsql AS $remake_finish$
BEGIN
  IF EXISTS (SELECT 1 FROM orders o JOIN orders r ON r.remake_of_order_id = o.id
              WHERE o.id IN (NEW.id, NEW.remake_of_order_id) AND o.finished_at IS NOT NULL AND r.finished_at IS NULL) THEN
    RAISE EXCEPTION 'orders_remake_finish: 끝나지 않은 재제작 주문이 있는 원래 주문(%)은 끝나지 않음', coalesce(NEW.remake_of_order_id, NEW.id)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$remake_finish$;
CREATE CONSTRAINT TRIGGER orders_remake_finish AFTER INSERT OR UPDATE OF finished_at, remake_of_order_id ON orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_remake_finish_check();

-- 한 주문의 잡힌 자리와 확정된 자리는 각각 하나까지(slot_holds_one_held_per_order, slot_holds_one_fixed_per_order)이고, 둘이 함께 있는 것은
-- 금액이 오르는 날짜 변경이 차액을 기다리는 동안뿐: 옛 날의 확정된 자리를 두고 새 날 자리를 차액 결제 안내의 기한까지 잡음(SPEC-015, SPEC-043,
-- REQ-234, 설계 재검토 M5). 반영 때는 옛 날 자리를 먼저 풀고 새 날 자리를 확정된 자리로 바꿈
CREATE FUNCTION slot_holds_pair_check() RETURNS trigger
LANGUAGE plpgsql AS $pair$
DECLARE
  held_request uuid;
BEGIN
  IF NEW.status = 'held' THEN
    IF NOT EXISTS (SELECT 1 FROM slot_holds s WHERE s.order_id = NEW.order_id AND s.id <> NEW.id AND s.status = 'fixed') THEN
      RETURN NEW;
    END IF;
    held_request := NEW.payment_request_id;
  ELSIF NEW.status = 'fixed' THEN
    SELECT s.payment_request_id INTO held_request FROM slot_holds s WHERE s.order_id = NEW.order_id AND s.id <> NEW.id AND s.status = 'held';
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payment_requests r WHERE r.id = held_request AND r.kind = 'difference') THEN
    RAISE EXCEPTION 'slot_holds_pair: 주문(%)의 잡힌 자리와 확정된 자리가 함께 있는 것은 차액을 기다리는 날짜 변경뿐', NEW.order_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$pair$;
CREATE TRIGGER slot_holds_pair BEFORE INSERT OR UPDATE OF status, payment_request_id ON slot_holds FOR EACH ROW EXECUTE FUNCTION slot_holds_pair_check();

-- 취소 환불(손님 취소·가게 사정 취소)은 취소한 주문마다 하나(refunds_cancelled_uq)이고, 그 취소한 주문은 환불을 남기는 주문이나 그 재제작
-- 주문뿐(재제작 주문의 취소 환불은 원래 주문에 남김, 트리거 refunds_remake, 4절 A31·A33, 설계 재검토 M7). 취소한 주문이 없거나 다른 가게의
-- 것이면 외래 키(refunds_cancelled_fk)가 막으므로 넘김
CREATE FUNCTION refunds_cancelled_check() RETURNS trigger
LANGUAGE plpgsql AS $cancelled$
BEGIN
  IF NEW.cancelled_order_id IS NOT NULL AND NEW.cancelled_order_id <> NEW.order_id AND EXISTS (
       SELECT 1 FROM orders o WHERE o.id = NEW.cancelled_order_id AND o.shop_id = NEW.shop_id
          AND o.remake_of_order_id IS DISTINCT FROM NEW.order_id) THEN
    RAISE EXCEPTION 'refunds_cancelled: 취소 환불의 취소한 주문(%)은 환불을 남기는 주문(%)이나 그 재제작 주문이어야 함', NEW.cancelled_order_id, NEW.order_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$cancelled$;
CREATE TRIGGER refunds_cancelled BEFORE INSERT OR UPDATE OF order_id, cancelled_order_id ON refunds FOR EACH ROW EXECUTE FUNCTION refunds_cancelled_check();

-- 주문 확정 뒤 상태(확정·받음·미수령)인 주문을 확정한 결제는 결제 확인을 취소한 것이 아님(REQ-060, SPEC-070, 설계 재검토 M7). 결제 확인을
-- 취소하는 트랜잭션이 주문을 결제 기다림으로 돌리고 주문을 확정한 결제를 비우므로 트랜잭션 끝에 지금 행을 다시 읽어 봄(지연 제약 트리거)
CREATE FUNCTION confirmed_payment_live_check() RETURNS trigger
LANGUAGE plpgsql AS $confirmed_live$
BEGIN
  IF EXISTS (SELECT 1 FROM orders o JOIN payments p ON p.id = o.confirmed_payment_id
              WHERE CASE TG_TABLE_NAME WHEN 'orders' THEN o.id = NEW.id ELSE p.id = NEW.id END
                AND o.status IN ('confirmed', 'received', 'no_pickup') AND p.voided_at IS NOT NULL) THEN
    RAISE EXCEPTION '%: 주문 확정 뒤 상태인 주문을 확정한 결제는 결제 확인을 취소하지 않은 것이어야 함(결제 확인을 취소하면 주문을 결제 기다림으로 돌림)', TG_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$confirmed_live$;
CREATE CONSTRAINT TRIGGER orders_confirmed_payment_live AFTER INSERT OR UPDATE OF status, confirmed_payment_id ON orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION confirmed_payment_live_check();
CREATE CONSTRAINT TRIGGER payments_confirmed_void AFTER UPDATE OF voided_at ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION confirmed_payment_live_check();

-- TBL-054 file_deletions (공통) ← SPEC-065 | terms: none
CREATE TABLE file_deletions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 지울 파일 ID
  shop_id        uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT, -- 어느 가게의 사진 파일인지
  storage_key    text NOT NULL,                            -- 저장소에서 지울 사진 파일의 저장 위치(지운 참고 사진·신고 사진 행의 storage_key). 사진의 내용·손님 정보는 두지 않음
  source         text NOT NULL CHECK (source IN ('reference_photo', 'issue_photo')), -- 지운 행: 참고 사진·신고 사진(SPEC-065)
  queued_at      timestamptz NOT NULL DEFAULT now(),       -- 사진 행을 지운 트랜잭션의 시각. 그 트랜잭션에서 이 행을 넣음(5절 E24)
  attempts       integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10000), -- 저장소에서 지우려다 실패한 횟수. 지우면 이 행을 지움
  last_tried_at  timestamptz,                              -- 마지막으로 지우려다 실패한 시각. 다음 날 지우기가 다시 지움
  CONSTRAINT file_deletions_key_uq UNIQUE (storage_key), -- 같은 파일은 한 행
  CONSTRAINT file_deletions_tried_chk CHECK ((attempts = 0) = (last_tried_at IS NULL)) -- 실패한 적이 있으면 그 시각
);
COMMENT ON TABLE file_deletions IS 'TBL-054 지울 파일: 지우기(SPEC-065)가 지운 참고 사진·신고 사진의 저장 위치. 저장소에서 파일을 지운 뒤에만 행을 지우고, 실패하면 남아 다음 날 다시 지움';

-- TBL-055 handoff_questions (CTX-001) ← SPEC-022, SPEC-023, SPEC-065 | terms: TERM-008
CREATE TABLE handoff_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 덧붙은 질문 ID
  shop_id     uuid NOT NULL,                              -- 가게
  handoff_id  uuid NOT NULL,                              -- 덧붙은 열린 에스컬레이션 건(마감된 날 질문 건은 아님)
  message_id  uuid NOT NULL,                              -- 덧붙은 손님 말: 그 건과 같은 상담의 메시지(앱이 지킴, 4절 A34). 같은 메시지는 한 번만
  reason      text NOT NULL CHECK (reason IN ('edibility', 'cannot_answer', 'legal_medical', 'customer_request', 'other_user', 'pre_receipt_issue', 'ai_failure', 'ai_cost_limit', 'callback_timeout', 'masking_failed', 'empty_answer', 'clause_missing')), -- 덧붙은 사유(에스컬레이션 건의 사유와 같은 값). 마감된 날 질문은 덧붙이지 않고 날짜마다 따로 건을 둠(SPEC-014)
  order_id    uuid,                                       -- 관련 주문(있으면)
  created_at  timestamptz NOT NULL DEFAULT now(),         -- 덧붙은 시각. 상담을 지울 때 함께 지움(SPEC-065)
  CONSTRAINT handoff_questions_handoff_fk FOREIGN KEY (shop_id, handoff_id) REFERENCES handoffs (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT handoff_questions_message_fk FOREIGN KEY (shop_id, message_id) REFERENCES messages (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT handoff_questions_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT handoff_questions_message_uq UNIQUE (message_id) -- 같은 손님 말은 한 번만 덧붙음(SPEC-022)
);
CREATE INDEX handoff_questions_handoff_idx ON handoff_questions (handoff_id, created_at); -- 건마다 덧붙은 질문(SPEC-023)
COMMENT ON TABLE handoff_questions IS 'TBL-055 덧붙은 질문(TERM-008): 열린 에스컬레이션 건에 덧붙은 손님 질문마다 한 행(사유·관련 주문). 마감된 날 질문은 날짜마다 따로 건을 둠(설계 재검토 M17)';

-- TBL-056 order_draft_extras (CTX-001) ← SPEC-013, SPEC-065 | terms: TERM-003
CREATE TABLE order_draft_extras (
  shop_id        uuid NOT NULL,                           -- 가게
  draft_id       uuid NOT NULL,                           -- 주문서 초안
  price_list_id  uuid NOT NULL,                           -- 초안의 가격표 버전. 초안과 같음(order_draft_extras_draft_fk)
  option_id      uuid NOT NULL,                           -- 더한 옵션: 같은 가격표 버전의 '더하는 옵션'만(order_draft_extras_option_fk)
  option_group   text NOT NULL DEFAULT 'extra' CHECK (option_group = 'extra'), -- 늘 '더하는 옵션'. 옵션의 무리를 외래 키로 맞추려고 둔 값
  PRIMARY KEY (draft_id, option_id),
  CONSTRAINT order_draft_extras_draft_fk FOREIGN KEY (shop_id, draft_id, price_list_id) REFERENCES order_drafts (shop_id, id, price_list_id) ON DELETE RESTRICT,
  CONSTRAINT order_draft_extras_option_fk FOREIGN KEY (price_list_id, option_id, option_group) REFERENCES price_options (price_list_id, id, option_group) ON DELETE RESTRICT
);
COMMENT ON TABLE order_draft_extras IS 'TBL-056 초안의 더하는 옵션: 주문서 초안에 더한 옵션마다 한 행. 초안과 같은 가격표 버전의 더하는 옵션만(설계 재검토 M17)';

-- TBL-057 order_detail_extras (CTX-003) ← SPEC-029, SPEC-050 | terms: TERM-004
CREATE TABLE order_detail_extras (
  shop_id          uuid NOT NULL,                         -- 가게
  order_detail_id  uuid NOT NULL,                         -- 주문 내용 버전
  price_list_id    uuid NOT NULL,                         -- 그 버전의 가격표 버전. 주문 내용과 같음(order_detail_extras_detail_fk)
  option_id        uuid NOT NULL,                         -- 더한 옵션: 같은 가격표 버전의 '더하는 옵션'만(order_detail_extras_option_fk). 이전 버전의 행도 지우지 않음(REQ-027)
  option_group     text NOT NULL DEFAULT 'extra' CHECK (option_group = 'extra'), -- 늘 '더하는 옵션'. 옵션의 무리를 외래 키로 맞추려고 둔 값
  PRIMARY KEY (order_detail_id, option_id),
  CONSTRAINT order_detail_extras_detail_fk FOREIGN KEY (shop_id, order_detail_id, price_list_id) REFERENCES order_details (shop_id, id, price_list_id) ON DELETE RESTRICT,
  CONSTRAINT order_detail_extras_option_fk FOREIGN KEY (price_list_id, option_id, option_group) REFERENCES price_options (price_list_id, id, option_group) ON DELETE RESTRICT
);
COMMENT ON TABLE order_detail_extras IS 'TBL-057 주문 내용의 더하는 옵션: 주문 내용 버전마다 더한 옵션마다 한 행. 그 버전과 같은 가격표 버전의 더하는 옵션만(설계 재검토 M17)';

-- TBL-058 shop_identity_changes (CTX-007) ← SPEC-078 | terms: TERM-053
CREATE TABLE shop_identity_changes (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 변경 요청 ID
  shop_id                   uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT, -- 바꿀 가게
  business_name             text NOT NULL CHECK (char_length(business_name) BETWEEN 1 AND 60), -- 새 상호(바꾸지 않으면 요청할 때의 값)
  representative_name       text NOT NULL CHECK (char_length(representative_name) BETWEEN 1 AND 30), -- 새 대표자 성명(바꾸지 않으면 요청할 때의 값)
  business_reg_no           text NOT NULL CHECK (business_reg_no ~ '^[0-9]{10}$'), -- 새 사업자등록번호(검증 숫자는 앱이 봄)
  prev_business_name        text NOT NULL CHECK (char_length(prev_business_name) BETWEEN 1 AND 60), -- 요청할 때 확인된 상호. 반영한 뒤에도 무엇을 바꿨는지 남음
  prev_representative_name  text NOT NULL CHECK (char_length(prev_representative_name) BETWEEN 1 AND 30), -- 요청할 때 확인된 대표자 성명
  prev_business_reg_no      text NOT NULL CHECK (prev_business_reg_no ~ '^[0-9]{10}$'), -- 요청할 때 확인된 사업자등록번호
  evidence_photo_key        text NOT NULL,                     -- 증빙 사진(영업 신고증이나 사업자등록증 한 장) 저장 위치. 그 가게 사장님과 운영자만 봄(G1, G6)
  status                    text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'on_hold')), -- 확인 기다림·반영함·보류(SPEC-078). 반영·보류한 요청은 고치지 않음
  hold_reason               text CHECK (char_length(hold_reason) BETWEEN 1 AND 200), -- 보류 이유. 사장님께 한 번 알림(owner_alerts identity_change_on_hold)
  reviewed_by               uuid REFERENCES operators (id) ON DELETE RESTRICT, -- 반영·보류한 운영자
  reviewed_at               timestamptz,                       -- 반영·보류한 시각
  requested_at              timestamptz NOT NULL DEFAULT now(), -- 요청한 시각
  CONSTRAINT shop_identity_changes_differs_chk CHECK ((business_name, representative_name, business_reg_no) IS DISTINCT FROM (prev_business_name, prev_representative_name, prev_business_reg_no)), -- 세 값이 모두 그대로인 요청은 남기지 않음(SPEC-078)
  CONSTRAINT shop_identity_changes_hold_chk CHECK ((status = 'on_hold') = (hold_reason IS NOT NULL)), -- 보류에는 이유가 있음
  CONSTRAINT shop_identity_changes_reviewed_chk CHECK ((status = 'pending') = (reviewed_by IS NULL) AND (status = 'pending') = (reviewed_at IS NULL)) -- 반영·보류는 운영자와 시각을 남김
);
CREATE UNIQUE INDEX shop_identity_changes_one_pending ON shop_identity_changes (shop_id) WHERE status = 'pending'; -- 가게마다 확인을 기다리는 변경 요청은 하나(SPEC-078)
CREATE INDEX shop_identity_changes_queue_idx ON shop_identity_changes (requested_at) WHERE status = 'pending'; -- 운영자 확인 목록(SPEC-078)
COMMENT ON TABLE shop_identity_changes IS 'TBL-058 사업자 정보 변경 요청: 상호·대표자·사업자등록번호의 새 값과 증빙 사진. 운영자가 반영해야 가게 정보가 바뀜(REQ-245, 설계 재검토 M14)';

-- ─────────────────────────────────────────────────────────────────────────
-- 컨텍스트별 테이블
-- CTX-001 상담: TBL-016, TBL-017, TBL-018, TBL-019, TBL-020, TBL-021, TBL-022, TBL-024, TBL-027, TBL-028, TBL-029, TBL-048, TBL-049, TBL-055, TBL-056
-- CTX-002 가게 규칙: TBL-006, TBL-007, TBL-008, TBL-009, TBL-010, TBL-011, TBL-012, TBL-013, TBL-014, TBL-034
-- CTX-003 주문: TBL-023, TBL-025, TBL-026, TBL-030, TBL-052, TBL-057
-- CTX-004 결제·환불: TBL-015, TBL-031, TBL-032, TBL-033
-- CTX-005 제작·전달: TBL-035, TBL-036, TBL-037
-- CTX-006 후기·포트폴리오: TBL-038, TBL-039, TBL-040, TBL-041
-- CTX-007 가게 등록·연결: TBL-001, TBL-002, TBL-003, TBL-004, TBL-005, TBL-058
-- CTX-008 알림: TBL-042, TBL-043, TBL-044
-- CTX-009 장부 연결: TBL-045, TBL-046, TBL-047
-- 공통: TBL-050, TBL-051, TBL-053, TBL-054
--
-- 테이블이 없는 용어. 한 행에 하나, 괄호 안은 컨텍스트와 사유. 컬럼으로만 있는 용어는 그 컬럼 설명에 TERM 번호가 있음.
-- without a table: TERM-002 (CTX-001·CTX-003, 일상 말: 초안 TERM-003과 주문 내용 TERM-004로 나눠 씀)
-- without a table: TERM-006 (CTX-003, 트랜잭션 경계 후보: 테이블이 아닌 저장 단위. 주문 요청은 한 트랜잭션으로 orders·order_details·photo_consents·slot_holds·payment_requests를 씀)
-- without a table: TERM-015 (CTX-004, 예약금: 케이크 주문에서는 쓰지 않음, 01단계 1차 체크포인트)
-- without a table: TERM-029 (전체, 정책: 이벤트에 따라 명령을 내리는 코드의 규칙)
-- without a table: TERM-056 (CTX-001, 읽기 모델: TBL-003·005·006·007·009·013·014·034·041에서 읽음)
-- without a table: TERM-060 (CTX-002, 읽기 모델: TBL-013·014·034에서 셈)
-- without a table: TERM-061 (CTX-003, 읽기 모델: TBL-020·022·010·011에서 만들어 확인 카드 TBL-024의 payload에 찍어 둠)
-- without a table: TERM-062 (CTX-003, 읽기 모델: TBL-021·022·023·014·034)
-- without a table: TERM-063 (CTX-004, 읽기 모델: TBL-031·023)
-- without a table: TERM-064 (CTX-003, 읽기 모델: TBL-023·031·014·034)
-- without a table: TERM-065 (CTX-003, 읽기 모델: TBL-023·026·010·012·032·033·035)
-- without a table: TERM-066 (CTX-003, 읽기 모델: TBL-025·010)
-- without a table: TERM-067 (CTX-004, 읽기 모델: TBL-010·011·012·023·032·033·035에서 계산, 정한 값은 TBL-033)
-- without a table: TERM-068 (CTX-005, 읽기 모델: TBL-023·026·035)
-- without a table: TERM-069 (CTX-005, 읽기 모델: TBL-023·026·035)
-- without a table: TERM-070 (CTX-008, 읽기 모델: TBL-023·013·016)
-- without a table: TERM-071 (CTX-006, 읽기 모델: TBL-039·040)
-- without a table: TERM-072 (CTX-003, 읽기 모델: TBL-023·035)
-- without a table: TERM-073 (CTX-003, 읽기 모델: TBL-030·028·029·026·032)

-- ▼ 컬럼 설명: build_erd.py가 각 컬럼 줄 끝의 설명에서 만듦. 이 아래는 손으로 고치지 않음.
COMMENT ON COLUMN owners.id IS '사장님 ID';
COMMENT ON COLUMN owners.kakao_account_id IS '카카오 로그인 사용자 번호. 사장님 알림을 보내는 Event API의 appUserId(SPEC-067, REQ-183). 카카오 토큰은 어디에도 두지 않음(SPEC-001, REQ-135)';
COMMENT ON COLUMN owners.alert_channel_friend IS '우리 서비스 채널 친구인지. 로그인 때의 채널 관계 조회와 알림 발송 결과로 고침. 아니면 알림은 ''못 보냄''으로 할 일 목록에만(SPEC-067)';
COMMENT ON COLUMN owners.alert_friend_checked_at IS '우리 채널 친구인지 마지막으로 본 시각(채널 관계 조회나 발송 결과, SPEC-001)';
COMMENT ON COLUMN owners.last_login_at IS '마지막 로그인 시각';
COMMENT ON COLUMN owners.created_at IS '처음 들어온 시각';
COMMENT ON COLUMN operators.id IS '운영자 ID';
COMMENT ON COLUMN operators.email IS '운영자 계정 이메일. 비밀번호·2단계 인증 키는 인증 서비스나 시크릿 저장소에(REQ-135)';
COMMENT ON COLUMN operators.display_name IS '화면에 보일 이름';
COMMENT ON COLUMN operators.mfa_enrolled_at IS '2단계 인증을 켠 시각. 빈 동안 운영자 화면에 못 들어옴(R2)';
COMMENT ON COLUMN operators.disabled_at IS '계정을 막은 시각';
COMMENT ON COLUMN operators.created_at IS '만든 시각';
COMMENT ON COLUMN shops.id IS '가게 ID. 모든 기록이 이 값으로 나뉨(SPEC-068)';
COMMENT ON COLUMN shops.owner_id IS '가게 주인';
COMMENT ON COLUMN shops.name IS '가게 이름';
COMMENT ON COLUMN shops.contact_phone IS '가게 연락처(전화번호). 예약 링크 페이지의 가게 신원 정보(REQ-239). 사장님이 가게 설정에서 바로 고침(REQ-244)';
COMMENT ON COLUMN shops.contact_email IS '전자우편주소. 예약 링크 페이지의 가게 신원 정보(REQ-239). 사장님이 가게 설정에서 바로 고침(REQ-244)';
COMMENT ON COLUMN shops.business_address IS '사업장 주소. 예약 링크 페이지와 확정 안내의 가게 신원 정보(REQ-239, REQ-242). 픽업 장소와 다를 수 있음. 사장님이 가게 설정에서 바로 고침(REQ-244)';
COMMENT ON COLUMN shops.pickup_address IS '픽업 장소(가게 위치). 전날 안내에 포함함(SPEC-052). 등록 필드(SPEC-002)에 없어 가게 설정에서 받음(SPEC-077)';
COMMENT ON COLUMN shops.business_name IS '상호. 등록 뒤에는 변경 요청을 운영자가 반영해야 바뀜(REQ-245, TBL-058)';
COMMENT ON COLUMN shops.representative_name IS '대표자 성명. 등록 뒤에는 변경 요청을 운영자가 반영해야 바뀜(REQ-245, TBL-058)';
COMMENT ON COLUMN shops.business_reg_no IS '사업자등록번호(검증 숫자는 앱이 봄). 중복돼도 받고 운영자 화면에 중복 표시(SPEC-002). 등록 뒤에는 변경 요청을 운영자가 반영해야 바뀜(REQ-245)';
COMMENT ON COLUMN shops.mail_order_reg_no IS '통신판매업 신고번호';
COMMENT ON COLUMN shops.mail_order_authority IS '통신판매업 신고를 받은 기관(예: 서울특별시 마포구청). 신고번호와 함께 있음(REQ-239)';
COMMENT ON COLUMN shops.mail_order_exemption IS '신고번호 대신 면제 사유';
COMMENT ON COLUMN shops.food_license_no IS '영업 신고 번호';
COMMENT ON COLUMN shops.food_business_type IS '영업 종류: 즉석판매제조·가공업, 제과점영업. 그 밖은 첫 버전에서 받지 않음';
COMMENT ON COLUMN shops.license_photo_key IS '신고증 사진 저장 위치. 그 가게 사장님과 운영자만 봄(G1, G6)';
COMMENT ON COLUMN shops.license_status IS '영업 신고: 확인 기다림·보류·확인됨(SPEC-003). 확인됨은 결제 계좌가 있고 그 예금주가 대표자·상호와 같은지 운영자가 본 뒤(REQ-197, 4절 A25)';
COMMENT ON COLUMN shops.license_hold_reason IS '보류 이유. 사장님은 자기 가게의 상태와 이 이유만 봄';
COMMENT ON COLUMN shops.license_reviewed_by IS '마지막으로 확인·보류한 운영자';
COMMENT ON COLUMN shops.license_reviewed_at IS '마지막으로 확인·보류한 시각';
COMMENT ON COLUMN shops.entrustment_terms_version IS '동의한 개인정보 처리 위탁·재위탁 조건의 버전(REQ-107). 동의 없이는 가게가 생기지 않음';
COMMENT ON COLUMN shops.entrustment_consented_at IS '그 조건에 동의한 시각';
COMMENT ON COLUMN shops.time_zone IS '가게 시간대. 시각 계산은 이 시간대로(G8)';
COMMENT ON COLUMN shops.completion_photo_enabled IS '완성 사진 보내기(SPEC-009, 기본 꺼짐)';
COMMENT ON COLUMN shops.idle_close_hours IS '문의 끊김까지 시간(REQ-211, 기본 24시간). 사장님이 바꾸면 저장한 때부터 씀(REQ-243)';
COMMENT ON COLUMN shops.owner_wait_minutes IS '사장님 답 기다리는 시간(REQ-116, 기본 2시간). 바꾸면 그 뒤 시작된 기다림부터(owner_tasks.wait_due_at, REQ-243)';
COMMENT ON COLUMN shops.daily_ai_cost_limit_krw IS '하루 AI 비용 한도(REQ-163, 기본 5,000원). 사장님이 정하고 바꾸면 저장한 때부터 그날 쓴 비용과 견줌(REQ-243)';
COMMENT ON COLUMN shops.booking_slug IS '예약 링크(TERM-042) 주소의 가게 몫. 낸 뒤 바뀌지 않음(SPEC-010)';
COMMENT ON COLUMN shops.booking_issued_at IS '예약 링크를 낸 시각';
COMMENT ON COLUMN shops.created_at IS '등록한 시각';
COMMENT ON COLUMN shops.updated_at IS '마지막으로 고친 시각';
COMMENT ON COLUMN kakao_channels.id IS '채널 연결 ID';
COMMENT ON COLUMN kakao_channels.shop_id IS '채널을 묶은 가게';
COMMENT ON COLUMN kakao_channels.bot_id IS '오픈빌더 봇 ID. 스킬 요청에서 가게를 찾는 키(SPEC-017)';
COMMENT ON COLUMN kakao_channels.channel_public_id IS '채널 공개 ID. 예약 링크 페이지의 문의 버튼이 여는 채팅 주소(SPEC-011)';
COMMENT ON COLUMN kakao_channels.status IS '연결 확인 중·연결됨·연결 안 됨·바꿔서 그만 받음(SPEC-008)';
COMMENT ON COLUMN kakao_channels.check_started_at IS '''연결 확인''을 누른 시각(10분 안에 연결 문구와 버튼 블록 다섯이 와야 함)';
COMMENT ON COLUMN kakao_channels.linked_at IS '연결됨이 된 시각';
COMMENT ON COLUMN kakao_channels.retired_at IS '다른 채널로 바꿔 더 받지 않게 된 시각';
COMMENT ON COLUMN kakao_channels.card_block_id IS '가게 봇의 ''확인 카드'' 블록 ID. 확인 카드 버튼이 부름(SPEC-008, REQ-206)';
COMMENT ON COLUMN kakao_channels.orderer_block_id IS '가게 봇의 ''주문자 정보'' 블록 ID. 주문자 정보 카드 버튼이 부름(SPEC-072)';
COMMENT ON COLUMN kakao_channels.allergy_block_id IS '가게 봇의 ''알레르기 답'' 블록 ID. 알레르기 정보 동의 카드의 버튼이 부르고 AI를 거치지 않고 답을 받음(SPEC-075, REQ-202, REQ-206)';
COMMENT ON COLUMN kakao_channels.depositor_block_id IS '가게 봇의 ''입금자 이름'' 블록 ID. 결제 확인 요청 카드 버튼이 부름(SPEC-033)';
COMMENT ON COLUMN kakao_channels.review_block_id IS '가게 봇의 ''후기'' 블록 ID. 후기 부탁 버튼이 부름(SPEC-061)';
COMMENT ON COLUMN kakao_channels.verified_blocks IS '연결 확인 때 시험 버튼으로 우리 스킬에 닿은 블록(REQ-206)';
COMMENT ON COLUMN kakao_channels.test_user_key IS '연결 확인 때 연결 문구를 보낸 사용자 키. 시험 버튼과 시험 안내를 이 사용자로 함(SPEC-008, REQ-238)';
COMMENT ON COLUMN kakao_channels.event_status IS '먼저 보내기(Event API): 아직 안 봄·시험 중·됨·안 됨. 안 되면 손님 안내는 다음 대화 때(REQ-180, REQ-181)';
COMMENT ON COLUMN kakao_channels.event_task_id IS '시험 안내의 카카오 taskId. 발송 결과 조회에 씀(REQ-182)';
COMMENT ON COLUMN kakao_channels.event_checked_at IS '시험 안내의 발송 결과를 받은 시각';
COMMENT ON COLUMN kakao_channels.event_fail_reason IS '먼저 보내기가 안 되는 사유: 채널이 우리 앱에 연결 안 됨·월렛 없음·이벤트 이름이나 배포·안내 스킬·사장님이 가게 채널 친구 아님·닿지 않음·카카오 오류';
COMMENT ON COLUMN kakao_channels.skill_key_version IS '스킬 키 버전. 키는 서버 시크릿·연결 ID·버전으로 만들고 저장하지 않음(06단계 DEC-08). 사장님이 바꿀 때마다 1 늘림(REQ-237)';
COMMENT ON COLUMN kakao_channels.skill_key_issued_at IS '지금 버전의 스킬 키를 만든 시각(REQ-237)';
COMMENT ON COLUMN kakao_channels.previous_key_until IS '바로 앞 버전의 키도 받는 끝 시각: 바꾼 때부터 24시간까지. 바로 끊었거나 바꾼 적이 없으면 비움(REQ-237)';
COMMENT ON COLUMN kakao_channels.claim_expires_at IS '''연결 확인 중'' 선점이 풀리는 시각: 마지막 저장이나 연결 확인 시작에서 30분. 지난 뒤 다른 가게가 같은 봇을 넣으면 이 연결은 ''연결 안 됨''(REQ-238)';
COMMENT ON COLUMN kakao_channels.created_at IS '만든 시각';
COMMENT ON COLUMN privacy_policies.id IS '처리방침 버전 ID';
COMMENT ON COLUMN privacy_policies.shop_id IS '처리방침의 가게';
COMMENT ON COLUMN privacy_policies.version IS '버전. 바뀌면 새 버전';
COMMENT ON COLUMN privacy_policies.body IS '처리방침 글';
COMMENT ON COLUMN privacy_policies.overseas_transfers IS '국외 이전 다섯 항목. 받는 자마다 옮기는 개인정보, 나라·시기·방법, 받는 자, 목적·보유 기간, 거부 방법·절차와 결과(REQ-141)';
COMMENT ON COLUMN privacy_policies.published_at IS '낸 시각. 가장 최근 버전을 예약 링크 페이지와 AI 상담 고지에 게시함(REQ-140)';
COMMENT ON COLUMN price_lists.id IS '가격표 버전 ID';
COMMENT ON COLUMN price_lists.shop_id IS '가격표의 가게';
COMMENT ON COLUMN price_lists.version IS '버전(TERM-005). 저장할 때마다 하나 오르고, 바꾼 것이 없으면 새 버전 없음(SPEC-004)';
COMMENT ON COLUMN price_lists.created_at IS '이 버전을 저장한 시각';
COMMENT ON COLUMN price_lists.superseded_at IS '새 버전이 생겨 ''이전 버전''이 된 시각. 빈 값이 현재 버전. 이전 버전은 읽기만(REQ-027)';
COMMENT ON COLUMN price_options.id IS '옵션 ID';
COMMENT ON COLUMN price_options.shop_id IS '가게';
COMMENT ON COLUMN price_options.price_list_id IS '가격표 버전';
COMMENT ON COLUMN price_options.option_group IS '크기·맛·디자인·더하는 옵션';
COMMENT ON COLUMN price_options.name IS '옵션 이름';
COMMENT ON COLUMN price_options.price_kind IS '값 표시: 확정·부터·범위';
COMMENT ON COLUMN price_options.amount IS '값(원). 범위면 아래 끝';
COMMENT ON COLUMN price_options.amount_max IS '범위의 위 끝';
COMMENT ON COLUMN price_options.in_standard IS '기본 디자인 범위 안인지: 사장님이 옵션마다 고르고 가격표 버전에 함께 남음. 값이 ''확정''인 옵션만 넣음(price_options_standard_fixed_chk). 범위 밖 옵션을 고르면 맞춤 주문(SPEC-004, SPEC-013, REQ-228, REQ-229)';
COMMENT ON COLUMN price_options.position IS '보이는 순서';
COMMENT ON COLUMN price_option_rules.id IS '옵션 규칙 ID';
COMMENT ON COLUMN price_option_rules.shop_id IS '가게';
COMMENT ON COLUMN price_option_rules.price_list_id IS '가격표 버전';
COMMENT ON COLUMN price_option_rules.rule_kind IS '함께 못 고름·함께 고르면 더하는 값';
COMMENT ON COLUMN price_option_rules.option_a_id IS '옵션 하나(같은 버전)';
COMMENT ON COLUMN price_option_rules.option_b_id IS '다른 옵션(같은 버전)';
COMMENT ON COLUMN price_option_rules.amount IS '더하는 값(원)';
COMMENT ON COLUMN designs.id IS '도안 ID';
COMMENT ON COLUMN designs.shop_id IS '가게';
COMMENT ON COLUMN designs.price_list_id IS '이 도안을 담은 가격표 버전(REQ-026)';
COMMENT ON COLUMN designs.price_option_id IS '이 도안의 값을 정하는 디자인 옵션(같은 버전)';
COMMENT ON COLUMN designs.name IS '도안 이름';
COMMENT ON COLUMN designs.image_key IS '도안 그림 저장 위치(한 장 10MB, 버전마다 50장까지는 앱이 봄)';
COMMENT ON COLUMN designs.in_standard IS '기본 디자인 범위 안인지: 사장님이 도안마다 고르고 가격표 버전에 함께 남음. 값을 정하는 디자인 옵션이 범위 밖이면 넣지 않음(앱, SPEC-004, REQ-228)';
COMMENT ON COLUMN designs.position IS '보이는 순서';
COMMENT ON COLUMN operating_rules.id IS '운영규정 버전 ID';
COMMENT ON COLUMN operating_rules.shop_id IS '가게';
COMMENT ON COLUMN operating_rules.version IS '버전(TERM-005). 받은 주문은 그때 버전을 따름(REQ-030)';
COMMENT ON COLUMN operating_rules.quote_valid_hours IS '견적 유효 기한(REQ-034, 기본 안내 뒤 72시간)';
COMMENT ON COLUMN operating_rules.payment_due_hours IS '결제 기한(TERM-030, REQ-218): 결제 안내가 손님에게 전해진 뒤 기본 12시간, 결제 기한 상한까지';
COMMENT ON COLUMN operating_rules.issue_report_hours IS '문제 신고 기한(REQ-072, 기본 받은 뒤 24시간)';
COMMENT ON COLUMN operating_rules.change_deadline_hours IS '변경 마감: 픽업 일시 몇 시간 전까지(SPEC-041). 기본값 없음, 가게가 넣음';
COMMENT ON COLUMN operating_rules.cancellation_fee_krw IS '고정 취소 수수료(TERM-016), 0원~1,000만 원. 저장할 때는 주문 금액과 견주지 않고, 환불 계산에서 비율보다 먼저 빼며 바탕보다 크면 환불 0원(SPEC-016, 4절 A30)';
COMMENT ON COLUMN operating_rules.pre_production_refund_pct IS '제작 전 취소의 환불 비율: 수수료를 뺀 값에 곱하고 원 미만 버림, 기본 전액(REQ-031). 단계별 환불이 없는 버전은 맞춤 재료 주문·제작 시작 뒤 취소에도 씀(SPEC-016)';
COMMENT ON COLUMN operating_rules.pre_production_lowered_ack IS '전액보다 낮출 때 위험과 근거를 보고 ''그래도 저장''을 누름(REQ-032)';
COMMENT ON COLUMN operating_rules.date_change_refund_basis IS '날짜를 바꾼 주문의 환불 기준일: 처음 픽업일(주문 내용 첫 버전의 픽업 일시)·바꾼 픽업일. 단계별 환불의 남은 시간을 이 픽업 일시까지로 셈(SPEC-016). 기본값 없음, 가게가 정함';
COMMENT ON COLUMN operating_rules.created_at IS '이 버전을 확정한 시각';
COMMENT ON COLUMN operating_rules.superseded_at IS '새 버전이 생긴 시각. 빈 값이 현재 버전';
COMMENT ON COLUMN rule_clauses.id IS '조문 ID';
COMMENT ON COLUMN rule_clauses.shop_id IS '가게';
COMMENT ON COLUMN rule_clauses.operating_rules_id IS '운영규정 버전';
COMMENT ON COLUMN rule_clauses.clause_key IS '템플릿의 조문 필드(REQ-031, REQ-033)나 가게가 더한 조문';
COMMENT ON COLUMN rule_clauses.position IS '조문 순서(제 몇 조)';
COMMENT ON COLUMN rule_clauses.title IS '조문 제목';
COMMENT ON COLUMN rule_clauses.condition_text IS '조건';
COMMENT ON COLUMN rule_clauses.effect_text IS '효과. AI가 인용할 때는 이 글자 그대로(AI-1 서버 확인)';
COMMENT ON COLUMN refund_tiers.id IS '단계 ID';
COMMENT ON COLUMN refund_tiers.shop_id IS '가게';
COMMENT ON COLUMN refund_tiers.operating_rules_id IS '운영규정 버전';
COMMENT ON COLUMN refund_tiers.hours_before_min IS '취소가 기준 픽업 일시 몇 시간 전부터(이 값 포함). 남은 시간은 1시간 미만을 버림(SPEC-016)';
COMMENT ON COLUMN refund_tiers.hours_before_max IS '몇 시간 전까지(이 값 빼고). 빈 값은 그보다 이른 때 전부';
COMMENT ON COLUMN refund_tiers.refund_pct IS '환불 비율';
COMMENT ON COLUMN business_calendars.shop_id IS '가게(가게마다 하나)';
COMMENT ON COLUMN business_calendars.closed_weekdays IS '요일별 휴무(1=월 … 7=일)';
COMMENT ON COLUMN business_calendars.daily_capacity IS '하루 최대 개수(TERM-026). 바꾼 값은 그 뒤 잡는 자리에만(R4)';
COMMENT ON COLUMN business_calendars.order_cutoff_days IS '주문 마감(TERM-027): 픽업일 며칠 전';
COMMENT ON COLUMN business_calendars.order_cutoff_time IS '주문 마감: 그날 몇 시';
COMMENT ON COLUMN business_calendars.reply_start IS '답하는 시간 시작(REQ-118). 사장님 답 기다림은 이 안에서만 셈';
COMMENT ON COLUMN business_calendars.reply_end IS '답하는 시간 끝';
COMMENT ON COLUMN business_calendars.day_before_notice_time IS '전날 안내 시각(SPEC-052)';
COMMENT ON COLUMN business_calendars.review_request_time IS '후기 부탁 시각(SPEC-061, 인도한 다음 날). 바꾸면 아직 보내지 않은 후기 부탁부터 씀(REQ-243)';
COMMENT ON COLUMN business_calendars.updated_at IS '마지막으로 바꾼 시각';
COMMENT ON COLUMN calendar_days.shop_id IS '가게';
COMMENT ON COLUMN calendar_days.day IS '가게 시간대의 날짜';
COMMENT ON COLUMN calendar_days.closed IS '날짜별 휴무(요일 휴무는 business_calendars)';
COMMENT ON COLUMN calendar_days.capacity IS '그날만 다른 하루 최대 개수. 빈 값은 가게 기준';
COMMENT ON COLUMN calendar_days.manually_closed_at IS '사장님이 누른 그날 주문 마감(SPEC-012). 빈 값이면 열림. 다 찬 날의 마감은 잡힌 자리를 세어서 앎';
COMMENT ON COLUMN calendar_days.updated_at IS '마지막으로 바꾼 시각';
COMMENT ON COLUMN payment_accounts.id IS '결제 수단 ID';
COMMENT ON COLUMN payment_accounts.shop_id IS '가게';
COMMENT ON COLUMN payment_accounts.bank_name IS '은행';
COMMENT ON COLUMN payment_accounts.account_number_enc IS '가게 명의 계좌번호를 앱이 암호화한 값(키 버전:nonce·암호문·태그의 base64url, 5절 E20). 평문은 두지 않음(REQ-191). 숫자와 ''-'' 10~16자리 확인은 06단계 API가 함. 사장님 화면과 그 가게 손님의 결제 안내를 보일 때만 복호화하고, AI로는 마스킹함(SPEC-006)';
COMMENT ON COLUMN payment_accounts.account_last4 IS '계좌번호 끝 4자리. 운영자 화면은 이것만 보임(SPEC-003, SPEC-073)';
COMMENT ON COLUMN payment_accounts.holder_name IS '예금주';
COMMENT ON COLUMN payment_accounts.holder_mismatch_confirmed IS '예금주가 상호·대표자와 다를 때 ''가게 명의가 맞다''는 사장님 답. 같으면 빈 값';
COMMENT ON COLUMN payment_accounts.holder_checked_by IS '영업 신고를 확인하며 예금주가 대표자·상호와 같은지 본 운영자(REQ-197, SPEC-003)';
COMMENT ON COLUMN payment_accounts.holder_checked_at IS '예금주를 확인한 시각. 확인된 가게가 계좌를 바꾸면 새 예금주는 확인된 대표자·상호나 이 확인을 거친 예금주와 같아야 함(REQ-199, 4절 A25)';
COMMENT ON COLUMN payment_accounts.card_payment_url IS '가게 명의 카드 결제 링크(있으면, REQ-078)';
COMMENT ON COLUMN payment_accounts.created_at IS '등록한 시각';
COMMENT ON COLUMN payment_accounts.retired_at IS '바꿔서 그만 쓰게 된 시각. 이미 나간 결제 안내는 옛 행을 그대로 참조함';
COMMENT ON COLUMN customers.id IS '손님 ID';
COMMENT ON COLUMN customers.shop_id IS '가게';
COMMENT ON COLUMN customers.kakao_channel_id IS '메시지를 보낸 가게 채널';
COMMENT ON COLUMN customers.kakao_user_key IS '그 채널의 카카오 사용자 키. 손님 명령은 이 키로 구분함(G1). 상담이 모두 지워지고 주문이 모두 보관 기록이 되면 지움(SPEC-065, REQ-190)';
COMMENT ON COLUMN customers.channel_friend IS '채널 친구인지. 손님이 말을 걸 때마다 카카오가 알린 값으로 고치고 알리지 않았으면 친구 아님, 먼저 보낸 안내가 친구 아님으로 실패해도 친구 아님(REQ-219). 먼저 보내는 안내는 친구에게만(REQ-120)';
COMMENT ON COLUMN customers.friend_checked_at IS '친구 여부를 마지막으로 본 시각';
COMMENT ON COLUMN customers.created_at IS '처음 말을 건 시각';
COMMENT ON COLUMN customers.purged_at IS '카카오 사용자 키를 지운 시각(SPEC-065, REQ-190). 같은 사용자가 다시 말을 걸면 새 손님 행으로 받음';
COMMENT ON COLUMN consultations.id IS '상담 ID(AI 호출 기록의 대화 ID)';
COMMENT ON COLUMN consultations.shop_id IS '가게. 채널로 찾은 가게 ID로만 읽고 씀(SPEC-068)';
COMMENT ON COLUMN consultations.customer_id IS '손님';
COMMENT ON COLUMN consultations.status IS '열림·사장님 답 기다림·문의 끊김·주문으로 전환됨·상담 끝남·지워짐(1-1). 상담 끝남과 지워짐은 다시 열지 않고 손님의 다음 말은 새 상담(REQ-189)';
COMMENT ON COLUMN consultations.ai_disclosed_at IS 'AI 상담 고지(TERM-041)를 보낸 시각(REQ-002). 상담마다 한 번, 이어가는 상담에는 다시 보내지 않음(R5)';
COMMENT ON COLUMN consultations.last_customer_message_at IS '손님의 마지막 메시지 시각(문의 끊김 셈, REQ-211)';
COMMENT ON COLUMN consultations.dropped_at IS '문의 끊김으로 닫은 시각(30일 지우기 셈, REQ-186)';
COMMENT ON COLUMN consultations.ended_at IS '상담 끝남으로 닫은 시각: 다룬 주문이 모두 끝나고 손님의 마지막 메시지 뒤 가게가 정한 시간이 지남(30일 지우기 셈, SPEC-025, REQ-189)';
COMMENT ON COLUMN consultations.turn_trace_id IS 'AI 답을 만드는 중인 차례의 추적 ID. 빈 값이면 쉬는 중. 이어 온 메시지는 다음 차례에 모아 답함(3-3)';
COMMENT ON COLUMN consultations.turn_started_at IS '그 차례를 시작한 시각';
COMMENT ON COLUMN consultations.opened_at IS '상담을 연 시각';
COMMENT ON COLUMN consultations.deleted_at IS '대화·사진·주문이 되지 않은 초안을 지운 시각(SPEC-065, REQ-186). 이 행은 내용 없이 남기고 주문·AI 호출 기록(비용)이 참조함';
COMMENT ON COLUMN messages.id IS '메시지 ID';
COMMENT ON COLUMN messages.shop_id IS '가게';
COMMENT ON COLUMN messages.consultation_id IS '상담';
COMMENT ON COLUMN messages.direction IS '수신·발신';
COMMENT ON COLUMN messages.author IS '손님·AI 상담·서버가 만든 글(고지·정해진 문장). 사장님 답과 먼저 보내는 안내는 notifications';
COMMENT ON COLUMN messages.kind IS '글·사진·확인 카드·받지 않는 것(음성·파일·이모티콘)';
COMMENT ON COLUMN messages.kakao_message_id IS '들어온 카카오 요청의 ID. 같은 요청은 한 번만(REQ-132). 어떤 값을 쓸지는 오픈빌더 문서로 개발 전 확인';
COMMENT ON COLUMN messages.body_masked IS '마스킹한 글: 전화·계좌·카드 번호는 플레이스홀더(SPEC-021). AI·로그는 이것만. 원래 값은 masked_values';
COMMENT ON COLUMN messages.trace_id IS '이 메시지를 다룬 차례의 추적 ID(ai_calls와 연결, REQ-131을 잼)';
COMMENT ON COLUMN messages.delivery IS '나간 글이 간 길: 바로 답·콜백·다음 대화 때 전할 것·그렇게 전함·실패(SPEC-017)';
COMMENT ON COLUMN messages.created_at IS '받은 시각이나 만든 시각';
COMMENT ON COLUMN messages.sent_at IS '나간 글을 보낸 시각';
COMMENT ON COLUMN masked_values.id IS '마스킹한 값 ID';
COMMENT ON COLUMN masked_values.shop_id IS '가게';
COMMENT ON COLUMN masked_values.consultation_id IS '상담. 플레이스홀더 번호는 상담 안에서 바뀌지 않음';
COMMENT ON COLUMN masked_values.kind IS '전화번호·계좌번호·카드번호·8자리 넘는 긴 숫자(주민등록번호처럼 보이는 숫자 포함). 나누는 규칙은 SPEC-021';
COMMENT ON COLUMN masked_values.placeholder IS '플레이스홀더, 예: [전화번호1]';
COMMENT ON COLUMN masked_values.original_enc IS '원래 값을 앱이 암호화한 값(5절 E20). 전화번호·계좌번호만 둠(REQ-191). 그 가게 사장님 화면과 사유를 적고 연 운영자에게만(REQ-193, SPEC-073)';
COMMENT ON COLUMN masked_values.value_hmac IS '같은 값 찾기: 원래 값 대신 비밀 키로 만든 HMAC-SHA256(5절 E20). 전화번호·계좌번호만';
COMMENT ON COLUMN masked_values.last4 IS '끝 4자리(운영자 화면의 가린 값, SPEC-073). 카드번호는 이것만 둠. 긴 숫자는 두지 않음(REQ-192)';
COMMENT ON COLUMN masked_values.created_at IS '처음 마스킹한 시각';
COMMENT ON COLUMN order_drafts.id IS '초안 ID';
COMMENT ON COLUMN order_drafts.shop_id IS '가게';
COMMENT ON COLUMN order_drafts.consultation_id IS '상담';
COMMENT ON COLUMN order_drafts.status IS '채우는 중·주문 요청됨';
COMMENT ON COLUMN order_drafts.revision IS '고칠 때마다 오르는 번호(버전이 아님, TERM-003). 주문 요청 카드가 이 값에 묶임(SPEC-028)';
COMMENT ON COLUMN order_drafts.price_list_id IS '옵션을 고른 가격표 버전';
COMMENT ON COLUMN order_drafts.pickup_day IS '원하는 픽업 날짜(가게 시간대). 날짜만 알아도 남김(SPEC-014, SPEC-020, 설계 재검토 M17)';
COMMENT ON COLUMN order_drafts.pickup_time IS '원하는 픽업 시각(가게 시간대). 비어 있으면 아직 모름. 주문 요청 때 날짜와 합쳐 가게 시간대로 픽업 일시(orders.pickup_at)를 만듦(SPEC-029)';
COMMENT ON COLUMN order_drafts.courier_pickup IS '손님이 부른 퀵(TERM-024)으로 받겠다고 함. 말이 없으면 매장 픽업';
COMMENT ON COLUMN order_drafts.size_option_id IS '크기';
COMMENT ON COLUMN order_drafts.flavor_option_id IS '맛';
COMMENT ON COLUMN order_drafts.design_option_id IS '디자인 옵션';
COMMENT ON COLUMN order_drafts.design_id IS '고른 도안';
COMMENT ON COLUMN order_drafts.design_notes IS '손님이 말한 디자인 설명';
COMMENT ON COLUMN order_drafts.lettering IS '문구(TERM-021), 50자까지(AI-1)';
COMMENT ON COLUMN order_drafts.colors IS '색';
COMMENT ON COLUMN order_drafts.allergy_answer IS '알레르기 답(''없음''도 답, REQ-200). 알레르기 정보에 동의한 뒤 전용 블록으로 AI를 거치지 않고 받음(SPEC-075, REQ-202). AI로 보내지 않고(REQ-204) 이 주문 밖에서 쓰지 않음(REQ-236)';
COMMENT ON COLUMN order_drafts.allergy_consent IS '알레르기 정보 동의: 동의함·동의 안 함·동의 필요 없음(배포 설정으로 동의 단계를 끔, REQ-205). 비어 있으면 아직 묻지 않음(SPEC-075). 잠정, 5-2 질문 4';
COMMENT ON COLUMN order_drafts.allergy_consent_version IS '손님이 본 알레르기 정보 동의 글의 버전. 동의함·동의 안 함에만(REQ-201)';
COMMENT ON COLUMN order_drafts.allergy_consent_at IS '동의함·동의 안 함을 누른 시각, 동의 필요 없음이면 알레르기 답 블록을 연 시각(REQ-201, REQ-205)';
COMMENT ON COLUMN order_drafts.excluded_ingredients IS '빼야 할 재료';
COMMENT ON COLUMN order_drafts.customer_name IS '주문자 이름(SPEC-064·065가 말하는 주문의 이름). 주문 요청 확인 카드 전에 AI를 거치지 않는 입력으로 받음(SPEC-072, REQ-175). AI로 보내지 않음(REQ-178)';
COMMENT ON COLUMN order_drafts.customer_phone IS '주문자 연락처(픽업·급한 연락). 주문 요청 확인 카드 전에 AI를 거치지 않는 입력으로 받음(SPEC-072, REQ-175). AI로 보내지 않음(REQ-178)';
COMMENT ON COLUMN order_drafts.order_kind IS '가게 규칙이 가른 주문 종류(견적과 같음, SPEC-013). 기본 디자인 범위 밖 옵션·도안, 참고 사진(SPEC-019), 빼야 할 재료, ''부터''·''범위'' 값이 하나라도 있으면 맞춤(REQ-229)';
COMMENT ON COLUMN order_drafts.created_at IS '만든 시각';
COMMENT ON COLUMN order_drafts.updated_at IS '마지막으로 고친 시각';
COMMENT ON COLUMN reference_photos.id IS '사진 ID';
COMMENT ON COLUMN reference_photos.shop_id IS '가게';
COMMENT ON COLUMN reference_photos.draft_id IS '붙인 주문서 초안(REQ-003). 주문이 되면 주문이 이 초안을 참조함';
COMMENT ON COLUMN reference_photos.message_id IS '사진이 온 메시지';
COMMENT ON COLUMN reference_photos.position IS '메시지 안 순서(상담마다 10장까지는 앱이 봄)';
COMMENT ON COLUMN reference_photos.storage_key IS '저장 위치. 그 가게 사장님 화면과 그 상담에만 보이고 AI 모델로 보내지 않음(3-3)';
COMMENT ON COLUMN reference_photos.content_type IS '사진 종류';
COMMENT ON COLUMN reference_photos.byte_size IS '크기(20MB까지)';
COMMENT ON COLUMN reference_photos.created_at IS '받은 시각';
COMMENT ON COLUMN quotes.id IS '견적 ID';
COMMENT ON COLUMN quotes.shop_id IS '가게';
COMMENT ON COLUMN quotes.draft_id IS '계산한 주문서 초안';
COMMENT ON COLUMN quotes.draft_revision IS '계산할 때 초안의 고친 번호';
COMMENT ON COLUMN quotes.price_list_id IS '계산한 가격표 버전(REQ-007)';
COMMENT ON COLUMN quotes.operating_rules_id IS '유효 기한을 정한 운영규정 버전';
COMMENT ON COLUMN quotes.order_kind IS '기본 디자인·맞춤: 고른 옵션·도안이 모두 그 버전의 기본 디자인 범위 안이고 참고 사진·빼야 할 재료가 없고 표시 방식이 ''확정''일 때만 기본 디자인(quotes_standard_fixed_chk, SPEC-013, REQ-229)';
COMMENT ON COLUMN quotes.display_kind IS '표시 방식: 확정·부터·범위(REQ-006). 고른 옵션에 ''부터''가 있으면 부터, 아니고 ''범위''가 있으면 범위(SPEC-013)';
COMMENT ON COLUMN quotes.amount IS '금액: 고른 옵션 값(범위면 아래 끝)과 더하는 값의 합. ''부터''·''범위''면 아래 끝이고 맞춤 주문의 최종 금액은 이 값 이상(SPEC-031, REQ-230)';
COMMENT ON COLUMN quotes.amount_max IS '범위의 위 끝: 범위 옵션의 위 끝과 나머지 값의 합. 사장님이 정한 금액이 이보다 높으면 손님이 새 금액을 확인(SPEC-076)';
COMMENT ON COLUMN quotes.basis IS '근거: 쓴 옵션 행과 규칙. 사장님 화면에 전부, 손님에게는 금액·표시 방식·유효 기한만(SPEC-013)';
COMMENT ON COLUMN quotes.valid_until IS '유효 기한(기본 안내 뒤 72시간). 그 전에 가격표 버전이 바뀌면 만료됨(TERM-013)';
COMMENT ON COLUMN quotes.quoted_at IS '안내한 시각';
COMMENT ON COLUMN orders.id IS '주문 ID(손님에게 보이지 않음)';
COMMENT ON COLUMN orders.shop_id IS '가게';
COMMENT ON COLUMN orders.order_no IS '주문번호: 손님에게 보이는 유일한 번호. 차례 번호가 아닌 무작위라 주문 수가 드러나지 않음(G6)';
COMMENT ON COLUMN orders.customer_id IS '요청한 카카오 사용자. 변경·취소·신고는 이 사용자만(REQ-062)';
COMMENT ON COLUMN orders.consultation_id IS '요청한 상담';
COMMENT ON COLUMN orders.draft_id IS '요청한 주문서 초안. 참고 사진은 이 초안에 붙어 있음. 재제작 주문은 빈 값';
COMMENT ON COLUMN orders.kind IS '기본 디자인 주문(TERM-039)·맞춤 주문(TERM-038). 가게 규칙이 가른 값';
COMMENT ON COLUMN orders.status IS '주문 요청됨·결제 기다림·결제 기한 지남·확정·받음(픽업 완료됨·퀵으로 보냄)·미수령·거절됨·취소됨(1-2)';
COMMENT ON COLUMN orders.version IS '주문 내용의 지금 버전(TERM-005). 카드·변경 요청이 이 값에 묶임(G3, G9). 상태만 바꾸는 쓰기에는 오르지 않아 동시 쓰기는 잠금 번호(lock_version)로 견줌(A6)';
COMMENT ON COLUMN orders.price_list_id IS '금액을 계산한 가격표 버전(REQ-030)';
COMMENT ON COLUMN orders.operating_rules_id IS '동의한 운영규정 버전. 환불·변경 마감은 이 버전으로(REQ-030, REQ-055)';
COMMENT ON COLUMN orders.details_confirmed_at IS '주문 내용 확인(TERM-009)한 시각';
COMMENT ON COLUMN orders.terms_consented_at IS '취소·환불 규정 동의(TERM-040)한 시각. 주문 요청과 같은 행에 함께 남겨 하나만 남을 수 없음(REQ-054)';
COMMENT ON COLUMN orders.pickup_at IS '픽업 일시(TERM-023). 현재 버전의 주문 내용과 같음(orders_current_details_fk)';
COMMENT ON COLUMN orders.pickup_day IS '가게 시간대의 픽업 날짜(자리·목록용, 픽업 일시에서 셈)';
COMMENT ON COLUMN orders.amount IS '현재 버전의 금액(원). 현재 버전의 주문 내용과 같음(orders_current_details_fk)';
COMMENT ON COLUMN orders.requested_at IS '주문 요청(TERM-010) 시각';
COMMENT ON COLUMN orders.accepted_at IS '사장님 수락(TERM-011) 시각. 1-2에 수락 상태가 없어 상태가 아닌 시각으로 둠';
COMMENT ON COLUMN orders.accepted_version IS '수락한 버전. 결제 안내 금액의 기준(REQ-076)';
COMMENT ON COLUMN orders.confirmed_at IS '주문 확정(TERM-012) 시각. 결제 확인됨으로만(REQ-060). 받음·미수령의 시각은 productions에';
COMMENT ON COLUMN orders.confirmed_payment_id IS '주문을 확정한 확인된 결제(첫 결제나 다시 낸 결제, SPEC-034, SPEC-036). 주문 확정 뒤 상태면 꼭 있음(재제작 주문은 빼고). 그 결제 확인을 취소하면 비우고 결제 기다림으로 돌림(SPEC-070, 트리거 payments_confirmed_void, 설계 재검토 M7)';
COMMENT ON COLUMN orders.rejected_at IS '맞춤 주문을 거절한 시각';
COMMENT ON COLUMN orders.reject_reason IS '거절 사유';
COMMENT ON COLUMN orders.cancelled_at IS '취소된 시각';
COMMENT ON COLUMN orders.cancel_kind IS '손님이 취소함·가게 사정으로 취소됨·결제 없어 취소됨(사장님이 고르거나 픽업 일시까지 고르지 않음, REQ-217)·답 없어 닫힘(맞춤 주문 요청에 그 픽업 날짜의 주문 마감까지 사장님 답이 없음, REQ-213)';
COMMENT ON COLUMN orders.cancel_reason IS '가게 사정 취소의 사유(SPEC-048)';
COMMENT ON COLUMN orders.remake_of_order_id IS '재제작(TERM-034) 주문이면 돈을 낸 원래 주문(R21). 재제작 주문을 가리키지 않음(트리거 orders_remake_root). 가격표·운영규정 버전은 원래 주문 것(SPEC-060, 4절 A31)';
COMMENT ON COLUMN orders.finished_at IS '주문이 끝난 시각: 받음·미수령·거절됨·취소됨이고 보내지 않은 환불·열린 신고·변경 요청·결제 안내·할 일이 없고, 원래 주문은 끝나지 않은 재제작 주문도 없음(SPEC-025, SPEC-060, SPEC-065, 트리거 orders_remake_finish). 그 뒤 늦은 신고나 들어온 입금 대조로 다시 열리면 개인정보를 지우기 전까지는 비움(A22)';
COMMENT ON COLUMN orders.personal_data_purged_at IS '끝나고 30일 뒤 개인정보를 지우고 보관 기록(kept_records)으로 나눈 시각(SPEC-065, REQ-185, REQ-187). 이 주문은 화면·API·AI가 읽지 않음(A22)';
COMMENT ON COLUMN orders.updated_at IS '마지막으로 바뀐 시각';
COMMENT ON COLUMN orders.lock_version IS '잠금 번호: 이 행을 쓸 때마다(상태·시각·금액·버전) 하나 오름. 읽은 값과 같을 때만 씀(A6, E15, 설계 재검토 H12). 06단계 주문의 revision(DEC-05)';
COMMENT ON COLUMN confirm_cards.id IS '카드 ID';
COMMENT ON COLUMN confirm_cards.shop_id IS '가게';
COMMENT ON COLUMN confirm_cards.consultation_id IS '카드를 보낸 상담';
COMMENT ON COLUMN confirm_cards.customer_id IS '카드를 받은 사용자. 이 사용자만 누름(G9)';
COMMENT ON COLUMN confirm_cards.card_key IS '버튼에 포함한 카드 키(G2)';
COMMENT ON COLUMN confirm_cards.kind IS '주문 요청·입금 알리기·변경 요청·취소·신고·동의 철회(SPEC-069)·주문자 정보(SPEC-072, 주문 요청 카드 앞에서 이름·연락처를 받음)·알레르기 정보(SPEC-075, 주문자 정보 카드 앞에서 따로 동의를 받음)·사진 게시 동의(SPEC-053, 완성 사진 안내의 버튼)·새 금액 확인(SPEC-076, 결제 안내를 전할 때 계좌 대신)';
COMMENT ON COLUMN confirm_cards.draft_id IS '주문 요청·주문자 정보·알레르기 정보 카드의 초안';
COMMENT ON COLUMN confirm_cards.draft_revision IS '묶인 초안 고친 번호(SPEC-028)';
COMMENT ON COLUMN confirm_cards.order_id IS '대상 주문. 주문 요청 카드는 누른 뒤 생긴 주문';
COMMENT ON COLUMN confirm_cards.order_version IS '묶인 주문 버전(G9)';
COMMENT ON COLUMN confirm_cards.payload IS '서버가 저장된 값으로 만든 카드 내용(요약·금액·규정 버전·환불 계산값). AI가 쓰지 않음. 주문이 끝나고 30일 뒤 빈 객체({})로 비움(SPEC-065)';
COMMENT ON COLUMN confirm_cards.expires_at IS '보낸 뒤 30분(G9)';
COMMENT ON COLUMN confirm_cards.used_at IS '누른 시각. 한 카드는 한 번만 명령을 내림';
COMMENT ON COLUMN confirm_cards.outcome IS '명령함·버전이 바뀌어 거절(새 카드)·기한 지나 거절(새 카드)';
COMMENT ON COLUMN confirm_cards.created_at IS '보낸 시각';
COMMENT ON COLUMN change_requests.id IS '변경 요청 ID';
COMMENT ON COLUMN change_requests.shop_id IS '가게';
COMMENT ON COLUMN change_requests.order_id IS '바꾸려는 주문(확정된 주문만, R16)';
COMMENT ON COLUMN change_requests.card_id IS '손님이 누른 변경 요청 카드';
COMMENT ON COLUMN change_requests.base_version IS '카드에 묶인 주문 버전. 현재 버전과 다르면 받지 않음(REQ-133)';
COMMENT ON COLUMN change_requests.changes IS '바꾸려는 내용(디자인·문구·날짜·시간). 주문이 끝나고 30일 뒤 빈 객체({})로 비움(SPEC-065)';
COMMENT ON COLUMN change_requests.new_pickup_at IS '날짜·시간을 바꾸면 새 픽업 일시';
COMMENT ON COLUMN change_requests.needs_owner_day IS '새 날이 휴무일이거나 마감된 날이라 사장님이 휴무일임이나 초과해 받는 것을 확인한 뒤에만 받음(SPEC-041, REQ-221, REQ-226)';
COMMENT ON COLUMN change_requests.status IS '요청됨·차액 결제 기다림(손님의 새 금액 확인과 차액 맞추는 중을 포함하고 차액 결제 안내의 상태로 가름)·반영됨·거절됨·차액 없어 닫힘(차액 결제 기한 지남·손님이 새 금액을 받지 않음·변경 닫기)·주문 취소로 닫힘·답 없어 닫힘(1-5). 답 없어 닫힘은 변경 마감까지 사장님 답이 없을 때(REQ-214)';
COMMENT ON COLUMN change_requests.amount_delta IS '수락할 때 금액 차이: 사장님이 고른 방향(그대로·올라감·내려감)과 양수 차이 금액으로 앱이 셈(올라감 +, 내려감 -, 그대로 0). 사장님이 부호를 넣지 않음(SPEC-042, 설계 재검토 M5)';
COMMENT ON COLUMN change_requests.reject_reason IS '거절 사유';
COMMENT ON COLUMN change_requests.decided_at IS '사장님이 답한 시각';
COMMENT ON COLUMN change_requests.applied_version IS '반영으로 생긴 주문 버전';
COMMENT ON COLUMN change_requests.applied_at IS '반영한 시각';
COMMENT ON COLUMN change_requests.closed_at IS '반영되지 않고 종료된 시각';
COMMENT ON COLUMN change_requests.created_at IS '요청한 시각';
COMMENT ON COLUMN change_requests.lock_version IS '잠금 번호: 이 행을 쓸 때마다(상태·답·반영·닫힘) 하나 오름. 읽은 값과 같을 때만 씀(A6, E15, 설계 재검토 H12). 06단계 변경 요청의 revision(DEC-05)';
COMMENT ON COLUMN order_details.id IS '주문 내용 버전 ID';
COMMENT ON COLUMN order_details.shop_id IS '가게';
COMMENT ON COLUMN order_details.order_id IS '주문';
COMMENT ON COLUMN order_details.version IS '버전(TERM-005): 요청 1, 금액 변경 수락·변경 반영마다 하나 오름';
COMMENT ON COLUMN order_details.source IS '이 버전이 생긴 이유: 주문 요청·금액 변경 수락·변경 반영·재제작';
COMMENT ON COLUMN order_details.change_request_id IS '변경 반영으로 생긴 버전의 변경 요청';
COMMENT ON COLUMN order_details.quote_id IS '요청 때 쓴 견적';
COMMENT ON COLUMN order_details.price_list_id IS '옵션의 가격표 버전';
COMMENT ON COLUMN order_details.pickup_at IS '픽업 일시(TERM-023)';
COMMENT ON COLUMN order_details.courier_pickup IS '손님이 부른 퀵(TERM-024)으로 받음. 오늘 픽업 목록의 퀵 여부(REQ-092)';
COMMENT ON COLUMN order_details.size_option_id IS '크기';
COMMENT ON COLUMN order_details.flavor_option_id IS '맛';
COMMENT ON COLUMN order_details.design_option_id IS '디자인 옵션';
COMMENT ON COLUMN order_details.design_id IS '도안';
COMMENT ON COLUMN order_details.design_notes IS '디자인 설명. 주문이 끝나고 30일 뒤 비움(SPEC-065)';
COMMENT ON COLUMN order_details.lettering IS '문구(TERM-021). 철자는 손님이 쓴 그대로(SPEC-028). 주문이 끝나고 30일 뒤 비움(SPEC-065)';
COMMENT ON COLUMN order_details.colors IS '색';
COMMENT ON COLUMN order_details.allergy_answer IS '알레르기 답. 알레르기 정보에 동의한 주문에만(REQ-200, REQ-203). 이 주문 밖에서 쓰지 않고 장부에 적지 않고 AI로 보내지 않음(REQ-236, REQ-204, SPEC-064). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN order_details.allergy_consent IS '초안에서 옮긴 알레르기 정보 동의: 동의함·동의 안 함(''알레르기 정보 동의 안 함''으로 보임, SPEC-050)·동의 필요 없음(REQ-201, REQ-205). 지우기는 이 동의 기록을 남김(SPEC-065)';
COMMENT ON COLUMN order_details.allergy_consent_version IS '손님이 본 알레르기 정보 동의 글의 버전. 동의함·동의 안 함에만(REQ-201)';
COMMENT ON COLUMN order_details.allergy_consent_at IS '알레르기 정보 동의의 답을 남긴 시각(초안에서 옮김)';
COMMENT ON COLUMN order_details.excluded_ingredients IS '빼야 할 재료. 주문이 끝나고 30일 뒤 비움(SPEC-065)';
COMMENT ON COLUMN order_details.customer_name IS '주문자 이름. 주문이 끝나고 30일 뒤 비우고 보관 기록으로 옮김(SPEC-065, REQ-185)';
COMMENT ON COLUMN order_details.customer_phone IS '주문자 연락처. 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN order_details.amount IS '이 버전의 금액(원)';
COMMENT ON COLUMN order_details.amount_change_reason IS '금액 변경 수락의 사유(SPEC-031)';
COMMENT ON COLUMN order_details.created_at IS '이 버전이 생긴 시각';
COMMENT ON COLUMN handoffs.id IS '에스컬레이션 건 ID';
COMMENT ON COLUMN handoffs.shop_id IS '가게';
COMMENT ON COLUMN handoffs.consultation_id IS '상담';
COMMENT ON COLUMN handoffs.source_message_id IS '에스컬레이션한 손님 말. 같은 메시지는 한 번만 에스컬레이션함(SPEC-022). 열린 동안 온 새 질문은 덧붙은 질문(handoff_questions)으로 남음';
COMMENT ON COLUMN handoffs.order_id IS '관련 주문(있으면)';
COMMENT ON COLUMN handoffs.reason IS '에스컬레이션한 사유: 먹어도 되는지·답할 수 없음·마감된 날·법·의료·손님 요청·다른 사용자·받기 전 문제·AI 실패·AI 비용 한도·콜백 시간 초과·마스킹 실패·빈 답·조문 없음';
COMMENT ON COLUMN handoffs.requested_day IS '마감된 날에 추가로 받을지 묻는 질문의 날짜(SPEC-014). 마감된 날 질문에만 있고, 다른 열린 건이 있어도 날짜마다 따로 건(handoffs_one_open_day_per_consultation, 설계 재검토 M17)';
COMMENT ON COLUMN handoffs.status IS '열림·답함·답 없어 닫힘(남긴 지 7일, REQ-216)';
COMMENT ON COLUMN handoffs.answer_text IS '사장님 답. AI가 고치지 않고 그대로 전함(SPEC-023)';
COMMENT ON COLUMN handoffs.day_decision IS '마감된 날: 추가 수락·받지 않음';
COMMENT ON COLUMN handoffs.day_accept_expires_at IS '추가 수락한 날에 주문 요청으로 자리를 잡을 수 있는 기한(24시간, SPEC-023)';
COMMENT ON COLUMN handoffs.day_used_order_id IS '추가 수락을 쓴 주문 요청: 그 날짜에 마감 후 추가 수락(slot_holds.overbooked)으로 자리를 잡은 주문. 추가 수락 하나는 주문 요청 하나에만(SPEC-023, SPEC-029, 4절 A34)';
COMMENT ON COLUMN handoffs.appended_alerted_at IS '''새 질문 덧붙음'' 알림을 마지막으로 보낸 시각(하루 한 번까지, SPEC-022)';
COMMENT ON COLUMN handoffs.answered_at IS '답한 시각';
COMMENT ON COLUMN handoffs.closed_at IS '답 없어 닫힌 시각(남긴 지 7일, REQ-216). 그 뒤 상담은 문의 끊김으로 닫히고 지워질 수 있음(1-1)';
COMMENT ON COLUMN handoffs.created_at IS '에스컬레이션한 시각';
COMMENT ON COLUMN issue_details.id IS '신고 내용 ID';
COMMENT ON COLUMN issue_details.shop_id IS '가게';
COMMENT ON COLUMN issue_details.consultation_id IS '상담';
COMMENT ON COLUMN issue_details.order_id IS '받은 주문(픽업 완료됨·퀵으로 보냄). 모으는 동안은 비어 있을 수 있고 신고 때는 있어야 함';
COMMENT ON COLUMN issue_details.description IS '설명. 사진 없이도 신고할 수 있음. 신고된 것은 주문이 끝난 날부터 3년 뒤 비움(SPEC-065, REQ-188)';
COMMENT ON COLUMN issue_details.health_concern IS '먹고 아프다는 말: 정해진 문장을 덧붙이고 사장님께 바로 알림(SPEC-057)';
COMMENT ON COLUMN issue_details.status IS '모으는 중·신고됨·그만둠';
COMMENT ON COLUMN issue_details.created_at IS '모으기 시작한 시각';
COMMENT ON COLUMN issue_details.updated_at IS '마지막으로 더한 시각';
COMMENT ON COLUMN issue_details.content_purged_at IS '신고된 설명과 사진을 지운 시각(주문이 끝난 날부터 3년, SPEC-065, REQ-188)';
COMMENT ON COLUMN issue_photos.id IS '신고 사진 ID';
COMMENT ON COLUMN issue_photos.shop_id IS '가게';
COMMENT ON COLUMN issue_photos.issue_details_id IS '신고 내용';
COMMENT ON COLUMN issue_photos.message_id IS '사진이 온 메시지. 상담을 지울 때 신고된 사진은 메시지 연결만 비우고 주문이 끝난 날부터 3년 남김(SPEC-065, REQ-187)';
COMMENT ON COLUMN issue_photos.position IS '순서(5장까지, SPEC-057)';
COMMENT ON COLUMN issue_photos.storage_key IS '저장 위치. AI 모델로 보내지 않음(3-3)';
COMMENT ON COLUMN issue_photos.content_type IS '사진 종류';
COMMENT ON COLUMN issue_photos.byte_size IS '크기(20MB까지)';
COMMENT ON COLUMN issue_photos.created_at IS '받은 시각';
COMMENT ON COLUMN issue_reports.id IS '문제 신고 ID';
COMMENT ON COLUMN issue_reports.shop_id IS '가게';
COMMENT ON COLUMN issue_reports.order_id IS '받은 주문';
COMMENT ON COLUMN issue_reports.issue_details_id IS '모은 신고 내용(TERM-032)';
COMMENT ON COLUMN issue_reports.card_id IS '손님이 누른 신고 카드';
COMMENT ON COLUMN issue_reports.follows_report_id IS '같은 주문의 두 번째 신고면 첫 신고(연결, SPEC-058)';
COMMENT ON COLUMN issue_reports.late IS '운영규정의 신고 기한 뒤에 옴(REQ-072)';
COMMENT ON COLUMN issue_reports.status IS '신고됨·보상 정해짐·닫힘(1-6)';
COMMENT ON COLUMN issue_reports.compensation IS '보상(TERM-033): 재제작·일부 환불·전액 환불·보상 없음. 사장님만 정함(REQ-073)';
COMMENT ON COLUMN issue_reports.decided_at IS '보상을 정한 시각';
COMMENT ON COLUMN issue_reports.remake_order_id IS '재제작 주문(TERM-034). 보상 하나에 하나(SPEC-060)';
COMMENT ON COLUMN issue_reports.closed_at IS '보상 안내를 보내고 닫은 시각';
COMMENT ON COLUMN issue_reports.reported_at IS '신고한 시각';
COMMENT ON COLUMN payment_requests.id IS '결제 안내 ID';
COMMENT ON COLUMN payment_requests.shop_id IS '가게';
COMMENT ON COLUMN payment_requests.order_id IS '주문. 재제작 주문에는 없음(트리거 payment_requests_remake, SPEC-060)';
COMMENT ON COLUMN payment_requests.kind IS '첫 결제·다시 낸 결제(결제 기한 연장, TERM-037)·차액 결제(R13). 날짜 변경·재제작에는 없음';
COMMENT ON COLUMN payment_requests.change_request_id IS '차액 결제의 변경 요청';
COMMENT ON COLUMN payment_requests.event_key IS '같은 이벤트의 결제 안내는 한 번(REQ-154). 형식 pay:{대상 ID}:{결제 종류}. 대상은 첫 결제면 주문, 다시 낸 결제면 기한이 지난 결제 안내, 차액 결제면 변경 요청(4절 A33)';
COMMENT ON COLUMN payment_requests.status IS '나감·확인 요청됨·맞추는 중·확인됨·기한 지남·닫힘(1-3)';
COMMENT ON COLUMN payment_requests.version IS '비교해 쓰는 번호(G3)';
COMMENT ON COLUMN payment_requests.amount IS '안내 금액: 수락한 버전(기본 디자인은 요청한 버전)의 금액(REQ-076). 차액 결제는 사장님이 고른 방향과 차이 금액으로 셈한 오른 금액(SPEC-042)';
COMMENT ON COLUMN payment_requests.requested_amount IS '금액을 정하거나 바꿔 수락한 맞춤 주문에서 손님이 요청한 견적 금액(''부터''·''범위''면 아래 끝). 표시 방식과 위 끝은 그 주문 첫 버전의 견적(order_details.quote_id)에서 읽어 함께 보임(REQ-231). 다시 낸 결제도 같은 값';
COMMENT ON COLUMN payment_requests.needs_amount_confirm IS '새 금액 확인이 필요한 결제 안내: 손님이 본 금액(견적이 금액 하나면 그 금액, ''부터''면 아래 끝, ''범위''면 위 끝)보다 높게 정한 맞춤 주문의 첫 결제와 확인 전에 다시 낸 결제, 금액이 오르는 변경의 차액 결제. 손님이 확인하기 전에는 계좌를 보이지 않고 결제 기한은 상한(SPEC-076, REQ-232)';
COMMENT ON COLUMN payment_requests.amount_confirmed_at IS '손님이 새 금액을 확인한 시각. 이때가 전해진 시각(payment_requests_amount_delivered_chk). 확인 전에 들어온 돈을 사장님이 결제로 확인(''입금됨''·''대조 완료'')하면 그 시각(SPEC-034)';
COMMENT ON COLUMN payment_requests.amount_declined_at IS '손님이 새 금액을 받지 않은 시각. 결제 안내를 닫음: 맞춤 주문은 손님 취소(주문 취소), 변경은 변경 요청이 차액 없어 닫힘(REQ-233)';
COMMENT ON COLUMN payment_requests.amount_card_id IS '손님이 누른 새 금액 확인 카드(SPEC-076). 사장님의 결제 확인으로 남긴 확인이면 빈 값';
COMMENT ON COLUMN payment_requests.payment_account_id IS '이 안내에 포함한 가게 계좌. 계좌를 바꿔도 나간 안내는 그대로';
COMMENT ON COLUMN payment_requests.card_payment_url IS '이 안내에 포함한 카드 결제 링크(있으면)';
COMMENT ON COLUMN payment_requests.issued_at IS '낸 시각. 결제 기한은 이때가 아니라 손님에게 전해진 시각부터 셈(REQ-218)';
COMMENT ON COLUMN payment_requests.delivered_at IS '결제 안내가 손님에게 전해진 시각: 대화 중 답으로 보임·먼저 보낸 안내가 닿음·다음 대화 때 전함(SPEC-032). 새 금액 확인이 필요하면 손님이 확인한 시각(SPEC-076). 빈 값이면 ''아직 못 전함''(SPEC-037)';
COMMENT ON COLUMN payment_requests.due_at IS '결제 기한(TERM-030): 전해진 시각에 운영규정의 결제 기한을 더한 때와 결제 기한 상한 가운데 이른 쪽. 전해지기 전에는 상한(REQ-218)';
COMMENT ON COLUMN payment_requests.due_cap_at IS '결제 기한 상한: 첫 결제·다시 낸 결제는 그 픽업 날짜의 주문 마감(이미 지났으면 픽업 일시), 차액 결제는 변경 마감(REQ-218, R18). 낼 때 정함. 확인 요청됨도 이때 기한 지남(REQ-223)';
COMMENT ON COLUMN payment_requests.claimed_at IS '손님이 입금했다고 알려 결제 확인을 요청한 시각(REQ-224). 기한 전이면 결제 기한 상한까지 자리를 지킴(R14, REQ-223)';
COMMENT ON COLUMN payment_requests.claim_card_id IS '손님이 누른 입금 알리기 카드';
COMMENT ON COLUMN payment_requests.claim_rejected_at IS '사장님이 ''미입금''을 고른 시각. 확인 요청은 결제 안내마다 한 번이라 다시 받지 않음(SPEC-033)';
COMMENT ON COLUMN payment_requests.depositor_name IS '입금자 이름(입금 대조, TERM-063). 손님이 결제 확인을 요청할 때 AI를 거치지 않는 입력으로 받고, 따로 넣지 않으면 주문자 이름(SPEC-033, REQ-176). AI로 보내지 않음(REQ-178). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN payment_requests.mismatch_amount IS '다르게 들어온 금액(R15). 안내 금액의 10배까지(SPEC-035)';
COMMENT ON COLUMN payment_requests.mismatch_at IS '''금액 불일치''를 남긴 시각. 맞추는 중에는 결제 기한을 멈춤(REQ-161)';
COMMENT ON COLUMN payment_requests.arrived_amount IS '들어온 금액(받은 금액의 몫, REQ-165). 입금됨은 안내 금액, 맞추는 중은 다르게 들어온 금액(모자란 금액이 마저 들어오면 안내 금액, 더 들어온 채 대조 완료면 그대로), 결제로 확인하지 않은 들어온 입금은 사장님이 남긴 금액(SPEC-071)';
COMMENT ON COLUMN payment_requests.arrived_at IS '들어온 금액을 남긴 시각. 결제 확인 취소(SPEC-070)면 지움';
COMMENT ON COLUMN payment_requests.paid_at IS '확인됨이 된 시각';
COMMENT ON COLUMN payment_requests.expired_at IS '기한 지남이 된 시각';
COMMENT ON COLUMN payment_requests.closed_at IS '닫힌 시각';
COMMENT ON COLUMN payment_requests.close_reason IS '새 결제 안내·주문 취소(맞춤 주문의 새 금액을 받지 않음 포함)·변경 요청이 닫힘(차액의 새 금액을 받지 않음·변경 닫기 포함)';
COMMENT ON COLUMN payments.id IS '확인된 결제 ID';
COMMENT ON COLUMN payments.shop_id IS '가게';
COMMENT ON COLUMN payments.order_id IS '주문';
COMMENT ON COLUMN payments.payment_request_id IS '확인한 결제 안내';
COMMENT ON COLUMN payments.amount IS '확인된 금액 = 안내 금액. 받은 금액은 결제 안내의 들어온 금액으로 셈(REQ-165). 선결제(TERM-014)는 가게 계좌로 감';
COMMENT ON COLUMN payments.resolution IS '입금됨·대조 완료(모자란 금액이 입금됨)·대조 완료(더 들어온 금액은 환불로 돌려줌, SPEC-047)(R15)';
COMMENT ON COLUMN payments.confirmed_at IS '사장님이 확인한 시각';
COMMENT ON COLUMN payments.voided_at IS '사장님이 잘못 누른 결제 확인을 취소한 시각(SPEC-070). 취소한 결제는 받은 금액에 들지 않음';
COMMENT ON COLUMN payments.void_reason IS '결제 확인을 취소한 사유(REQ-169). 손님 안내에는 적지 않음';
COMMENT ON COLUMN refunds.id IS '환불 ID';
COMMENT ON COLUMN refunds.shop_id IS '가게';
COMMENT ON COLUMN refunds.order_id IS '주문. 재제작 주문의 취소·보상 환불은 원래 주문에 남김(트리거 refunds_remake, SPEC-060, 4절 A31)';
COMMENT ON COLUMN refunds.cause IS '손님 취소·가게 사정 취소·금액이 내려간 변경·보상·취소 뒤 들어온 입금·더 들어온 금액(안내 금액을 넘은 몫, 기한 뒤 차액, SPEC-071)';
COMMENT ON COLUMN refunds.change_request_id IS '금액이 내려간 변경';
COMMENT ON COLUMN refunds.issue_report_id IS '보상의 문제 신고';
COMMENT ON COLUMN refunds.payment_request_id IS '돌려줄 들어온 입금의 결제 안내(취소 뒤 들어온 입금·더 들어온 금액, SPEC-071)';
COMMENT ON COLUMN refunds.cancelled_order_id IS '취소 환불(손님 취소·가게 사정 취소)이면 취소한 주문: 그 주문이나 그 재제작 주문(트리거 refunds_cancelled). 취소한 주문마다 환불 하나(refunds_cancelled_uq, 4절 A33, 설계 재검토 M7)';
COMMENT ON COLUMN refunds.event_key IS '같은 환불을 두 번 정하지 않음(G2). 형식 refund:{대상 ID}:{사유}. 대상은 취소한 주문·변경 요청·문제 신고·결제 안내이고 대상마다 하나는 UNIQUE로도 막음(4절 A33)';
COMMENT ON COLUMN refunds.decision IS '전액 환불·일부 환불·환불 없이 취소(REQ-085). 금액이 내려간 변경은 차액 돌려주기라 전액 환불이 없음(refunds_change_decision_chk, SPEC-047)';
COMMENT ON COLUMN refunds.amount IS '정한 환불 금액. 주문의 환불 합은 받은 금액(결제 안내의 들어온 금액 합)을 넘지 않음(REQ-165, 앱이 주문 행을 잠그고 셈). 보상이 아니면 계산값 이상(REQ-170). 상한은 들어온 금액의 상한과 같은 1억 원';
COMMENT ON COLUMN refunds.calculated_amount IS '가게 규칙의 계산값(SPEC-016, 4절 A30). 손님 취소는 바탕(받은 금액 - 이미 정한 환불 - 따로 정할 환불)에서 취소 수수료(TERM-016)를 먼저 빼고(바탕보다 크면 0) 비율을 곱해 원 미만 버림. 가게 사정 취소는 바탕 전액, 금액이 내려간 변경은 내려간 금액, 보상은 고른 금액. 취소 뒤 들어온 입금·더 들어온 금액은 그 결제 안내에서 결제로 확인하지 않은 몫(들어온 금액 - 취소하지 않은 확인된 결제)을 넘지 않음(트리거 refunds_unconfirmed, 4절 A29)';
COMMENT ON COLUMN refunds.calc_basis IS '근거: 운영규정 버전·조문·취소 시각·맞춤 재료 주문 시각·제작 시작 시각·받은 금액의 몫(확인된 결제와 결제로 확인하지 않은 들어온 금액, REQ-084, REQ-165)';
COMMENT ON COLUMN refunds.override_reason IS '계산값과 다른 금액을 고른 사유 1~200자(SPEC-047, REQ-084). 다르면 꼭(refunds_override_chk), 보상이 아니면 높을 때만 다를 수 있음(refunds_floor_chk). 보상은 고른 금액이 계산값이라 비움';
COMMENT ON COLUMN refunds.method IS '가게 계좌에서 반환·카드 결제 취소';
COMMENT ON COLUMN refunds.refund_bank_name IS '환불받을 손님 은행(SPEC-049). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN refunds.refund_account_enc IS '환불받을 손님 계좌번호를 앱이 암호화한 값(5절 E20, REQ-191). 숫자와 ''-'' 형식은 06단계 API가 봄. 그 가게 사장님 화면의 이 환불과 사유를 적고 연 운영자에게만, AI·로그 0번(R19, REQ-193). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN refunds.refund_account_last4 IS '환불받을 계좌번호 끝 4자리(운영자 화면의 가린 값, SPEC-073). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN refunds.refund_holder_name IS '환불받을 계좌의 예금주. 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN refunds.decided_at IS '정한 시각';
COMMENT ON COLUMN refunds.sent_at IS '사장님이 ''보냄''을 표시한 시각(REQ-172). 우리는 돈을 옮기지 않음(REQ-079). 그 전까지 환불 보내기 할 일이 남음(REQ-173)';
COMMENT ON COLUMN slot_holds.id IS '자리 ID';
COMMENT ON COLUMN slot_holds.shop_id IS '가게';
COMMENT ON COLUMN slot_holds.day IS '자리의 날짜(가게 시간대)';
COMMENT ON COLUMN slot_holds.order_id IS '자리를 가진 주문';
COMMENT ON COLUMN slot_holds.payment_request_id IS '잡힘이면 그 결제 안내. 그 결제 기한까지 잡고, 확인 요청됨이면 결제 기한 상한까지(R13, REQ-223). 금액이 오르는 날짜 변경의 새 날 자리는 차액 결제 안내(REQ-234)';
COMMENT ON COLUMN slot_holds.hold_key IS '같은 주문의 같은 가예약은 한 번(SPEC-015). 형식 hold:{주문 ID}:{결제 안내 ID}, 날짜 변경은 hold:{주문 ID}:{변경 요청 ID}, 재제작은 hold:{주문 ID}:remake(4절 A33)';
COMMENT ON COLUMN slot_holds.status IS '가예약됨·확정됨·해제됨·종료됨(1-4). 한 주문에 잡힌 자리와 확정된 자리는 각각 하나까지이고, 둘이 함께 있는 것은 차액을 기다리는 날짜 변경뿐(트리거 slot_holds_pair, REQ-234)';
COMMENT ON COLUMN slot_holds.overbooked IS '마감 후 추가 수락: 다 찬 날이나 휴무일에 사장님이 확인하고 받은 자리(R10, REQ-221, REQ-226). 그날은 다른 손님에게 계속 마감(REQ-045)';
COMMENT ON COLUMN slot_holds.fixed_at IS '확정 자리가 된 시각(결제 확인됨, 날짜 변경의 새 날(차액을 기다린 새 날 자리는 변경 반영 때), 재제작)';
COMMENT ON COLUMN slot_holds.released_at IS '풀린 시각';
COMMENT ON COLUMN slot_holds.release_reason IS '결제 기한 지남·주문 취소·날짜 변경의 옛 날·변경 요청이 반영되지 않고 닫혀 차액을 기다린 새 날을 풂(REQ-234)';
COMMENT ON COLUMN slot_holds.done_at IS '픽업 일시가 지나 종료된 시각';
COMMENT ON COLUMN slot_holds.created_at IS '잡은 시각';
COMMENT ON COLUMN productions.id IS '제작 ID';
COMMENT ON COLUMN productions.shop_id IS '가게';
COMMENT ON COLUMN productions.order_id IS '확정된 주문(재제작 주문 포함)';
COMMENT ON COLUMN productions.needs_custom_material IS '맞춤 재료(TERM-022)가 필요한지. 제작 목록에 보임';
COMMENT ON COLUMN productions.custom_material_ordered_at IS '맞춤 재료 주문 시각(환불 근거, REQ-089)';
COMMENT ON COLUMN productions.production_started_at IS '제작 시작 시각(환불 근거, REQ-090)';
COMMENT ON COLUMN productions.completed_at IS '완성 표시 시각';
COMMENT ON COLUMN productions.changed_after_start IS '재료 주문·제작 시작 뒤 변경이 반영됨. 제작 목록의 ''변경됨''(SPEC-045)';
COMMENT ON COLUMN productions.handed_over_at IS '인도 시각(REQ-091). 있으면 주문은 받음(4절 A27)';
COMMENT ON COLUMN productions.handover_kind IS '픽업 완료됨·퀵(TERM-024)으로 보냄';
COMMENT ON COLUMN productions.no_pickup_at IS '미수령(TERM-025) 표시 시각. 인도 시각 없이 있으면 주문은 미수령(4절 A27)';
COMMENT ON COLUMN productions.discarded_at IS '미수령 케이크 폐기 시각(REQ-094)';
COMMENT ON COLUMN productions.created_at IS '제작 목록에 오른 시각(주문 확정)';
COMMENT ON COLUMN production_undos.id IS '되돌림 ID';
COMMENT ON COLUMN production_undos.shop_id IS '가게';
COMMENT ON COLUMN production_undos.production_id IS '제작';
COMMENT ON COLUMN production_undos.mark IS '되돌린 표시';
COMMENT ON COLUMN production_undos.marked_at IS '되돌린 원래 시각';
COMMENT ON COLUMN production_undos.undone_at IS '되돌린 시각';
COMMENT ON COLUMN completion_photos.id IS '완성 사진 ID';
COMMENT ON COLUMN completion_photos.shop_id IS '가게';
COMMENT ON COLUMN completion_photos.production_id IS '제작';
COMMENT ON COLUMN completion_photos.position IS '순서(5장까지, SPEC-053)';
COMMENT ON COLUMN completion_photos.storage_key IS '저장 위치';
COMMENT ON COLUMN completion_photos.content_type IS '사진 종류';
COMMENT ON COLUMN completion_photos.byte_size IS '크기(20MB까지)';
COMMENT ON COLUMN completion_photos.created_at IS '올린 시각';
COMMENT ON COLUMN reviews.id IS '후기 버전 ID';
COMMENT ON COLUMN reviews.shop_id IS '가게';
COMMENT ON COLUMN reviews.order_id IS '받은 주문(REQ-095)';
COMMENT ON COLUMN reviews.version IS '고치면 새 버전(SPEC-062)';
COMMENT ON COLUMN reviews.body IS '후기 글';
COMMENT ON COLUMN reviews.created_at IS '남긴 시각';
COMMENT ON COLUMN reviews.superseded_at IS '새 버전이 생긴 시각';
COMMENT ON COLUMN review_photos.id IS '후기 사진 ID';
COMMENT ON COLUMN review_photos.shop_id IS '가게';
COMMENT ON COLUMN review_photos.review_id IS '후기 버전';
COMMENT ON COLUMN review_photos.position IS '순서(5장까지)';
COMMENT ON COLUMN review_photos.storage_key IS '저장 위치';
COMMENT ON COLUMN review_photos.content_type IS '사진 종류';
COMMENT ON COLUMN review_photos.byte_size IS '크기(20MB까지)';
COMMENT ON COLUMN review_photos.created_at IS '올린 시각';
COMMENT ON COLUMN photo_consents.id IS '게시 동의 ID';
COMMENT ON COLUMN photo_consents.shop_id IS '가게';
COMMENT ON COLUMN photo_consents.order_id IS '주문';
COMMENT ON COLUMN photo_consents.scope IS '완성 사진 한 장의 동의(완성 사진 안내의 버튼, SPEC-053)·후기 사진 한 장의 동의(SPEC-062)';
COMMENT ON COLUMN photo_consents.completion_photo_id IS '완성 사진의 동의면 그 사진. 안내 하나의 답을 그 안내에 붙인 사진마다 남김(REQ-207)';
COMMENT ON COLUMN photo_consents.review_photo_id IS '후기 사진의 동의면 그 사진(REQ-208)';
COMMENT ON COLUMN photo_consents.consented IS '동의 여부. 기본 ''동의 안 함''(REQ-207, REQ-208)';
COMMENT ON COLUMN photo_consents.decided_at IS '답한 시각';
COMMENT ON COLUMN photo_consents.withdrawn_at IS '손님이 동의를 철회한 시각. 그 사진을 포트폴리오에서 먼저 내린 뒤 씀(REQ-098, SPEC-063)';
COMMENT ON COLUMN photo_consents.publishable IS '포트폴리오에 올릴 수 있음: 동의했고 철회하지 않은 것과 늘 같음. 올라 있는 항목이 이 값을 참조해 올린 채로는 철회를 쓰지 못함(REQ-209, 4절 A26). 잠정, 5-2 질문 6';
COMMENT ON COLUMN portfolio_items.id IS '포트폴리오 항목 ID';
COMMENT ON COLUMN portfolio_items.shop_id IS '가게';
COMMENT ON COLUMN portfolio_items.photo_consent_id IS '근거가 되는 게시 동의. 그 사진의 동의이고 동의함·철회 안 함이어야 올림(REQ-209)';
COMMENT ON COLUMN portfolio_items.review_photo_id IS '올린 후기 사진';
COMMENT ON COLUMN portfolio_items.completion_photo_id IS '올린 완성 사진(완성 사진 안내에서 받은 동의, REQ-207)';
COMMENT ON COLUMN portfolio_items.published_at IS '올린 시각';
COMMENT ON COLUMN portfolio_items.unpublished_at IS '내린 시각. 예약 링크 페이지에서 5분 안에 사라짐(SPEC-063)';
COMMENT ON COLUMN portfolio_items.unpublish_reason IS '동의 철회·사장님이 내림';
COMMENT ON COLUMN portfolio_items.consent_live IS '올라 있는 동안 참, 내리면 비움. 근거 동의의 게시 가능을 참조해 동의하고 철회하지 않은 사진만 올라 있게 함(REQ-209, 5절 E22)';
COMMENT ON COLUMN owner_tasks.id IS '할 일 ID';
COMMENT ON COLUMN owner_tasks.shop_id IS '가게';
COMMENT ON COLUMN owner_tasks.kind IS '에스컬레이션 건·맞춤 주문·변경 요청·문제 신고·결제 확인 요청·맞추는 중·결제 기한 지남·환불 결정·취소 뒤 들어온 입금·장부 다시 연결·영업 신고 보류·영업 캘린더 기준을 넘는 날·환불 보내기(REQ-173)·들어온 입금 대조(REQ-167)';
COMMENT ON COLUMN owner_tasks.event_key IS '할 일을 만든 이벤트 키. 할 일마다 한 번(G2). 형식 task:{만든 이벤트}:{대상 ID}(4절 A33)';
COMMENT ON COLUMN owner_tasks.order_id IS '관련 주문';
COMMENT ON COLUMN owner_tasks.handoff_id IS '에스컬레이션 건';
COMMENT ON COLUMN owner_tasks.change_request_id IS '변경 요청';
COMMENT ON COLUMN owner_tasks.issue_report_id IS '문제 신고';
COMMENT ON COLUMN owner_tasks.payment_request_id IS '결제 안내';
COMMENT ON COLUMN owner_tasks.refund_id IS '보낼 환불(환불 보내기, REQ-173)';
COMMENT ON COLUMN owner_tasks.wait_status IS '사장님 답 기다림(1-7): 기다림·지연(지연 안내와 다시 알림 뒤 할 일 목록에 남음)·답함·답 없어 닫힘. 에스컬레이션 건·맞춤 주문·변경 요청·문제 신고·결제 확인 요청·맞추는 중·환불 결정만(REQ-215)';
COMMENT ON COLUMN owner_tasks.wait_due_at IS '지연 안내를 보낼 시각: 기다리는 시간을 답하는 시간 안에서만 셈(REQ-118). 답 없어 닫는 때(1-7)와 다름';
COMMENT ON COLUMN owner_tasks.late_notice_at IS '손님에게 지연 안내(TERM-036)를 낸 시각(한 번, REQ-116, REQ-156, REQ-215)';
COMMENT ON COLUMN owner_tasks.realerted_at IS '사장님께 다시 알린 시각(한 번): 지연 뒤(REQ-117, REQ-215), 환불 보내기는 환불을 정하고 24시간 뒤(REQ-173)';
COMMENT ON COLUMN owner_tasks.detail IS '보일 글감(보류 이유, 기준을 넘는 날과 주문 수 등). 손님 연락처·계좌·알레르기 없음. 주문이 끝나고 30일 뒤 비움(SPEC-065)';
COMMENT ON COLUMN owner_tasks.opened_at IS '생긴 시각';
COMMENT ON COLUMN owner_tasks.closed_at IS '사장님이 처리해 닫히거나 답 없어 닫힌 시각(SPEC-067, 1-7)';
COMMENT ON COLUMN owner_alerts.id IS '사장님 알림 ID';
COMMENT ON COLUMN owner_alerts.shop_id IS '가게';
COMMENT ON COLUMN owner_alerts.owner_task_id IS '알린 할 일. 상담을 지울 때 그 상담의 에스컬레이션 할 일은 지우고 이 연결만 비움(SPEC-065, 설계 재검토 H3)';
COMMENT ON COLUMN owner_alerts.kind IS '새 할 일·지연 뒤 다시 알림·새 질문 덧붙음·먹고 아프다는 신고·장부 적기 실패·영업 신고 보류·주문 취소됨(SPEC-050)·변경 반영 안 됨(SPEC-044)·결제 받을 계좌 바뀜(할 일 없이 알림만, 계좌번호 없음, SPEC-067, REQ-198)·사업자 정보 변경 반영됨·보류됨(할 일 없이 알림만, SPEC-078, REQ-245)';
COMMENT ON COLUMN owner_alerts.event_key IS '알림마다 한 번(SPEC-067). 형식 alert:{알린 일}:{할 일 ID나 대상 ID}, 하루 한 번까지인 다시 알림은 뒤에 :{가게 날짜}(4절 A33)';
COMMENT ON COLUMN owner_alerts.status IS '보낼 것·발송 결과 확인 중·보냄(닿음 확인)·우리 채널 친구가 아님·실패(할 일 목록에만)·다른 알림에 묶임';
COMMENT ON COLUMN owner_alerts.batched_into_id IS '1분 안 같은 종류는 하나로 묶어 보냄(SPEC-067)';
COMMENT ON COLUMN owner_alerts.attempts IS '보낸 횟수(처음과 1분·5분·30분 뒤, G4)';
COMMENT ON COLUMN owner_alerts.next_attempt_at IS '다음에 보낼 시각';
COMMENT ON COLUMN owner_alerts.sent_at IS '보낸 시각';
COMMENT ON COLUMN owner_alerts.kakao_task_id IS '카카오가 받은 Event API 요청의 taskId. 발송 결과 조회에 씀(SPEC-067, REQ-182)';
COMMENT ON COLUMN owner_alerts.requested_at IS '카카오가 Event API 요청을 받은 시각';
COMMENT ON COLUMN owner_alerts.delivery_checked_at IS '발송 결과를 마지막으로 조회한 시각(1분·5분·30분 뒤)';
COMMENT ON COLUMN owner_alerts.fail_code IS '카카오가 받지 않거나 전하지 못한 사유. unknown은 30분 뒤에도 결과를 모름(SPEC-067)';
COMMENT ON COLUMN owner_alerts.created_at IS '만든 시각';
COMMENT ON COLUMN notifications.id IS '알림 ID';
COMMENT ON COLUMN notifications.shop_id IS '가게';
COMMENT ON COLUMN notifications.customer_id IS '받을 손님';
COMMENT ON COLUMN notifications.consultation_id IS '그 손님의 상담. 상담이 문의 끊김이어도 이 안내는 보내고, 못 보내면 다음 대화 때(새 상담이면 고지 뒤) 먼저 전함(REQ-122, REQ-212)';
COMMENT ON COLUMN notifications.order_id IS '관련 주문';
COMMENT ON COLUMN notifications.kind IS '사장님 답·지연 안내(TERM-036)·채널 추가 권함·맞춤 거절·결제 안내·금액 불일치·확정 안내·취소·변경 결과(반영·거절)·변경 안 됨·환불·보상·전날 안내·완성 사진·후기 부탁·환불 보냄(REQ-172)·결제 확인 정정(REQ-169)·답 없어 닫힘(맞춤 주문 요청·변경 요청·에스컬레이션 건, REQ-213, REQ-214, REQ-216)';
COMMENT ON COLUMN notifications.event_key IS '같은 주문의 같은 이벤트는 한 번(REQ-154). 형식 notice:{대상 ID}:{안내 종류}(4절 A33)';
COMMENT ON COLUMN notifications.template_key IS '서버의 정해진 템플릿. AI가 쓰지 않고 광고를 넣지 않음(REQ-111)';
COMMENT ON COLUMN notifications.body IS '보낼 글. 다른 손님 정보·내부 ID 없음(G6). 결제 안내의 가게 계좌번호는 넣지 않고 자리만 두어 안내를 보일 때 채움(SPEC-032, REQ-191). 주문이 끝나고 30일 뒤나 상담을 지울 때 행째 지움(SPEC-065)';
COMMENT ON COLUMN notifications.status IS '보낼 것·다시 보낼 것·발송 결과 확인 중·보냄(닿음 확인)·못 보냄(다음 대화 때 먼저)·다음 대화 때 전함·무의미해져 안 보냄';
COMMENT ON COLUMN notifications.scheduled_for IS '정해진 시각 안내(전날·후기)의 보낼 시각. 가게 시간 08:00~20:50 안(REQ-123)';
COMMENT ON COLUMN notifications.attempts IS '보낸 횟수(처음과 1분·5분·30분 뒤, G4)';
COMMENT ON COLUMN notifications.next_attempt_at IS '다음에 보낼 시각';
COMMENT ON COLUMN notifications.sent_at IS '보낸(전한) 시각';
COMMENT ON COLUMN notifications.kakao_task_id IS '카카오가 받은 Event API 요청의 taskId. 발송 결과 조회에 씀(SPEC-066, REQ-182)';
COMMENT ON COLUMN notifications.requested_at IS '카카오가 Event API 요청을 받은 시각';
COMMENT ON COLUMN notifications.delivery_checked_at IS '발송 결과를 마지막으로 조회한 시각(1분·5분·30분 뒤)';
COMMENT ON COLUMN notifications.fail_code IS '카카오가 받지 않거나 전하지 못한 사유. unknown은 30분 뒤에도 결과를 모름(SPEC-066)';
COMMENT ON COLUMN notifications.created_at IS '만든 시각';
COMMENT ON COLUMN ledger_links.id IS '장부 연결 ID';
COMMENT ON COLUMN ledger_links.shop_id IS '가게';
COMMENT ON COLUMN ledger_links.provider IS '장부 종류(첫 버전은 구글 시트)';
COMMENT ON COLUMN ledger_links.spreadsheet_id IS '고른 시트 파일';
COMMENT ON COLUMN ledger_links.sheet_name IS '고른 시트 탭';
COMMENT ON COLUMN ledger_links.our_columns IS '우리가 쓰는 열의 헤더와 자리. 같은 이름의 사장님 열이 있으면 오른쪽 빈 열(SPEC-009)';
COMMENT ON COLUMN ledger_links.credential_ref IS '구글 OAuth 토큰이 있는 시크릿 저장소의 이름. 토큰 자체는 두지 않음(REQ-135)';
COMMENT ON COLUMN ledger_links.status IS '연결됨·권한 해제됨·사장님이 끊음';
COMMENT ON COLUMN ledger_links.failure_alerted_at IS '24시간 실패·권한 해제됨을 사장님께 알린 시각(한 번, REQ-159)';
COMMENT ON COLUMN ledger_links.linked_at IS '연결한 시각';
COMMENT ON COLUMN ledger_links.unlinked_at IS '끊은 시각';
COMMENT ON COLUMN ledger_rows.id IS '장부 행 ID';
COMMENT ON COLUMN ledger_rows.shop_id IS '가게';
COMMENT ON COLUMN ledger_rows.order_id IS '주문. 재제작 주문의 행은 두지 않고 그 이벤트를 원래 주문 행에 적음(트리거 ledger_rows_remake, R21, SPEC-064)';
COMMENT ON COLUMN ledger_rows.first_written_at IS '처음 적은 시각';
COMMENT ON COLUMN ledger_rows.last_written_at IS '마지막으로 고친 시각';
COMMENT ON COLUMN ledger_writes.id IS '장부 쓰기 ID';
COMMENT ON COLUMN ledger_writes.shop_id IS '가게';
COMMENT ON COLUMN ledger_writes.ledger_row_id IS '장부 행';
COMMENT ON COLUMN ledger_writes.event_key IS '이벤트마다 한 번(REQ-132). 형식 ledger:{대상 ID}:{이벤트 종류}, 재제작은 ledger:{대상 ID}:remake:{재제작 주문의 일}. 대상은 그 일을 만든 기록(주문 확정은 주문을 확정한 결제, 변경은 변경 요청, 환불은 환불, 4절 A33)';
COMMENT ON COLUMN ledger_writes.event_kind IS '확정·변경·취소·환불·인도·미수령·재제작(원래 주문 행에 재제작 주문의 만듦·변경·인도·미수령·취소, SPEC-060)·환불 보냄(REQ-172)·결제 확인 취소(REQ-169)';
COMMENT ON COLUMN ledger_writes.status IS '기다림·다시 적기·적힘·사장님께 알림·연결 끊김(1-8)';
COMMENT ON COLUMN ledger_writes.attempts IS '적기를 해 본 횟수';
COMMENT ON COLUMN ledger_writes.next_attempt_at IS '다음 시도(1분·5분·30분·2시간·6시간, 그 뒤 하루 한 번)';
COMMENT ON COLUMN ledger_writes.first_failed_at IS '처음 실패한 시각(24시간 실패 셈, R3)';
COMMENT ON COLUMN ledger_writes.last_error_kind IS '마지막 실패 종류(내용·시크릿 없음)';
COMMENT ON COLUMN ledger_writes.written_at IS '적힌 시각. 적을 때는 그 주문의 지금 값으로(옛 값이 새 값을 덮지 않음)';
COMMENT ON COLUMN ledger_writes.created_at IS '남긴 시각';
COMMENT ON COLUMN ai_calls.id IS 'AI 호출 ID';
COMMENT ON COLUMN ai_calls.shop_id IS '가게';
COMMENT ON COLUMN ai_calls.consultation_id IS '대화 ID. 상담마다 비용 합(REQ-150)';
COMMENT ON COLUMN ai_calls.trace_id IS '요청 추적 ID: 손님 메시지 한 차례의 그래프 실행(AI-1)';
COMMENT ON COLUMN ai_calls.attempt IS '차례 안 호출 순번(1부터, 위 끝 없음). 차례마다 호출 상한(8번)은 AI-1이 호출 전에 막음';
COMMENT ON COLUMN ai_calls.call_kind IS '다시 한 종류: 처음·도구 뒤 이어 하기·다시 하기(시간 초과·429·5xx)·다시 쓰기(서버 확인을 지나지 못한 답·빈 답). 처음은 순번 1에만';
COMMENT ON COLUMN ai_calls.provider IS '모델 회사(고르는 날 정함, AI-1)';
COMMENT ON COLUMN ai_calls.model IS '모델';
COMMENT ON COLUMN ai_calls.prompt_version IS '프롬프트 버전';
COMMENT ON COLUMN ai_calls.reasoning IS '추론 설정(effort·thinking 등)';
COMMENT ON COLUMN ai_calls.sent_at IS '보낸 시각';
COMMENT ON COLUMN ai_calls.first_token_ms IS '보낸 뒤 첫 토큰까지(밀리초)';
COMMENT ON COLUMN ai_calls.total_ms IS '끝까지(밀리초)';
COMMENT ON COLUMN ai_calls.input_tokens IS '입력 토큰';
COMMENT ON COLUMN ai_calls.output_tokens IS '출력 토큰';
COMMENT ON COLUMN ai_calls.cache_read_tokens IS '캐시에서 읽은 토큰';
COMMENT ON COLUMN ai_calls.cache_write_tokens IS '캐시에 쓴 토큰';
COMMENT ON COLUMN ai_calls.cost_usd IS '비용(달러, 모델 회사 요금표)';
COMMENT ON COLUMN ai_calls.cost_krw IS '비용(원). 가게 하루 AI 비용 한도의 셈(REQ-163)';
COMMENT ON COLUMN ai_calls.cost_basis IS '요금표 버전과 환율 기준';
COMMENT ON COLUMN ai_calls.result IS '결과: 성공·실패·시간 초과·한도(가게 하루 한도나 모델 사용 한도)';
COMMENT ON COLUMN ai_calls.stop_reason IS '모델 회사가 준 멈춘 사유';
COMMENT ON COLUMN ai_calls.error_kind IS '실패 종류(내용 없이)';
COMMENT ON COLUMN ai_calls.fallback_reason IS '정해진 문장이나 에스컬레이션을 쓴 이유(AI-1의 서버 확인·실패·차례마다 호출 상한)';
COMMENT ON COLUMN ai_calls.created_at IS '남긴 시각';
COMMENT ON COLUMN ai_tool_calls.id IS '도구 호출 ID';
COMMENT ON COLUMN ai_tool_calls.shop_id IS '가게';
COMMENT ON COLUMN ai_tool_calls.ai_call_id IS '도구를 호출한 AI 호출';
COMMENT ON COLUMN ai_tool_calls.consultation_id IS '대화 ID';
COMMENT ON COLUMN ai_tool_calls.tool_name IS '읽기 도구만: 견적 계산·날짜 판정·조문 읽기·내 주문 읽기(AI-1)';
COMMENT ON COLUMN ai_tool_calls.target_id IS '대상 ID(초안·조문·주문)';
COMMENT ON COLUMN ai_tool_calls.args_masked IS '개인정보를 마스킹한 인자';
COMMENT ON COLUMN ai_tool_calls.result IS '됨·오류·거절(다른 사용자·다른 가게)';
COMMENT ON COLUMN ai_tool_calls.duration_ms IS '걸린 시간(밀리초)';
COMMENT ON COLUMN ai_tool_calls.called_at IS '호출한 시각';
COMMENT ON COLUMN request_keys.actor_kind IS '누른 쪽: 사장님·운영자';
COMMENT ON COLUMN request_keys.actor_id IS '그 사람의 ID(owners.id나 operators.id)';
COMMENT ON COLUMN request_keys.request_key IS '화면이 만든 요청 키(G2)';
COMMENT ON COLUMN request_keys.command IS '명령 이름';
COMMENT ON COLUMN request_keys.request_hash IS '요청 지문: 명령·경로의 ID·본문을 정한 차례로 이어 시크릿 저장소의 키로 만든 HMAC-SHA256(16진수 64자). 같은 키에 지문이 다르면 422 idempotency_key_reused(06 DEC-04). 본문의 값은 지문으로만 남음';
COMMENT ON COLUMN request_keys.state IS '처리 중·끝남. 처리 중에 같은 키가 오면 409 request_in_progress(06 DEC-04)';
COMMENT ON COLUMN request_keys.processing_expires_at IS '처리 중의 기한(받은 시각 + 60초). 끝나지 않고 지나면(서버가 멈춤) 같은 키·같은 지문의 다음 요청이 이 행을 이어받아 처음부터 처리함(5절 E27)';
COMMENT ON COLUMN request_keys.response_status IS '끝남: 처음 결과의 HTTP 상태 코드. 같은 키가 다시 오면 같은 코드로 돌려줌. 입력 검사 실패(422)·서버 오류(5xx)는 남기지 않고 처리 중 행을 지워 다시 보낼 수 있게 함(06 DEC-04)';
COMMENT ON COLUMN request_keys.response_code IS '끝남: 처음 결과의 종류(G7의 결과나 오류 코드)';
COMMENT ON COLUMN request_keys.response_ref IS '처음 결과가 가리킨 기록의 ID(예: 결제 안내·주문). 같은 키가 다시 오면 그 기록의 지금 상태를 다시 읽어 본문을 만듦(06 DEC-04). ID만 두고 개인정보·시크릿은 두지 않음';
COMMENT ON COLUMN request_keys.created_at IS '처음 받은 시각. 24시간이 지나면 지우기(SPEC-065)가 지움(06 DEC-04)';
COMMENT ON COLUMN request_keys.done_at IS '끝난 시각';
COMMENT ON COLUMN ops_events.id IS '운영 기록 ID';
COMMENT ON COLUMN ops_events.shop_id IS '가게. 가게와 무관하면 빈 값';
COMMENT ON COLUMN ops_events.kind IS '지난 기록 지우기·다 찬 날이라 남기지 않은 주문 요청(R11)·5분에 5번 AI 실패(운영자 알림)·손님 메시지 한도·이미 다른 가게에 묶인 채널(운영자 알림, SPEC-008)·처리방침 국외 이전 항목 빔(운영자 알림, SPEC-010)';
COMMENT ON COLUMN ops_events.count IS '건수';
COMMENT ON COLUMN ops_events.detail IS '종류별 건수 같은 숫자만(내용·개인정보·시크릿 없음)';
COMMENT ON COLUMN ops_events.created_at IS '남긴 시각';
COMMENT ON COLUMN kept_records.id IS '보관 기록 ID';
COMMENT ON COLUMN kept_records.shop_id IS '가게';
COMMENT ON COLUMN kept_records.order_id IS '보관 기록이 된 주문. 주문 내용 버전·결제·환불·문제 신고 행은 그 주문에 그대로 남음';
COMMENT ON COLUMN kept_records.customer_name IS '주문자 이름: 계약 기록에서 손님을 알아볼 정보로 주문 내용에서 옮겨 둠(REQ-185). 주문자 정보가 없는 재제작 주문은 빈 값(원래 주문의 보관 기록에 있음)';
COMMENT ON COLUMN kept_records.finished_at IS '주문이 끝난 시각(보관 기간의 셈)';
COMMENT ON COLUMN kept_records.contract_keep_until IS '계약·결제 기록을 둘 때까지: 끝난 날부터 5년(REQ-187, 잠정). 지나면 이 행을 지움(REQ-188)';
COMMENT ON COLUMN kept_records.issue_keep_until IS '문제 신고 기록을 둘 때까지: 끝난 날부터 3년(REQ-187, 잠정). 그 주문에 신고가 없으면 빈 값';
COMMENT ON COLUMN kept_records.issue_purged_at IS '문제 신고의 설명·사진을 지운 시각(REQ-188)';
COMMENT ON COLUMN kept_records.created_at IS '보관 기록으로 나눈 시각(끝나고 30일 뒤)';
COMMENT ON COLUMN access_logs.id IS '접속기록 ID';
COMMENT ON COLUMN access_logs.shop_id IS '어느 가게의 손님 기록인지';
COMMENT ON COLUMN access_logs.actor_kind IS '접속한 사람: 사장님·운영자. 손님(정보주체)·카카오 스킬·서버 작업은 남기지 않음(SPEC-074)';
COMMENT ON COLUMN access_logs.owner_id IS '접속한 사장님';
COMMENT ON COLUMN access_logs.operator_id IS '접속한 운영자';
COMMENT ON COLUMN access_logs.action IS '수행업무: 읽음·바꿈·원래 값 열기·보관 기록 열기(SPEC-073, SPEC-074)';
COMMENT ON COLUMN access_logs.api_id IS '부른 06단계 API 번호';
COMMENT ON COLUMN access_logs.request_path IS '요청 경로. ID만 담기고 쿼리 문자열은 넣지 않음(SPEC-074)';
COMMENT ON COLUMN access_logs.subject_ids IS '처리한 정보주체: 손님 ID 목록(값 없이 ID만). 손님 행은 지우지 않아 2년 동안 가리킬 수 있음';
COMMENT ON COLUMN access_logs.target_kind IS '연 대상: 대화 속 원래 값·주문자 이름과 연락처·환불 계좌·보관 기록·상담의 대화 글(SPEC-073, REQ-227)';
COMMENT ON COLUMN access_logs.target_id IS '연 대상의 ID(상담의 대화 글은 상담 ID). 대상 행이 지워져도 이 기록은 2년 남으므로 외래 키를 두지 않음';
COMMENT ON COLUMN access_logs.reason IS '운영자가 적은 사유(원래 값·보관 기록 열기, REQ-195)';
COMMENT ON COLUMN access_logs.client_ip IS '접속지: 요청한 IP';
COMMENT ON COLUMN access_logs.accessed_at IS '접속 일시. 2년이 지나면 지우기가 지움(SPEC-065, REQ-196)';
COMMENT ON COLUMN file_deletions.id IS '지울 파일 ID';
COMMENT ON COLUMN file_deletions.shop_id IS '어느 가게의 사진 파일인지';
COMMENT ON COLUMN file_deletions.storage_key IS '저장소에서 지울 사진 파일의 저장 위치(지운 참고 사진·신고 사진 행의 storage_key). 사진의 내용·손님 정보는 두지 않음';
COMMENT ON COLUMN file_deletions.source IS '지운 행: 참고 사진·신고 사진(SPEC-065)';
COMMENT ON COLUMN file_deletions.queued_at IS '사진 행을 지운 트랜잭션의 시각. 그 트랜잭션에서 이 행을 넣음(5절 E24)';
COMMENT ON COLUMN file_deletions.attempts IS '저장소에서 지우려다 실패한 횟수. 지우면 이 행을 지움';
COMMENT ON COLUMN file_deletions.last_tried_at IS '마지막으로 지우려다 실패한 시각. 다음 날 지우기가 다시 지움';
COMMENT ON COLUMN handoff_questions.id IS '덧붙은 질문 ID';
COMMENT ON COLUMN handoff_questions.shop_id IS '가게';
COMMENT ON COLUMN handoff_questions.handoff_id IS '덧붙은 열린 에스컬레이션 건(마감된 날 질문 건은 아님)';
COMMENT ON COLUMN handoff_questions.message_id IS '덧붙은 손님 말: 그 건과 같은 상담의 메시지(앱이 지킴, 4절 A34). 같은 메시지는 한 번만';
COMMENT ON COLUMN handoff_questions.reason IS '덧붙은 사유(에스컬레이션 건의 사유와 같은 값). 마감된 날 질문은 덧붙이지 않고 날짜마다 따로 건을 둠(SPEC-014)';
COMMENT ON COLUMN handoff_questions.order_id IS '관련 주문(있으면)';
COMMENT ON COLUMN handoff_questions.created_at IS '덧붙은 시각. 상담을 지울 때 함께 지움(SPEC-065)';
COMMENT ON COLUMN order_draft_extras.shop_id IS '가게';
COMMENT ON COLUMN order_draft_extras.draft_id IS '주문서 초안';
COMMENT ON COLUMN order_draft_extras.price_list_id IS '초안의 가격표 버전. 초안과 같음(order_draft_extras_draft_fk)';
COMMENT ON COLUMN order_draft_extras.option_id IS '더한 옵션: 같은 가격표 버전의 ''더하는 옵션''만(order_draft_extras_option_fk)';
COMMENT ON COLUMN order_draft_extras.option_group IS '늘 ''더하는 옵션''. 옵션의 무리를 외래 키로 맞추려고 둔 값';
COMMENT ON COLUMN order_detail_extras.shop_id IS '가게';
COMMENT ON COLUMN order_detail_extras.order_detail_id IS '주문 내용 버전';
COMMENT ON COLUMN order_detail_extras.price_list_id IS '그 버전의 가격표 버전. 주문 내용과 같음(order_detail_extras_detail_fk)';
COMMENT ON COLUMN order_detail_extras.option_id IS '더한 옵션: 같은 가격표 버전의 ''더하는 옵션''만(order_detail_extras_option_fk). 이전 버전의 행도 지우지 않음(REQ-027)';
COMMENT ON COLUMN order_detail_extras.option_group IS '늘 ''더하는 옵션''. 옵션의 무리를 외래 키로 맞추려고 둔 값';
COMMENT ON COLUMN shop_identity_changes.id IS '변경 요청 ID';
COMMENT ON COLUMN shop_identity_changes.shop_id IS '바꿀 가게';
COMMENT ON COLUMN shop_identity_changes.business_name IS '새 상호(바꾸지 않으면 요청할 때의 값)';
COMMENT ON COLUMN shop_identity_changes.representative_name IS '새 대표자 성명(바꾸지 않으면 요청할 때의 값)';
COMMENT ON COLUMN shop_identity_changes.business_reg_no IS '새 사업자등록번호(검증 숫자는 앱이 봄)';
COMMENT ON COLUMN shop_identity_changes.prev_business_name IS '요청할 때 확인된 상호. 반영한 뒤에도 무엇을 바꿨는지 남음';
COMMENT ON COLUMN shop_identity_changes.prev_representative_name IS '요청할 때 확인된 대표자 성명';
COMMENT ON COLUMN shop_identity_changes.prev_business_reg_no IS '요청할 때 확인된 사업자등록번호';
COMMENT ON COLUMN shop_identity_changes.evidence_photo_key IS '증빙 사진(영업 신고증이나 사업자등록증 한 장) 저장 위치. 그 가게 사장님과 운영자만 봄(G1, G6)';
COMMENT ON COLUMN shop_identity_changes.status IS '확인 기다림·반영함·보류(SPEC-078). 반영·보류한 요청은 고치지 않음';
COMMENT ON COLUMN shop_identity_changes.hold_reason IS '보류 이유. 사장님께 한 번 알림(owner_alerts identity_change_on_hold)';
COMMENT ON COLUMN shop_identity_changes.reviewed_by IS '반영·보류한 운영자';
COMMENT ON COLUMN shop_identity_changes.reviewed_at IS '반영·보류한 시각';
COMMENT ON COLUMN shop_identity_changes.requested_at IS '요청한 시각';
-- ▲ 컬럼 설명 끝
