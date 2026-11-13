-- 0006_account_encryption_access_log: 계좌번호 암호화, 원래 값을 두지 않는 번호, 예금주 확인, 접속기록(설계 재검토 H4, 2026-11-13 20:59 결정 카드 '추천안대로 (추천)')
-- 가게 계좌번호·환불 계좌번호·대화 속 전화번호와 계좌번호의 원래 값은 앱이 AES-256-GCM으로 암호화해 text 봉투(v키버전:base64url)로만 둠(REQ-191, docs/05-erd/README.md 5절 E20).
-- 평문 형식 검사(숫자와 '-', 10~16자리)는 06단계 API로 옮김. 카드번호는 끝 4자리만, 주민등록번호처럼 보이는 숫자와 긴 숫자는 원래 값을 두지 않음(REQ-192).
-- 운영자가 영업 신고를 확인할 때 예금주가 대표자·상호와 같은지 봄(REQ-197). 계좌가 바뀌면 사장님께 알림(REQ-198).
-- 사장님·운영자의 손님 개인정보 접속을 남기는 접속기록은 고치거나 비우지 못하고 2년이 지난 행만 지움(REQ-196, 4절 A24).
-- 0005_retention_split.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0006_account_encryption_access_log.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 계좌·마스킹 원본 값·환불 계좌 행이 없음.
-- 행이 있으면 앱이 평문을 읽어 암호문·끝 4자리·해시를 채운 뒤 옛 컬럼을 지움(데이터베이스에는 키가 없어 이 파일로는 암호화하지 못함).

