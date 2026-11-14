-- 0011_amount_confirm_standard_quote: 손님의 새 금액 확인과 기본 디자인 범위(설계 재검토 M5·M6, 2026-11-14,
-- 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)', 검토자의 고치는 방향대로)
-- M5(RB-07, RA-08, RE-17): 손님이 본 금액보다 높게 정한 맞춤 주문의 결제 안내와 금액이 오르는 변경의 차액 결제는 손님이 새 금액을
--     확인한 뒤에만 계좌를 보이고 그때부터 결제 기한을 셈(payment_requests의 컬럼 넷과 CHECK 여섯, 새 금액 확인 카드
--     confirm_cards.kind = 'amount_confirm', SPEC-076). 금액이 오르는 날짜 변경은 차액을 기다리는 동안 옛 날의 확정된 자리를 두고
--     새 날 자리를 잡음: 주문 하나에 잡힌 자리와 확정된 자리를 각각 하나까지로 나누고(slot_holds_one_held_per_order,
--     slot_holds_one_fixed_per_order) 둘이 함께 있는 것은 차액 결제 안내의 자리뿐(트리거 slot_holds_pair), 풀린 사유에 변경 요청이
--     닫힘(change_closed)을 더함. 닿을 수 없던 변경 요청 상태 '오래된 버전이라 받지 않음'(stale)과 할 일 '이전 버전 변경'(stale_change)을 뺌
--     (REQ-133은 변경 요청 카드와 change_requests_applied_version_chk가 지킴). 맞춤 주문의 다시 낸 결제도 손님이 요청한 금액을 담음.
-- M6(RA-07, RB-18): 기본 디자인 범위에는 값이 '확정'인 옵션만(price_options_standard_fixed_chk), 기본 디자인 주문의 견적은
--     '확정'만(quotes_standard_fixed_chk). 범위는 사장님이 옵션·도안마다 고르고 가격표 버전에 함께 남음(컬럼은 그대로, 설명을 고침).
-- 0010_refund_calc_remake.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0011_amount_confirm_standard_quote.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 옮길 행이 없음. 있으면 이미 나간 차액 결제
-- 안내는 새 금액 확인이 필요한 것으로 두고 전해진 시각(없으면 확인 요청·확인된 시각)을 확인 시각으로 채움(아래 UPDATE). 'stale' 변경
-- 요청과 'stale_change' 할 일은 만들 길이 없어 없음. 새 CHECK는 적용할 때 이미 있는 행을 보고, 트리거는 새로 쓰거나 상태를 바꾸는 행만 봄.

-- TBL-031 payment_requests: 새 금액 확인(SPEC-076, REQ-232, REQ-233)
ALTER TABLE payment_requests
  ADD COLUMN needs_amount_confirm boolean NOT NULL DEFAULT false,
  ADD COLUMN amount_confirmed_at timestamptz,
  ADD COLUMN amount_declined_at timestamptz,
  ADD COLUMN amount_card_id uuid;
UPDATE payment_requests
   SET needs_amount_confirm = true,
       amount_confirmed_at = coalesce(delivered_at, claimed_at, paid_at),
       delivered_at = coalesce(delivered_at, claimed_at, paid_at)
 WHERE kind = 'difference';
