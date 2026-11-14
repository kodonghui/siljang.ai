-- 0015_issue_kind_reporter: 문제 종류와 보상 없음의 사유, 그 밖의 보상, 에스컬레이션 건에서 사장님이 남긴 문제 신고(설계 재검토 M12, 2026-11-14,
-- 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'. RA-13은 검토자의 고치는 방향대로, RB-15는 Claude 추천이라 동희님 확인 요청)
-- RA-13: issue_reports에 문제 종류(problem_kind, 사장님이 보상을 정할 때 고름, REQ-247), 상함·변질·이물에 보상 없음을 고른 사유
--     (no_compensation_reason, 소비자분쟁해결기준을 보인 뒤, REQ-248), 그 밖의 보상(compensation 'other_compensation'과 사장님이 한 일·금액,
--     환불·장부 행 없음, REQ-249)을 더함. 사유와 한 일은 주문이 끝난 날부터 3년 뒤 신고 설명과 함께 비움(notes_purged_at, SPEC-065).
-- RB-15: 주문자가 아닌 카카오 사용자의 말(예: 선물로 받음)은 에스컬레이션 건(사유 다른 사용자)이 되고, 사장님이 그 건에서 받은 주문의
--     문제 신고로 남길 수 있음(SPEC-079). 그 신고에는 신고 카드가 없고(card_id의 NOT NULL을 풀고 issue_reports_reporter_chk) 에스컬레이션 건이
--     있음. 그 건의 관련 주문이 신고의 주문과 같은지는 (shop_id, handoff_id, order_id) 외래 키로 봄(대상은 handoffs_order_scope). 건 하나에 신고 하나(issue_reports_handoff_uq).
--     외래 키는 다른 테이블처럼 RESTRICT이고, 상담을 지울 때 그 건을 지우기 전에 신고의 연결을 비움(지우기 2단계, docs/05-erd/README.md 5절 E32).
-- 0014_shop_identity_settings.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0015_issue_kind_reporter.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 옮길 행이 없음. 보상을 정한 신고 행이 있으면
-- 문제 종류가 없어 issue_reports_problem_kind_chk에서 실패함: 그때는 사장님께 문제 종류를 받아 넣는 마이그레이션을 앞에 둠.

-- TBL-027 handoffs: 그 건에서 남긴 문제 신고가 같은 주문인지 보는 외래 키의 대상
ALTER TABLE handoffs
  ADD CONSTRAINT handoffs_order_scope UNIQUE (shop_id, id, order_id);

-- TBL-030 issue_reports: 문제 종류·보상 없음의 사유·그 밖의 보상·신고한 사람과 에스컬레이션 건
ALTER TABLE issue_reports
  ALTER COLUMN card_id DROP NOT NULL,
  DROP CONSTRAINT issue_reports_compensation_check,
  ADD CONSTRAINT issue_reports_compensation_check CHECK (compensation IN ('remake', 'partial_refund', 'full_refund', 'other_compensation', 'none')),
  ADD COLUMN problem_kind text CHECK (problem_kind IN ('spoiled', 'foreign_matter', 'other')),
  ADD COLUMN no_compensation_reason text CHECK (char_length(no_compensation_reason) BETWEEN 1 AND 200),
  ADD COLUMN other_compensation_note text CHECK (char_length(other_compensation_note) BETWEEN 1 AND 200),
  ADD COLUMN other_compensation_amount integer CHECK (other_compensation_amount BETWEEN 0 AND 100000000),
  ADD COLUMN reported_by text NOT NULL DEFAULT 'orderer' CHECK (reported_by IN ('orderer', 'owner_from_handoff')),
  ADD COLUMN handoff_id uuid,
  ADD COLUMN notes_purged_at timestamptz,
  ADD CONSTRAINT issue_reports_handoff_fk FOREIGN KEY (shop_id, handoff_id, order_id) REFERENCES handoffs (shop_id, id, order_id) ON DELETE RESTRICT,
  ADD CONSTRAINT issue_reports_handoff_uq UNIQUE (handoff_id),
  ADD CONSTRAINT issue_reports_problem_kind_chk CHECK ((problem_kind IS NULL) = (compensation IS NULL)),
  ADD CONSTRAINT issue_reports_none_reason_chk CHECK (no_compensation_reason IS NULL OR (compensation = 'none' AND problem_kind IN ('spoiled', 'foreign_matter'))),
  ADD CONSTRAINT issue_reports_none_reason_needed_chk CHECK (compensation IS DISTINCT FROM 'none' OR problem_kind NOT IN ('spoiled', 'foreign_matter') OR no_compensation_reason IS NOT NULL OR notes_purged_at IS NOT NULL),
  ADD CONSTRAINT issue_reports_other_note_chk CHECK (other_compensation_note IS NULL OR compensation = 'other_compensation'),
  ADD CONSTRAINT issue_reports_other_note_needed_chk CHECK (compensation IS DISTINCT FROM 'other_compensation' OR other_compensation_note IS NOT NULL OR notes_purged_at IS NOT NULL),
  ADD CONSTRAINT issue_reports_other_amount_chk CHECK (other_compensation_amount IS NULL OR compensation = 'other_compensation'),
  ADD CONSTRAINT issue_reports_notes_purged_chk CHECK (notes_purged_at IS NULL OR (no_compensation_reason IS NULL AND other_compensation_note IS NULL)),
  ADD CONSTRAINT issue_reports_reporter_chk CHECK ((reported_by = 'orderer') = (card_id IS NOT NULL)),
  ADD CONSTRAINT issue_reports_handoff_chk CHECK (handoff_id IS NULL OR reported_by = 'owner_from_handoff');

COMMENT ON COLUMN issue_reports.card_id IS '손님이 누른 신고 카드. 주문자의 신고에만 있고 사장님이 에스컬레이션 건에서 남긴 신고에는 없음(issue_reports_reporter_chk)';
COMMENT ON COLUMN issue_reports.compensation IS '보상(TERM-033): 재제작·일부 환불·전액 환불·그 밖의 보상(사장님이 직접 처리, 환불·장부 없음)·보상 없음. 사장님만 정함(REQ-246)';
COMMENT ON COLUMN issue_reports.problem_kind IS '문제 종류: 상함·변질·이물·그 밖. 사장님이 보상을 정할 때 꼭 고름(REQ-247). 손님과 AI 상담은 고르지 않음';
COMMENT ON COLUMN issue_reports.no_compensation_reason IS '상함·변질·이물에 보상 없음을 고른 사유(REQ-248, 소비자분쟁해결기준을 보인 뒤). 사장님 화면에만. 주문이 끝난 날부터 3년 뒤 비움(SPEC-065)';
COMMENT ON COLUMN issue_reports.other_compensation_note IS '그 밖의 보상에서 사장님이 한 일(REQ-249). 사장님 화면에만. 주문이 끝난 날부터 3년 뒤 비움(SPEC-065)';
COMMENT ON COLUMN issue_reports.other_compensation_amount IS '그 밖의 보상의 금액(선택, 0원~1억 원). 환불·장부 행은 만들지 않음(REQ-249)';
COMMENT ON COLUMN issue_reports.reported_by IS '신고한 사람: 주문자(신고 카드)·사장님이 에스컬레이션 건에서 남김(주문자가 아닌 사람의 말, SPEC-079)';
COMMENT ON COLUMN issue_reports.handoff_id IS '사장님이 남긴 신고의 에스컬레이션 건(사유 다른 사용자, 같은 주문, 건마다 하나, 4절 A38). 상담을 지울 때 그 건을 지우기 전에 비움(SPEC-065, 5절 E32)';
COMMENT ON COLUMN issue_reports.notes_purged_at IS '보상 없음 사유와 그 밖의 보상의 한 일을 비운 시각(주문이 끝난 날부터 3년, SPEC-065)';