-- TBL-015 payment_accounts: 평문 계좌번호 대신 암호문과 끝 4자리, 예금주를 확인한 운영자와 시각
ALTER TABLE payment_accounts
  DROP COLUMN account_number,
  ADD COLUMN account_number_enc text NOT NULL CHECK (account_number_enc ~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{39,}$'),
  ADD COLUMN account_last4 text NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  ADD COLUMN holder_checked_by uuid REFERENCES operators (id) ON DELETE RESTRICT,
  ADD COLUMN holder_checked_at timestamptz;
ALTER TABLE payment_accounts
  ADD CONSTRAINT payment_accounts_holder_checked_chk CHECK ((holder_checked_by IS NULL) = (holder_checked_at IS NULL));

-- TBL-019 masked_values: 원래 값은 전화번호·계좌번호만 암호문으로, 같은 값 찾기는 해시로, 카드번호는 끝 4자리만
ALTER TABLE masked_values
  DROP CONSTRAINT masked_values_card_last4_chk,
  DROP CONSTRAINT masked_values_value_uq,
  DROP COLUMN original_value,
  ADD COLUMN original_enc text CHECK (original_enc ~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{39,}$'),
  ADD COLUMN value_hmac text CHECK (value_hmac ~ '^[0-9a-f]{64}$'),
  ADD COLUMN last4 text CHECK (last4 ~ '^[0-9]{4}$');
ALTER TABLE masked_values
  ADD CONSTRAINT masked_values_value_uq UNIQUE (consultation_id, kind, value_hmac),
  ADD CONSTRAINT masked_values_kept_chk CHECK ((kind IN ('phone', 'account')) = (original_enc IS NOT NULL)),
  ADD CONSTRAINT masked_values_hmac_chk CHECK ((original_enc IS NULL) = (value_hmac IS NULL)),
  ADD CONSTRAINT masked_values_last4_chk CHECK ((kind = 'long_number') = (last4 IS NULL));

-- TBL-033 refunds: 환불 계좌번호도 암호문과 끝 4자리
ALTER TABLE refunds
  DROP COLUMN refund_account_number,
  ADD COLUMN refund_account_enc text CHECK (refund_account_enc ~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{39,}$'),
  ADD COLUMN refund_account_last4 text CHECK (refund_account_last4 ~ '^[0-9]{4}$');
ALTER TABLE refunds
  ADD CONSTRAINT refunds_account_pair_chk CHECK ((refund_account_enc IS NULL) = (refund_account_last4 IS NULL));

-- TBL-043 owner_alerts: 결제 받을 계좌가 바뀌었다는 알림
ALTER TABLE owner_alerts
  DROP CONSTRAINT owner_alerts_kind_check,
  ADD CONSTRAINT owner_alerts_kind_check CHECK (kind IN ('new_task', 'task_realert', 'handoff_appended', 'health_concern', 'ledger_failing', 'license_on_hold', 'order_cancelled', 'change_not_applied', 'payment_account_changed'));

-- TBL-053 access_logs: 접속기록(새 테이블)과 고치지 못하게 막는 트리거
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
  target_kind   text CHECK (target_kind IN ('masked_value', 'order_contact', 'refund_account', 'kept_record')), -- 연 대상: 대화 속 원래 값·주문자 이름과 연락처·환불 계좌·보관 기록(SPEC-073)
  target_id     uuid,                                     -- 연 대상의 ID. 대상 행이 지워져도 이 기록은 2년 남으므로 외래 키를 두지 않음
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

-- 테이블·컬럼 설명(db/schema.sql과 같은 줄)
COMMENT ON TABLE payment_accounts IS 'TBL-015 결제 수단: 가게 명의 계좌(암호화)와 카드 결제 링크. 우리 회사 계좌는 어디에도 없음(REQ-079)';
COMMENT ON TABLE masked_values IS 'TBL-019 마스킹 원본 값: 플레이스홀더와 암호화한 원래 값(전화번호·계좌번호)과 끝 4자리, 그 가게 사장님 화면과 사유를 적고 연 운영자에게만';
COMMENT ON TABLE access_logs IS 'TBL-053 접속기록: 사장님·운영자가 손님 개인정보를 읽거나 바꾸거나 연 요청마다 한 행. 고치지 않고 2년 보관(REQ-196, 「개인정보의 안전성 확보조치 기준」 제8조①③)';
COMMENT ON COLUMN shops.license_status IS '영업 신고: 확인 기다림·보류·확인됨(SPEC-003). 확인됨은 결제 계좌가 있고 그 예금주가 대표자·상호와 같은지 운영자가 본 뒤(REQ-197, 4절 A25)';
COMMENT ON COLUMN payment_accounts.account_number_enc IS '가게 명의 계좌번호를 앱이 암호화한 값(키 버전:nonce·암호문·태그의 base64url, 5절 E20). 평문은 두지 않음(REQ-191). 숫자와 ''-'' 10~16자리 확인은 06단계 API가 함. 사장님 화면과 그 가게 손님의 결제 안내를 보일 때만 복호화하고, AI로는 마스킹함(SPEC-006)';
COMMENT ON COLUMN payment_accounts.account_last4 IS '계좌번호 끝 4자리. 운영자 화면은 이것만 보임(SPEC-003, SPEC-073)';
COMMENT ON COLUMN payment_accounts.holder_checked_by IS '영업 신고를 확인하며 예금주가 대표자·상호와 같은지 본 운영자(REQ-197, SPEC-003)';
COMMENT ON COLUMN payment_accounts.holder_checked_at IS '예금주를 확인한 시각. 확인된 가게가 계좌를 바꾸면 새 예금주는 확인된 대표자·상호나 이 확인을 거친 예금주와 같아야 함(REQ-199, 4절 A25)';
COMMENT ON COLUMN masked_values.kind IS '전화번호·계좌번호·카드번호·8자리 넘는 긴 숫자(주민등록번호처럼 보이는 숫자 포함). 나누는 규칙은 SPEC-021';
COMMENT ON COLUMN masked_values.original_enc IS '원래 값을 앱이 암호화한 값(5절 E20). 전화번호·계좌번호만 둠(REQ-191). 그 가게 사장님 화면과 사유를 적고 연 운영자에게만(REQ-193, SPEC-073)';
COMMENT ON COLUMN masked_values.value_hmac IS '같은 값 찾기: 원래 값 대신 비밀 키로 만든 HMAC-SHA256(5절 E20). 전화번호·계좌번호만';
COMMENT ON COLUMN masked_values.last4 IS '끝 4자리(운영자 화면의 가린 값, SPEC-073). 카드번호는 이것만 둠. 긴 숫자는 두지 않음(REQ-192)';
COMMENT ON COLUMN refunds.refund_account_enc IS '환불받을 손님 계좌번호를 앱이 암호화한 값(5절 E20, REQ-191). 숫자와 ''-'' 형식은 06단계 API가 봄. 그 가게 사장님 화면의 이 환불과 사유를 적고 연 운영자에게만, AI·로그 0번(R19, REQ-193). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN refunds.refund_account_last4 IS '환불받을 계좌번호 끝 4자리(운영자 화면의 가린 값, SPEC-073). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN owner_alerts.kind IS '새 할 일·지연 뒤 다시 알림·새 질문 덧붙음·먹고 아프다는 신고·장부 적기 실패·영업 신고 보류·주문 취소됨(SPEC-050)·변경 반영 안 됨(SPEC-044)·결제 받을 계좌 바뀜(할 일 없이 알림만, 계좌번호 없음, SPEC-067, REQ-198)';
COMMENT ON COLUMN notifications.body IS '보낼 글. 다른 손님 정보·내부 ID 없음(G6). 결제 안내의 가게 계좌번호는 넣지 않고 자리만 두어 안내를 보일 때 채움(SPEC-032, REQ-191). 주문이 끝나고 30일 뒤나 상담을 지울 때 행째 지움(SPEC-065)';
COMMENT ON COLUMN access_logs.id IS '접속기록 ID';
COMMENT ON COLUMN access_logs.shop_id IS '어느 가게의 손님 기록인지';
COMMENT ON COLUMN access_logs.actor_kind IS '접속한 사람: 사장님·운영자. 손님(정보주체)·카카오 스킬·서버 작업은 남기지 않음(SPEC-074)';
COMMENT ON COLUMN access_logs.owner_id IS '접속한 사장님';
COMMENT ON COLUMN access_logs.operator_id IS '접속한 운영자';
COMMENT ON COLUMN access_logs.action IS '수행업무: 읽음·바꿈·원래 값 열기·보관 기록 열기(SPEC-073, SPEC-074)';
COMMENT ON COLUMN access_logs.api_id IS '부른 06단계 API 번호';
COMMENT ON COLUMN access_logs.request_path IS '요청 경로. ID만 담기고 쿼리 문자열은 넣지 않음(SPEC-074)';
COMMENT ON COLUMN access_logs.subject_ids IS '처리한 정보주체: 손님 ID 목록(값 없이 ID만). 손님 행은 지우지 않아 2년 동안 가리킬 수 있음';
COMMENT ON COLUMN access_logs.target_kind IS '연 대상: 대화 속 원래 값·주문자 이름과 연락처·환불 계좌·보관 기록(SPEC-073)';
COMMENT ON COLUMN access_logs.target_id IS '연 대상의 ID. 대상 행이 지워져도 이 기록은 2년 남으므로 외래 키를 두지 않음';
COMMENT ON COLUMN access_logs.reason IS '운영자가 적은 사유(원래 값·보관 기록 열기, REQ-195)';
COMMENT ON COLUMN access_logs.client_ip IS '접속지: 요청한 IP';
COMMENT ON COLUMN access_logs.accessed_at IS '접속 일시. 2년이 지나면 지우기가 지움(SPEC-065, REQ-196)';
