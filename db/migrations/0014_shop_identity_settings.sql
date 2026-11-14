-- 0014_shop_identity_settings: 가게 신원 정보와 사업자 정보 변경 요청(설계 재검토 M11·M14, 2026-11-14,
-- 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)', 검토자의 고치는 방향대로)
-- M11(RA-05): 예약 링크 페이지의 가게 신원 정보를 전자상거래법 제13조① 그대로 보이려고 shops에 사업장 주소(business_address)·
--     전자우편주소(contact_email)·통신판매업 신고를 받은 기관(mail_order_authority)을 더함. 신고번호와 기관은 함께
--     (shops_mail_order_authority_chk, REQ-239). 확정 안내의 가게 신원(REQ-242)도 이 값을 씀.
-- M14(RB-12): 상호·대표자·사업자등록번호는 영업 신고 확인(REQ-197)과 계좌 예금주 규칙(REQ-199)이 기대는 값이라 사장님이 바로 고치지 않고
--     변경 요청(새 테이블 shop_identity_changes, TBL-058)으로 남겨 운영자가 반영해야 바뀜. 가게마다 확인을 기다리는 요청은 하나
--     (shop_identity_changes_one_pending), 반영·보류는 운영자와 시각을 남김. 반영·보류는 사장님께 한 번 알림(owner_alerts의 종류 둘).
--     기다리는 시간·문의 끊김 시간·하루 AI 비용 한도·후기 부탁 시각은 컬럼이 이미 있어 쓰는 때(REQ-243)만 설명에 적음.
-- 0013_ai_calls_skill_keys.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0014_shop_identity_settings.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 옮길 행이 없음. 가게 행이 있으면 사업장 주소와
-- 전자우편주소는 사장님께 받아야 하는 값이라 NOT NULL을 더하는 이 마이그레이션은 실패함: 그때는 그 값을 먼저 받아 넣는 마이그레이션을 앞에 둠.
-- 통신판매업 신고번호가 있는 가게도 신고를 받은 기관을 받아야 shops_mail_order_authority_chk를 지남.

-- TBL-003 shops: 사업장 주소·전자우편주소·통신판매업 신고를 받은 기관
ALTER TABLE shops
  ADD COLUMN contact_email text NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 100 AND contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  ADD COLUMN business_address text NOT NULL CHECK (char_length(business_address) BETWEEN 1 AND 200),
  ADD COLUMN mail_order_authority text CHECK (char_length(mail_order_authority) BETWEEN 1 AND 40),
  ADD CONSTRAINT shops_mail_order_authority_chk CHECK ((mail_order_reg_no IS NULL) = (mail_order_authority IS NULL));

-- TBL-043 owner_alerts: 사업자 정보 변경 반영됨·보류됨(할 일 없이 알림만, SPEC-078)
ALTER TABLE owner_alerts
  DROP CONSTRAINT owner_alerts_kind_check,
  ADD CONSTRAINT owner_alerts_kind_check CHECK (kind IN ('new_task', 'task_realert', 'handoff_appended', 'health_concern', 'ledger_failing', 'license_on_hold', 'order_cancelled', 'change_not_applied', 'payment_account_changed', 'identity_change_applied', 'identity_change_on_hold'));

-- TBL-058 shop_identity_changes: 사업자 정보 변경 요청
CREATE TABLE shop_identity_changes (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                   uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT,
  business_name             text NOT NULL CHECK (char_length(business_name) BETWEEN 1 AND 60),
  representative_name       text NOT NULL CHECK (char_length(representative_name) BETWEEN 1 AND 30),
  business_reg_no           text NOT NULL CHECK (business_reg_no ~ '^[0-9]{10}$'),
  prev_business_name        text NOT NULL CHECK (char_length(prev_business_name) BETWEEN 1 AND 60),
  prev_representative_name  text NOT NULL CHECK (char_length(prev_representative_name) BETWEEN 1 AND 30),
  prev_business_reg_no      text NOT NULL CHECK (prev_business_reg_no ~ '^[0-9]{10}$'),
  evidence_photo_key        text NOT NULL,
  status                    text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'on_hold')),
  hold_reason               text CHECK (char_length(hold_reason) BETWEEN 1 AND 200),
  reviewed_by               uuid REFERENCES operators (id) ON DELETE RESTRICT,
  reviewed_at               timestamptz,
  requested_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_identity_changes_differs_chk CHECK ((business_name, representative_name, business_reg_no) IS DISTINCT FROM (prev_business_name, prev_representative_name, prev_business_reg_no)),
  CONSTRAINT shop_identity_changes_hold_chk CHECK ((status = 'on_hold') = (hold_reason IS NOT NULL)),
  CONSTRAINT shop_identity_changes_reviewed_chk CHECK ((status = 'pending') = (reviewed_by IS NULL) AND (status = 'pending') = (reviewed_at IS NULL))
);
CREATE UNIQUE INDEX shop_identity_changes_one_pending ON shop_identity_changes (shop_id) WHERE status = 'pending';
CREATE INDEX shop_identity_changes_queue_idx ON shop_identity_changes (requested_at) WHERE status = 'pending';
COMMENT ON TABLE shop_identity_changes IS 'TBL-058 사업자 정보 변경 요청: 상호·대표자·사업자등록번호의 새 값과 증빙 사진. 운영자가 반영해야 가게 정보가 바뀜(REQ-245, 설계 재검토 M14)';
COMMENT ON TABLE shops IS 'TBL-003 가게(TERM-053): 가게 신원 정보·영업 신고·처리 위탁 동의·예약 링크와 가게가 정하는 시간 값';