ALTER TABLE payment_requests
  DROP CONSTRAINT payment_requests_requested_amount_chk,
  ADD CONSTRAINT payment_requests_requested_amount_chk CHECK (requested_amount IS NULL OR kind IN ('first', 'reissue')),
  ADD CONSTRAINT payment_requests_amount_card_fk FOREIGN KEY (shop_id, amount_card_id) REFERENCES confirm_cards (shop_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT payment_requests_needs_confirm_chk CHECK (CASE WHEN kind = 'difference' THEN needs_amount_confirm ELSE NOT needs_amount_confirm OR amount > coalesce(requested_amount, amount) END),
  ADD CONSTRAINT payment_requests_amount_answer_chk CHECK ((amount_confirmed_at IS NULL OR amount_declined_at IS NULL) AND (needs_amount_confirm OR (amount_confirmed_at IS NULL AND amount_declined_at IS NULL AND amount_card_id IS NULL))),
  ADD CONSTRAINT payment_requests_amount_delivered_chk CHECK (NOT needs_amount_confirm OR delivered_at IS NOT DISTINCT FROM amount_confirmed_at),
  ADD CONSTRAINT payment_requests_amount_claim_chk CHECK (NOT needs_amount_confirm OR claimed_at IS NULL OR amount_confirmed_at IS NOT NULL),
  ADD CONSTRAINT payment_requests_amount_paid_chk CHECK (status <> 'paid' OR NOT needs_amount_confirm OR amount_confirmed_at IS NOT NULL),
  ADD CONSTRAINT payment_requests_amount_declined_chk CHECK (amount_declined_at IS NULL OR status = 'closed');

-- TBL-024 confirm_cards: 새 금액 확인 카드
ALTER TABLE confirm_cards DROP CONSTRAINT confirm_cards_kind_check;
ALTER TABLE confirm_cards ADD CONSTRAINT confirm_cards_kind_check CHECK (kind IN ('order_request', 'payment_claim', 'change_request', 'cancel', 'issue_report', 'consent_withdrawal', 'orderer_info', 'allergy_info', 'photo_consent', 'amount_confirm'));

-- TBL-025 change_requests: 닿을 수 없던 '오래된 버전이라 받지 않음'을 뺌(1-5)
ALTER TABLE change_requests DROP CONSTRAINT change_requests_status_check;
ALTER TABLE change_requests ADD CONSTRAINT change_requests_status_check CHECK (status IN ('requested', 'awaiting_difference', 'applied', 'rejected', 'closed_no_difference', 'closed_by_cancel', 'closed_no_answer'));

-- TBL-042 owner_tasks: 할 일 '이전 버전 변경'을 뺌
ALTER TABLE owner_tasks DROP CONSTRAINT owner_tasks_kind_check, DROP CONSTRAINT owner_tasks_subject_chk;
ALTER TABLE owner_tasks
  ADD CONSTRAINT owner_tasks_kind_check CHECK (kind IN ('handoff', 'custom_order', 'change_request', 'issue_report', 'payment_claim', 'payment_mismatch', 'payment_overdue', 'refund_decision', 'paid_after_cancel', 'ledger_relink', 'license_on_hold', 'calendar_conflict', 'refund_send', 'arrival_check')),
  ADD CONSTRAINT owner_tasks_subject_chk CHECK (
    (kind <> 'handoff' OR handoff_id IS NOT NULL)
    AND (kind <> 'change_request' OR change_request_id IS NOT NULL)
    AND (kind <> 'issue_report' OR issue_report_id IS NOT NULL)
    AND (kind NOT IN ('payment_claim', 'payment_mismatch', 'arrival_check') OR payment_request_id IS NOT NULL)
    AND (kind <> 'refund_send' OR refund_id IS NOT NULL)
    AND (kind NOT IN ('custom_order', 'payment_overdue', 'refund_decision', 'paid_after_cancel', 'refund_send', 'arrival_check') OR order_id IS NOT NULL));

-- TBL-034 slot_holds: 차액을 기다리는 날짜 변경의 새 날 자리(REQ-234)
ALTER TABLE slot_holds DROP CONSTRAINT slot_holds_release_reason_check;
ALTER TABLE slot_holds ADD CONSTRAINT slot_holds_release_reason_check CHECK (release_reason IN ('payment_overdue', 'order_cancelled', 'date_changed', 'change_closed'));
DROP INDEX slot_holds_one_live_per_order;
CREATE UNIQUE INDEX slot_holds_one_held_per_order ON slot_holds (order_id) WHERE status = 'held'; -- 주문 하나에 잡힌 자리 하나
CREATE UNIQUE INDEX slot_holds_one_fixed_per_order ON slot_holds (order_id) WHERE status = 'fixed'; -- 주문 하나에 확정된 자리 하나. 잡힌 자리와 함께 있는 것은 차액을 기다리는 날짜 변경뿐(트리거 slot_holds_pair, REQ-234)

-- TBL-007 price_options, TBL-022 quotes: 기본 디자인 범위와 견적의 주문 종류(REQ-228, REQ-229)
ALTER TABLE price_options ADD CONSTRAINT price_options_standard_fixed_chk CHECK (NOT in_standard OR price_kind = 'fixed');
ALTER TABLE quotes ADD CONSTRAINT quotes_standard_fixed_chk CHECK (order_kind = 'custom' OR display_kind = 'fixed');

-- TBL-034 slot_holds: 잡힌 자리와 확정된 자리의 짝(트리거). 아래 주석은 db/schema.sql과 같음
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

-- 컬럼 설명(db/schema.sql과 같은 줄)
COMMENT ON COLUMN price_options.in_standard IS '기본 디자인 범위 안인지: 사장님이 옵션마다 고르고 가격표 버전에 함께 남음. 값이 ''확정''인 옵션만 넣음(price_options_standard_fixed_chk). 범위 밖 옵션을 고르면 맞춤 주문(SPEC-004, SPEC-013, REQ-228, REQ-229)';
COMMENT ON COLUMN designs.in_standard IS '기본 디자인 범위 안인지: 사장님이 도안마다 고르고 가격표 버전에 함께 남음. 값을 정하는 디자인 옵션이 범위 밖이면 넣지 않음(앱, SPEC-004, REQ-228)';
COMMENT ON COLUMN order_drafts.order_kind IS '가게 규칙이 가른 주문 종류(견적과 같음, SPEC-013). 기본 디자인 범위 밖 옵션·도안, 참고 사진(SPEC-019), 빼야 할 재료, ''부터''·''범위'' 값이 하나라도 있으면 맞춤(REQ-229)';
COMMENT ON COLUMN quotes.order_kind IS '기본 디자인·맞춤: 고른 옵션·도안이 모두 그 버전의 기본 디자인 범위 안이고 참고 사진·빼야 할 재료가 없고 표시 방식이 ''확정''일 때만 기본 디자인(quotes_standard_fixed_chk, SPEC-013, REQ-229)';
COMMENT ON COLUMN quotes.display_kind IS '표시 방식: 확정·부터·범위(REQ-006). 고른 옵션에 ''부터''가 있으면 부터, 아니고 ''범위''가 있으면 범위(SPEC-013)';
COMMENT ON COLUMN quotes.amount IS '금액: 고른 옵션 값(범위면 아래 끝)과 더하는 값의 합. ''부터''·''범위''면 아래 끝이고 맞춤 주문의 최종 금액은 이 값 이상(SPEC-031, REQ-230)';
COMMENT ON COLUMN quotes.amount_max IS '범위의 위 끝: 범위 옵션의 위 끝과 나머지 값의 합. 사장님이 정한 금액이 이보다 높으면 손님이 새 금액을 확인(SPEC-076)';
COMMENT ON COLUMN confirm_cards.kind IS '주문 요청·입금 알리기·변경 요청·취소·신고·동의 철회(SPEC-069)·주문자 정보(SPEC-072, 주문 요청 카드 앞에서 이름·연락처를 받음)·알레르기 정보(SPEC-075, 주문자 정보 카드 앞에서 따로 동의를 받음)·사진 게시 동의(SPEC-053, 완성 사진 안내의 버튼)·새 금액 확인(SPEC-076, 결제 안내를 전할 때 계좌 대신)';
COMMENT ON COLUMN change_requests.status IS '요청됨·차액 결제 기다림(손님의 새 금액 확인과 차액 맞추는 중을 포함하고 차액 결제 안내의 상태로 가름)·반영됨·거절됨·차액 없어 닫힘(차액 결제 기한 지남·손님이 새 금액을 받지 않음·변경 닫기)·주문 취소로 닫힘·답 없어 닫힘(1-5). 답 없어 닫힘은 변경 마감까지 사장님 답이 없을 때(REQ-214)';
COMMENT ON COLUMN change_requests.amount_delta IS '수락할 때 금액 차이: 사장님이 고른 방향(그대로·올라감·내려감)과 양수 차이 금액으로 앱이 셈(올라감 +, 내려감 -, 그대로 0). 사장님이 부호를 넣지 않음(SPEC-042, 설계 재검토 M5)';
COMMENT ON COLUMN payment_requests.amount IS '안내 금액: 수락한 버전(기본 디자인은 요청한 버전)의 금액(REQ-076). 차액 결제는 사장님이 고른 방향과 차이 금액으로 셈한 오른 금액(SPEC-042)';
COMMENT ON COLUMN payment_requests.requested_amount IS '금액을 정하거나 바꿔 수락한 맞춤 주문에서 손님이 요청한 견적 금액(''부터''·''범위''면 아래 끝). 표시 방식과 위 끝은 그 주문 첫 버전의 견적(order_details.quote_id)에서 읽어 함께 보임(REQ-231). 다시 낸 결제도 같은 값';
COMMENT ON COLUMN payment_requests.needs_amount_confirm IS '새 금액 확인이 필요한 결제 안내: 손님이 본 금액(견적이 금액 하나면 그 금액, ''부터''면 아래 끝, ''범위''면 위 끝)보다 높게 정한 맞춤 주문의 첫 결제와 확인 전에 다시 낸 결제, 금액이 오르는 변경의 차액 결제. 손님이 확인하기 전에는 계좌를 보이지 않고 결제 기한은 상한(SPEC-076, REQ-232)';
COMMENT ON COLUMN payment_requests.amount_confirmed_at IS '손님이 새 금액을 확인한 시각. 이때가 전해진 시각(payment_requests_amount_delivered_chk). 확인 전에 들어온 돈을 사장님이 결제로 확인(''입금됨''·''대조 완료'')하면 그 시각(SPEC-034)';
COMMENT ON COLUMN payment_requests.amount_declined_at IS '손님이 새 금액을 받지 않은 시각. 결제 안내를 닫음: 맞춤 주문은 손님 취소(주문 취소), 변경은 변경 요청이 차액 없어 닫힘(REQ-233)';
COMMENT ON COLUMN payment_requests.amount_card_id IS '손님이 누른 새 금액 확인 카드(SPEC-076). 사장님의 결제 확인으로 남긴 확인이면 빈 값';
COMMENT ON COLUMN payment_requests.delivered_at IS '결제 안내가 손님에게 전해진 시각: 대화 중 답으로 보임·먼저 보낸 안내가 닿음·다음 대화 때 전함(SPEC-032). 새 금액 확인이 필요하면 손님이 확인한 시각(SPEC-076). 빈 값이면 ''아직 못 전함''(SPEC-037)';
COMMENT ON COLUMN payment_requests.close_reason IS '새 결제 안내·주문 취소(맞춤 주문의 새 금액을 받지 않음 포함)·변경 요청이 닫힘(차액의 새 금액을 받지 않음·변경 닫기 포함)';
COMMENT ON COLUMN slot_holds.payment_request_id IS '잡힘이면 그 결제 안내. 그 결제 기한까지 잡고, 확인 요청됨이면 결제 기한 상한까지(R13, REQ-223). 금액이 오르는 날짜 변경의 새 날 자리는 차액 결제 안내(REQ-234)';
COMMENT ON COLUMN slot_holds.status IS '가예약됨·확정됨·해제됨·종료됨(1-4). 한 주문에 잡힌 자리와 확정된 자리는 각각 하나까지이고, 둘이 함께 있는 것은 차액을 기다리는 날짜 변경뿐(트리거 slot_holds_pair, REQ-234)';
COMMENT ON COLUMN slot_holds.fixed_at IS '확정 자리가 된 시각(결제 확인됨, 날짜 변경의 새 날(차액을 기다린 새 날 자리는 변경 반영 때), 재제작)';
COMMENT ON COLUMN slot_holds.release_reason IS '결제 기한 지남·주문 취소·날짜 변경의 옛 날·변경 요청이 반영되지 않고 닫혀 차액을 기다린 새 날을 풂(REQ-234)';
COMMENT ON COLUMN owner_tasks.kind IS '에스컬레이션 건·맞춤 주문·변경 요청·문제 신고·결제 확인 요청·맞추는 중·결제 기한 지남·환불 결정·취소 뒤 들어온 입금·장부 다시 연결·영업 신고 보류·영업 캘린더 기준을 넘는 날·환불 보내기(REQ-173)·들어온 입금 대조(REQ-167)';
