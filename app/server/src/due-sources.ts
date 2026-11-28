/**
 * 기다리는 일을 찾는 곳(TASK-023 실행기의 '작업 표'). 05에는 따로 된 작업 테이블이 없고, 기다리는 일은 그 일의 행에
 * 때가 적혀 있다(결제 기한 `payment_requests.due_at`, 다음에 보낼 때 `notifications.next_attempt_at` 따위). 그래서
 * 서버를 다시 띄워도 기다리던 일은 데이터베이스에 그대로 있고, 실행기(job-runner.ts)는 1분마다 아래 SQL로 때가 된 행을 찾는다.
 *
 * - 곳마다 05의 부분 인덱스 하나의 조건으로 시작한다(test/due-sources.test.ts가 db/schema.sql의 인덱스와 견주고, 실행 계획이
 *   그 인덱스를 쓰는지 본다). 그 뒤에 조건을 더할 수 있다(같은 테이블을 두 일이 나눌 때, 발송 결과 조회의 1·5·30분).
 * - find는 여러 가게를 한 번에 본다(가게 범위 밖). 그래서 가게 ID·행 ID·때만 돌려주는 꼴(FIND_SHAPE)로만 쓰고, 가게 범위
 *   밖의 읽기는 이 파일에만 둘 수 있다(정적 시험 test/shop-scope-static.test.ts). 행의 내용은 claim 뒤 그 가게 범위
 *   연결로만 읽는다. 이 파일은 데이터베이스 연결을 가져오지 않는다(SQL 글만).
 * - claim은 그 가게 범위 연결(ShopDb, $1 = 가게 ID)로 보내 행을 잠근다(FOR UPDATE SKIP LOCKED). 다른 실행기가 잡고 있거나
 *   그 사이 처리돼 조건이 바뀌었으면 0행이라 건너뛴다. $2는 행 ID, $3은 찾을 때와 같은 기준 시각이다.
 * - SQL에 now()를 쓰지 않는다. 기준 시각은 실행기가 넘긴다(한 번의 실행 안에서 같고, 시험이 시계를 정함).
 * - 새 일이 다른 곳을 찾아야 하면 05에 인덱스가 있는지 먼저 보고 여기에 더한다(맡는 작업이 더함). 가게마다 다른 설정으로
 *   때가 정해지는 것(문의 끊김 SPEC-025의 가게별 시간 따위)은 그 작업이 꼴과 함께 정한다(app/README.md 38).
 */

/** 찾기 SQL의 꼴: 가게 ID·행 ID·때만 돌려주고, 조건 뒤에 `때 <= $1`, 때와 ID 순서, `LIMIT $2`. 테이블 하나, 별칭 t. */
export const FIND_SHAPE =
  /^SELECT t\.shop_id, t\.id, t\.([a-z_]+) AS due_at FROM ([a-z_]+) t WHERE (.+) AND t\.\1 <= \$1 ORDER BY t\.\1, t\.id LIMIT \$2$/;

/** 하루 한 번 일이 그날 시작했는지 보는 SQL의 꼴: 운영 기록에서 가게와 무관한 그 종류의 마지막 시각($2 그날의 때부터 $3 다음 날의 때 전까지). */
export const LAST_RUN_SHAPE =
  /^SELECT max\(t\.created_at\) AS last_at FROM ops_events t WHERE t\.kind = \$1 AND t\.shop_id IS NULL AND t\.created_at >= \$2 AND t\.created_at < \$3$/;

export interface DueSource {
  /** 05의 가게 테이블. */
  readonly table: string;
  /** 때가 적힌 열. */
  readonly dueColumn: string;
  /** 이 곳의 조건이 시작하는 05 부분 인덱스. */
  readonly index: string;
  /** 여러 가게에서 때가 된 행 찾기($1 기준 시각, $2 한 번에 찾을 수). FIND_SHAPE 꼴. */
  readonly find: string;
  /** 그 가게 범위 연결로 행 하나 잡기($1 가게 ID, $2 행 ID, $3 기준 시각). find와 같은 조건. */
  readonly claim: string;
}