-- 컬럼 설명(schema.sql 끝의 설명과 같음)
COMMENT ON COLUMN shops.contact_phone IS '가게 연락처(전화번호). 예약 링크 페이지의 가게 신원 정보(REQ-239). 사장님이 가게 설정에서 바로 고침(REQ-244)';
COMMENT ON COLUMN shops.contact_email IS '전자우편주소. 예약 링크 페이지의 가게 신원 정보(REQ-239). 사장님이 가게 설정에서 바로 고침(REQ-244)';
COMMENT ON COLUMN shops.business_address IS '사업장 주소. 예약 링크 페이지와 확정 안내의 가게 신원 정보(REQ-239, REQ-242). 픽업 장소와 다를 수 있음. 사장님이 가게 설정에서 바로 고침(REQ-244)';
COMMENT ON COLUMN shops.pickup_address IS '픽업 장소(가게 위치). 전날 안내에 포함함(SPEC-052). 등록 필드(SPEC-002)에 없어 가게 설정에서 받음(SPEC-077)';
COMMENT ON COLUMN shops.business_name IS '상호. 등록 뒤에는 변경 요청을 운영자가 반영해야 바뀜(REQ-245, TBL-058)';
COMMENT ON COLUMN shops.representative_name IS '대표자 성명. 등록 뒤에는 변경 요청을 운영자가 반영해야 바뀜(REQ-245, TBL-058)';
COMMENT ON COLUMN shops.business_reg_no IS '사업자등록번호(검증 숫자는 앱이 봄). 중복돼도 받고 운영자 화면에 중복 표시(SPEC-002). 등록 뒤에는 변경 요청을 운영자가 반영해야 바뀜(REQ-245)';
COMMENT ON COLUMN shops.mail_order_authority IS '통신판매업 신고를 받은 기관(예: 서울특별시 마포구청). 신고번호와 함께 있음(REQ-239)';
COMMENT ON COLUMN shops.idle_close_hours IS '문의 끊김까지 시간(REQ-211, 기본 24시간). 사장님이 바꾸면 저장한 때부터 씀(REQ-243)';
COMMENT ON COLUMN shops.owner_wait_minutes IS '사장님 답 기다리는 시간(REQ-116, 기본 2시간). 바꾸면 그 뒤 시작된 기다림부터(owner_tasks.wait_due_at, REQ-243)';
COMMENT ON COLUMN shops.daily_ai_cost_limit_krw IS '하루 AI 비용 한도(REQ-163, 기본 5,000원). 사장님이 정하고 바꾸면 저장한 때부터 그날 쓴 비용과 견줌(REQ-243)';
COMMENT ON COLUMN business_calendars.review_request_time IS '후기 부탁 시각(SPEC-061, 인도한 다음 날). 바꾸면 아직 보내지 않은 후기 부탁부터 씀(REQ-243)';
COMMENT ON COLUMN owner_alerts.kind IS '새 할 일·지연 뒤 다시 알림·새 질문 덧붙음·먹고 아프다는 신고·장부 적기 실패·영업 신고 보류·주문 취소됨(SPEC-050)·변경 반영 안 됨(SPEC-044)·결제 받을 계좌 바뀜(할 일 없이 알림만, 계좌번호 없음, SPEC-067, REQ-198)·사업자 정보 변경 반영됨·보류됨(할 일 없이 알림만, SPEC-078, REQ-245)';
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