/*
 * 발송 결과를 조회할 때(요청 뒤 1·5·30분, REQ-182): 마지막 조회 시각(delivery_checked_at)으로 몇 번째 조회인지 정한다.
 * owner_alert_check·notification_check의 `t.requested_at + CASE … END <= $1`이 그 셈이고, retry.ts의
 * nextDeliveryCheckAt과 같다(test/due-sources.test.ts가 데이터베이스에서 견줌). 30분 조회 뒤에도 확인 중으로 남은 행은
 * 계속 때가 된 것으로 보여, 맡는 일이 '모름'으로 끝낸다(SPEC-066·067). 정적 검사가 볼 수 있게 SQL 글마다 그대로 적는다.
 */

/**
 * 실행기가 찾는 곳. 이름은 일이 고르는 열쇠이고, 어느 일이 쓰는지는 jobs.ts의 등록부가 정한다. 기준 시각은 보통 지금이고,
 * 지난 시간으로 세는 곳(남긴 지 7일)은 일이 '지금 − 그 시간'을 넘긴다.
 * 손으로 쓴 SQL 글이다(정적 검사가 테이블 이름을 볼 수 있게 끼워 넣지 않음). claim이 find와 같은 조건인지는 시험이 본다.
 */
export const DUE_SOURCES = {
  /** TASK-134: 현재 가게 시각이 지난 픽업 전날의 확정 주문. 이미 보냈거나 시작한 안내는 다시 만들지 않는다. */
  order_day_before: {
    table: "orders",
    dueColumn: "confirmed_at",
    index: "orders_day_before_idx",
    find: "SELECT t.shop_id, t.id, t.confirmed_at AS due_at FROM orders t WHERE t.status = 'confirmed' AND t.personal_data_purged_at IS NULL AND EXISTS (SELECT 1 FROM shops s LEFT JOIN business_calendars b ON b.shop_id = s.id WHERE s.id = t.shop_id AND nullif(btrim(s.contact_phone),'') IS NOT NULL AND (t.pickup_at AT TIME ZONE s.time_zone)::date = ($1::timestamptz AT TIME ZONE s.time_zone)::date + 1 AND ($1::timestamptz AT TIME ZONE s.time_zone)::time >= coalesce(b.day_before_notice_time,'18:00'::time) AND to_char($1::timestamptz AT TIME ZONE s.time_zone,'HH24:MI') BETWEEN '08:00' AND '20:50' AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.shop_id = t.shop_id AND n.order_id = t.id AND n.kind = 'day_before' AND (n.sent_at IS NOT NULL OR n.reply_claim_until > $1 OR n.attempts > 0 OR n.status NOT IN ('pending','retrying','deferred','dropped') OR (n.event_key = 'notice:'||t.id::text||':day_before' AND n.customer_id = t.customer_id AND n.consultation_id = t.consultation_id AND n.status IN ('pending','retrying','deferred') AND n.template_key = 'day_before:v1:'||md5(jsonb_build_array(t.version,extract(epoch FROM t.pickup_at),s.time_zone,s.pickup_address,s.contact_phone)::text) AND n.scheduled_for = ((((t.pickup_at AT TIME ZONE s.time_zone)::date-1)+coalesce(b.day_before_notice_time,'18:00'::time)) AT TIME ZONE s.time_zone))))) AND t.confirmed_at <= $1 ORDER BY t.confirmed_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM orders t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'confirmed' AND t.personal_data_purged_at IS NULL AND EXISTS (SELECT 1 FROM shops s LEFT JOIN business_calendars b ON b.shop_id = s.id WHERE s.id = t.shop_id AND nullif(btrim(s.contact_phone),'') IS NOT NULL AND (t.pickup_at AT TIME ZONE s.time_zone)::date = ($3::timestamptz AT TIME ZONE s.time_zone)::date + 1 AND ($3::timestamptz AT TIME ZONE s.time_zone)::time >= coalesce(b.day_before_notice_time,'18:00'::time) AND to_char($3::timestamptz AT TIME ZONE s.time_zone,'HH24:MI') BETWEEN '08:00' AND '20:50' AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.shop_id = t.shop_id AND n.order_id = t.id AND n.kind = 'day_before' AND (n.sent_at IS NOT NULL OR n.reply_claim_until > $3 OR n.attempts > 0 OR n.status NOT IN ('pending','retrying','deferred','dropped') OR (n.event_key = 'notice:'||t.id::text||':day_before' AND n.customer_id = t.customer_id AND n.consultation_id = t.consultation_id AND n.status IN ('pending','retrying','deferred') AND n.template_key = 'day_before:v1:'||md5(jsonb_build_array(t.version,extract(epoch FROM t.pickup_at),s.time_zone,s.pickup_address,s.contact_phone)::text) AND n.scheduled_for = ((((t.pickup_at AT TIME ZONE s.time_zone)::date-1)+coalesce(b.day_before_notice_time,'18:00'::time)) AT TIME ZONE s.time_zone))))) AND t.confirmed_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** TASK-076: 현재 가게 설정의 끊김 시간이 지난 open 상담. */
  consultation_open: {
    table: "consultations",
    dueColumn: "last_customer_message_at",
    index: "consultations_idle_idx",
    find: "SELECT t.shop_id, t.id, t.last_customer_message_at AS due_at FROM consultations t WHERE t.status = 'open' AND EXISTS (SELECT 1 FROM shops s WHERE s.id = t.shop_id AND t.last_customer_message_at <= $1::timestamptz - s.idle_close_hours * interval '1 hour') AND NOT EXISTS (SELECT 1 FROM handoffs h WHERE h.shop_id = t.shop_id AND h.consultation_id = t.id AND h.status = 'open') AND t.last_customer_message_at <= $1 ORDER BY t.last_customer_message_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM consultations t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'open' AND EXISTS (SELECT 1 FROM shops s WHERE s.id = t.shop_id AND t.last_customer_message_at <= $3::timestamptz - s.idle_close_hours * interval '1 hour') AND NOT EXISTS (SELECT 1 FROM handoffs h WHERE h.shop_id = t.shop_id AND h.consultation_id = t.id AND h.status = 'open') AND t.last_customer_message_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** TASK-076: 현재 가게 설정의 끊김 시간이 지난 ordered 상담. */
  consultation_ordered: {
    table: "consultations",
    dueColumn: "last_customer_message_at",
    index: "consultations_ordered_idx",
    find: "SELECT t.shop_id, t.id, t.last_customer_message_at AS due_at FROM consultations t WHERE t.status = 'ordered' AND EXISTS (SELECT 1 FROM shops s WHERE s.id = t.shop_id AND t.last_customer_message_at <= $1::timestamptz - s.idle_close_hours * interval '1 hour') AND NOT EXISTS (SELECT 1 FROM handoffs h WHERE h.shop_id = t.shop_id AND h.consultation_id = t.id AND h.status = 'open') AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shop_id=t.shop_id AND ((o.consultation_id=t.id OR EXISTS (SELECT 1 FROM confirm_cards own_card WHERE own_card.shop_id=t.shop_id AND own_card.consultation_id=t.id AND own_card.order_id=o.id) OR EXISTS (SELECT 1 FROM issue_details own_issue WHERE own_issue.shop_id=t.shop_id AND own_issue.consultation_id=t.id AND own_issue.order_id=o.id) OR EXISTS (SELECT 1 FROM handoffs own_handoff WHERE own_handoff.shop_id=t.shop_id AND own_handoff.consultation_id=t.id AND own_handoff.order_id=o.id) OR EXISTS (SELECT 1 FROM handoffs own_day WHERE own_day.shop_id=t.shop_id AND own_day.consultation_id=t.id AND own_day.day_used_order_id=o.id) OR EXISTS (SELECT 1 FROM handoffs own_limit WHERE own_limit.shop_id=t.shop_id AND own_limit.consultation_id=t.id AND own_limit.limit_used_order_id=o.id) OR EXISTS (SELECT 1 FROM notifications own_notice WHERE own_notice.shop_id=t.shop_id AND own_notice.consultation_id=t.id AND own_notice.order_id=o.id) OR EXISTS (SELECT 1 FROM handoff_questions own_question JOIN handoffs own_question_handoff ON own_question_handoff.shop_id=own_question.shop_id AND own_question_handoff.id=own_question.handoff_id WHERE own_question.shop_id=t.shop_id AND own_question_handoff.consultation_id=t.id AND own_question.order_id=o.id)) OR o.remake_of_order_id IN (SELECT root.id FROM orders root WHERE root.shop_id=t.shop_id AND (root.consultation_id=t.id OR EXISTS (SELECT 1 FROM confirm_cards root_card WHERE root_card.shop_id=t.shop_id AND root_card.consultation_id=t.id AND root_card.order_id=root.id) OR EXISTS (SELECT 1 FROM issue_details root_issue WHERE root_issue.shop_id=t.shop_id AND root_issue.consultation_id=t.id AND root_issue.order_id=root.id) OR EXISTS (SELECT 1 FROM handoffs root_handoff WHERE root_handoff.shop_id=t.shop_id AND root_handoff.consultation_id=t.id AND root_handoff.order_id=root.id) OR EXISTS (SELECT 1 FROM handoffs root_day WHERE root_day.shop_id=t.shop_id AND root_day.consultation_id=t.id AND root_day.day_used_order_id=root.id) OR EXISTS (SELECT 1 FROM handoffs root_limit WHERE root_limit.shop_id=t.shop_id AND root_limit.consultation_id=t.id AND root_limit.limit_used_order_id=root.id) OR EXISTS (SELECT 1 FROM notifications root_notice WHERE root_notice.shop_id=t.shop_id AND root_notice.consultation_id=t.id AND root_notice.order_id=root.id) OR EXISTS (SELECT 1 FROM handoff_questions root_question JOIN handoffs root_question_handoff ON root_question_handoff.shop_id=root_question.shop_id AND root_question_handoff.id=root_question.handoff_id WHERE root_question.shop_id=t.shop_id AND root_question_handoff.consultation_id=t.id AND root_question.order_id=root.id)))) AND (o.status NOT IN ('received','no_pickup','rejected','cancelled') OR EXISTS (SELECT 1 FROM payment_requests open_payment WHERE open_payment.shop_id=t.shop_id AND open_payment.order_id=o.id AND open_payment.status IN ('open','claimed','mismatch')) OR EXISTS (SELECT 1 FROM change_requests open_change WHERE open_change.shop_id=t.shop_id AND open_change.order_id=o.id AND open_change.status IN ('requested','awaiting_difference')) OR EXISTS (SELECT 1 FROM issue_reports open_issue WHERE open_issue.shop_id=t.shop_id AND open_issue.order_id=o.id AND open_issue.status<>'closed') OR EXISTS (SELECT 1 FROM refunds open_refund WHERE open_refund.shop_id=t.shop_id AND open_refund.order_id=o.id AND open_refund.amount>0 AND open_refund.sent_at IS NULL) OR EXISTS (SELECT 1 FROM owner_tasks open_task WHERE open_task.shop_id=t.shop_id AND open_task.closed_at IS NULL AND (open_task.order_id=o.id OR EXISTS (SELECT 1 FROM payment_requests open_task_payment WHERE open_task_payment.shop_id=t.shop_id AND open_task_payment.id=open_task.payment_request_id AND open_task_payment.order_id=o.id) OR EXISTS (SELECT 1 FROM change_requests open_task_change WHERE open_task_change.shop_id=t.shop_id AND open_task_change.id=open_task.change_request_id AND open_task_change.order_id=o.id) OR EXISTS (SELECT 1 FROM issue_reports open_task_issue WHERE open_task_issue.shop_id=t.shop_id AND open_task_issue.id=open_task.issue_report_id AND open_task_issue.order_id=o.id) OR EXISTS (SELECT 1 FROM refunds open_task_refund WHERE open_task_refund.shop_id=t.shop_id AND open_task_refund.id=open_task.refund_id AND open_task_refund.order_id=o.id) OR EXISTS (SELECT 1 FROM handoffs open_task_handoff WHERE open_task_handoff.shop_id=t.shop_id AND open_task_handoff.id=open_task.handoff_id AND (open_task_handoff.order_id=o.id OR open_task_handoff.day_used_order_id=o.id OR open_task_handoff.limit_used_order_id=o.id)))) OR EXISTS (SELECT 1 FROM handoffs open_handoff WHERE open_handoff.shop_id=t.shop_id AND open_handoff.status='open' AND (open_handoff.order_id=o.id OR open_handoff.day_used_order_id=o.id OR open_handoff.limit_used_order_id=o.id)))) AND t.last_customer_message_at <= $1 ORDER BY t.last_customer_message_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM consultations t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'ordered' AND EXISTS (SELECT 1 FROM shops s WHERE s.id = t.shop_id AND t.last_customer_message_at <= $3::timestamptz - s.idle_close_hours * interval '1 hour') AND NOT EXISTS (SELECT 1 FROM handoffs h WHERE h.shop_id = t.shop_id AND h.consultation_id = t.id AND h.status = 'open') AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shop_id=t.shop_id AND ((o.consultation_id=t.id OR EXISTS (SELECT 1 FROM confirm_cards own_card WHERE own_card.shop_id=t.shop_id AND own_card.consultation_id=t.id AND own_card.order_id=o.id) OR EXISTS (SELECT 1 FROM issue_details own_issue WHERE own_issue.shop_id=t.shop_id AND own_issue.consultation_id=t.id AND own_issue.order_id=o.id) OR EXISTS (SELECT 1 FROM handoffs own_handoff WHERE own_handoff.shop_id=t.shop_id AND own_handoff.consultation_id=t.id AND own_handoff.order_id=o.id) OR EXISTS (SELECT 1 FROM handoffs own_day WHERE own_day.shop_id=t.shop_id AND own_day.consultation_id=t.id AND own_day.day_used_order_id=o.id) OR EXISTS (SELECT 1 FROM handoffs own_limit WHERE own_limit.shop_id=t.shop_id AND own_limit.consultation_id=t.id AND own_limit.limit_used_order_id=o.id) OR EXISTS (SELECT 1 FROM notifications own_notice WHERE own_notice.shop_id=t.shop_id AND own_notice.consultation_id=t.id AND own_notice.order_id=o.id) OR EXISTS (SELECT 1 FROM handoff_questions own_question JOIN handoffs own_question_handoff ON own_question_handoff.shop_id=own_question.shop_id AND own_question_handoff.id=own_question.handoff_id WHERE own_question.shop_id=t.shop_id AND own_question_handoff.consultation_id=t.id AND own_question.order_id=o.id)) OR o.remake_of_order_id IN (SELECT root.id FROM orders root WHERE root.shop_id=t.shop_id AND (root.consultation_id=t.id OR EXISTS (SELECT 1 FROM confirm_cards root_card WHERE root_card.shop_id=t.shop_id AND root_card.consultation_id=t.id AND root_card.order_id=root.id) OR EXISTS (SELECT 1 FROM issue_details root_issue WHERE root_issue.shop_id=t.shop_id AND root_issue.consultation_id=t.id AND root_issue.order_id=root.id) OR EXISTS (SELECT 1 FROM handoffs root_handoff WHERE root_handoff.shop_id=t.shop_id AND root_handoff.consultation_id=t.id AND root_handoff.order_id=root.id) OR EXISTS (SELECT 1 FROM handoffs root_day WHERE root_day.shop_id=t.shop_id AND root_day.consultation_id=t.id AND root_day.day_used_order_id=root.id) OR EXISTS (SELECT 1 FROM handoffs root_limit WHERE root_limit.shop_id=t.shop_id AND root_limit.consultation_id=t.id AND root_limit.limit_used_order_id=root.id) OR EXISTS (SELECT 1 FROM notifications root_notice WHERE root_notice.shop_id=t.shop_id AND root_notice.consultation_id=t.id AND root_notice.order_id=root.id) OR EXISTS (SELECT 1 FROM handoff_questions root_question JOIN handoffs root_question_handoff ON root_question_handoff.shop_id=root_question.shop_id AND root_question_handoff.id=root_question.handoff_id WHERE root_question.shop_id=t.shop_id AND root_question_handoff.consultation_id=t.id AND root_question.order_id=root.id)))) AND (o.status NOT IN ('received','no_pickup','rejected','cancelled') OR EXISTS (SELECT 1 FROM payment_requests open_payment WHERE open_payment.shop_id=t.shop_id AND open_payment.order_id=o.id AND open_payment.status IN ('open','claimed','mismatch')) OR EXISTS (SELECT 1 FROM change_requests open_change WHERE open_change.shop_id=t.shop_id AND open_change.order_id=o.id AND open_change.status IN ('requested','awaiting_difference')) OR EXISTS (SELECT 1 FROM issue_reports open_issue WHERE open_issue.shop_id=t.shop_id AND open_issue.order_id=o.id AND open_issue.status<>'closed') OR EXISTS (SELECT 1 FROM refunds open_refund WHERE open_refund.shop_id=t.shop_id AND open_refund.order_id=o.id AND open_refund.amount>0 AND open_refund.sent_at IS NULL) OR EXISTS (SELECT 1 FROM owner_tasks open_task WHERE open_task.shop_id=t.shop_id AND open_task.closed_at IS NULL AND (open_task.order_id=o.id OR EXISTS (SELECT 1 FROM payment_requests open_task_payment WHERE open_task_payment.shop_id=t.shop_id AND open_task_payment.id=open_task.payment_request_id AND open_task_payment.order_id=o.id) OR EXISTS (SELECT 1 FROM change_requests open_task_change WHERE open_task_change.shop_id=t.shop_id AND open_task_change.id=open_task.change_request_id AND open_task_change.order_id=o.id) OR EXISTS (SELECT 1 FROM issue_reports open_task_issue WHERE open_task_issue.shop_id=t.shop_id AND open_task_issue.id=open_task.issue_report_id AND open_task_issue.order_id=o.id) OR EXISTS (SELECT 1 FROM refunds open_task_refund WHERE open_task_refund.shop_id=t.shop_id AND open_task_refund.id=open_task.refund_id AND open_task_refund.order_id=o.id) OR EXISTS (SELECT 1 FROM handoffs open_task_handoff WHERE open_task_handoff.shop_id=t.shop_id AND open_task_handoff.id=open_task.handoff_id AND (open_task_handoff.order_id=o.id OR open_task_handoff.day_used_order_id=o.id OR open_task_handoff.limit_used_order_id=o.id)))) OR EXISTS (SELECT 1 FROM handoffs open_handoff WHERE open_handoff.shop_id=t.shop_id AND open_handoff.status='open' AND (open_handoff.order_id=o.id OR open_handoff.day_used_order_id=o.id OR open_handoff.limit_used_order_id=o.id)))) AND t.last_customer_message_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** TASK-076: 현재 가게 설정의 끊김 시간이 지난 awaiting_owner 상담. */
  consultation_waiting: {
    table: "consultations",
    dueColumn: "last_customer_message_at",
    index: "consultations_waiting_idle_idx",
    find: "SELECT t.shop_id, t.id, t.last_customer_message_at AS due_at FROM consultations t WHERE t.status = 'awaiting_owner' AND EXISTS (SELECT 1 FROM shops s WHERE s.id = t.shop_id AND t.last_customer_message_at <= $1::timestamptz - s.idle_close_hours * interval '1 hour') AND NOT EXISTS (SELECT 1 FROM handoffs h WHERE h.shop_id = t.shop_id AND h.consultation_id = t.id AND h.status = 'open') AND t.last_customer_message_at <= $1 ORDER BY t.last_customer_message_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM consultations t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'awaiting_owner' AND EXISTS (SELECT 1 FROM shops s WHERE s.id = t.shop_id AND t.last_customer_message_at <= $3::timestamptz - s.idle_close_hours * interval '1 hour') AND NOT EXISTS (SELECT 1 FROM handoffs h WHERE h.shop_id = t.shop_id AND h.consultation_id = t.id AND h.status = 'open') AND t.last_customer_message_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** 사장님 답 기다림의 지연 안내 때(답하는 시간 안에서 셈, REQ-259). */
  owner_task_wait: {
    table: "owner_tasks",
    dueColumn: "wait_due_at",
    index: "owner_tasks_wait_due_idx",
    find: "SELECT t.shop_id, t.id, t.wait_due_at AS due_at FROM owner_tasks t WHERE t.wait_status = 'waiting' AND t.wait_due_at <= $1 ORDER BY t.wait_due_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM owner_tasks t WHERE t.shop_id = $1 AND t.id = $2 AND t.wait_status = 'waiting' AND t.wait_due_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** 열린 에스컬레이션 건(남긴 지 7일이면 답 없어 닫힘, REQ-216). 기준 시각은 지금 − 7일. */
  handoff_open: {
    table: "handoffs",
    dueColumn: "created_at",
    index: "handoffs_open_age_idx",
    find: "SELECT t.shop_id, t.id, t.created_at AS due_at FROM handoffs t WHERE t.status = 'open' AND t.created_at <= $1 ORDER BY t.created_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM handoffs t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'open' AND t.created_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** 결제 기한이 지난 결제 안내(첫 결제·다시 낸 결제, 나감만. 확인 요청됨·맞추는 중은 빠짐, SPEC-037). */
  payment_due: {
    table: "payment_requests",
    dueColumn: "due_at",
    index: "payment_requests_due_idx",
    find: "SELECT t.shop_id, t.id, t.due_at AS due_at FROM payment_requests t WHERE t.status = 'open' AND t.kind <> 'difference' AND t.due_at <= $1 ORDER BY t.due_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM payment_requests t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'open' AND t.kind <> 'difference' AND t.due_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** 결제 기한 상한이 지난 확인 요청(첫 결제·다시 낸 결제, REQ-223). */
  payment_claim_cap: {
    table: "payment_requests",
    dueColumn: "due_cap_at",
    index: "payment_requests_claim_cap_idx",
    find: "SELECT t.shop_id, t.id, t.due_cap_at AS due_at FROM payment_requests t WHERE t.status = 'claimed' AND t.kind <> 'difference' AND t.due_cap_at <= $1 ORDER BY t.due_cap_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM payment_requests t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'claimed' AND t.kind <> 'difference' AND t.due_cap_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** 기한이 지난 차액 결제 안내(SPEC-044, REQ-233). */
  difference_due: {
    table: "payment_requests",
    dueColumn: "due_at",
    index: "payment_requests_due_idx",
    find: "SELECT t.shop_id, t.id, t.due_at AS due_at FROM payment_requests t WHERE t.status = 'open' AND t.kind = 'difference' AND t.due_at <= $1 ORDER BY t.due_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM payment_requests t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'open' AND t.kind = 'difference' AND t.due_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** 결제 기한 상한(변경 마감)이 지난 차액 결제의 확인 요청(SPEC-044, REQ-223). */
  difference_claim_cap: {
    table: "payment_requests",
    dueColumn: "due_cap_at",
    index: "payment_requests_claim_cap_idx",
    find: "SELECT t.shop_id, t.id, t.due_cap_at AS due_at FROM payment_requests t WHERE t.status = 'claimed' AND t.kind = 'difference' AND t.due_cap_at <= $1 ORDER BY t.due_cap_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM payment_requests t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'claimed' AND t.kind = 'difference' AND t.due_cap_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** 보낼 사장님 알림(처음과 다시 보내기, G4). 새 행은 next_attempt_at을 넣어야 찾힌다. */
  owner_alert_send: {
    table: "owner_alerts",
    dueColumn: "next_attempt_at",
    index: "owner_alerts_due_idx",
    find: "SELECT t.shop_id, t.id, t.next_attempt_at AS due_at FROM owner_alerts t WHERE t.status = 'pending' AND t.next_attempt_at <= $1 ORDER BY t.next_attempt_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM owner_alerts t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'pending' AND t.next_attempt_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** 발송 결과를 조회할 사장님 알림(요청 뒤 1·5·30분, REQ-182). */
  owner_alert_check: {
    table: "owner_alerts",
    dueColumn: "requested_at",
    index: "owner_alerts_confirming_idx",
    find: "SELECT t.shop_id, t.id, t.requested_at AS due_at FROM owner_alerts t WHERE t.status = 'confirming' AND t.requested_at + CASE WHEN t.delivery_checked_at IS NULL THEN interval '1 minute' WHEN t.delivery_checked_at < t.requested_at + interval '5 minutes' THEN interval '5 minutes' ELSE interval '30 minutes' END <= $1 AND t.requested_at <= $1 ORDER BY t.requested_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM owner_alerts t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'confirming' AND t.requested_at + CASE WHEN t.delivery_checked_at IS NULL THEN interval '1 minute' WHEN t.delivery_checked_at < t.requested_at + interval '5 minutes' THEN interval '5 minutes' ELSE interval '30 minutes' END <= $3 AND t.requested_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** 보낼 손님 안내(처음과 다시 보내기, G4). 정해진 시각 안내는 scheduled_for와 next_attempt_at 둘 다 지나야 한다. 캘린더 변경 뒤의 임대/재시도 표도 보존한다. */
  notification_send: {
    table: "notifications",
    dueColumn: "next_attempt_at",
    index: "notifications_due_idx",
    find: "SELECT t.shop_id, t.id, t.next_attempt_at AS due_at FROM notifications t WHERE t.status IN ('pending', 'retrying') AND (t.scheduled_for IS NULL OR t.scheduled_for <= $1) AND t.next_attempt_at <= $1 ORDER BY t.next_attempt_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM notifications t WHERE t.shop_id = $1 AND t.id = $2 AND t.status IN ('pending', 'retrying') AND (t.scheduled_for IS NULL OR t.scheduled_for <= $3) AND t.next_attempt_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** 발송 결과를 조회할 손님 안내(요청 뒤 1·5·30분, REQ-182). */
  notification_check: {
    table: "notifications",
    dueColumn: "requested_at",
    index: "notifications_confirming_idx",
    find: "SELECT t.shop_id, t.id, t.requested_at AS due_at FROM notifications t WHERE t.status = 'confirming' AND t.requested_at + CASE WHEN t.delivery_checked_at IS NULL THEN interval '1 minute' WHEN t.delivery_checked_at < t.requested_at + interval '5 minutes' THEN interval '5 minutes' ELSE interval '30 minutes' END <= $1 AND t.requested_at <= $1 ORDER BY t.requested_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM notifications t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'confirming' AND t.requested_at + CASE WHEN t.delivery_checked_at IS NULL THEN interval '1 minute' WHEN t.delivery_checked_at < t.requested_at + interval '5 minutes' THEN interval '5 minutes' ELSE interval '30 minutes' END <= $3 AND t.requested_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  /** 적을 장부 쓰기(처음과 다시 적기 1분·5분·30분·2시간·6시간, 그 뒤 하루 한 번, SPEC-064). */
  ledger_write: {
    table: "ledger_writes",
    dueColumn: "next_attempt_at",
    index: "ledger_writes_due_idx",
    find: "SELECT t.shop_id, t.id, t.next_attempt_at AS due_at FROM ledger_writes t WHERE t.status IN ('pending', 'retrying', 'alerted') AND t.next_attempt_at <= $1 ORDER BY t.next_attempt_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM ledger_writes t WHERE t.shop_id = $1 AND t.id = $2 AND t.status IN ('pending', 'retrying', 'alerted') AND t.next_attempt_at <= $3 FOR UPDATE SKIP LOCKED",
  },
  ledger_audit: {
    table: "ledger_writes",
    dueColumn: "audit_due_at",
    index: "ledger_writes_audit_due_idx",
    find: "SELECT t.shop_id, t.id, t.audit_due_at AS due_at FROM ledger_writes t WHERE t.status = 'written' AND t.audit_due_at IS NOT NULL AND t.audit_due_at <= $1 ORDER BY t.audit_due_at, t.id LIMIT $2",
    claim:
      "SELECT t.id FROM ledger_writes t WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'written' AND t.audit_due_at IS NOT NULL AND t.audit_due_at <= $3 FOR UPDATE SKIP LOCKED",
  },
} as const satisfies Record<string, DueSource>;

export type DueSourceName = keyof typeof DUE_SOURCES;

export const DUE_SOURCE_NAMES = Object.keys(DUE_SOURCES) as DueSourceName[];

/**
 * 하루 한 번 일(지난 기록 지우기 03:00, SPEC-065)이 그날 시작했는지: 가게와 무관한 운영 기록(ops_events, TBL-051)의 그 종류
 * 마지막 시각. $1 종류(purge_run), $2 그날의 때, $3 다음 날의 때. 그날 안이면 기준 시각보다 뒤의 표시도 본다(늦게 도착한
 * 앞 분의 실행이 뒤 분의 시작을 못 보고 다시 시작하지 않게). 내용 없이 시각 하나만.
 */
export const LAST_DAILY_RUN =
  "SELECT max(t.created_at) AS last_at FROM ops_events t WHERE t.kind = $1 AND t.shop_id IS NULL AND t.created_at >= $2 AND t.created_at < $3";
