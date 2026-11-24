/** 네 경로의 수신 글 연결 조건. h는 같은 가게로 거른 handoffs다. */
export function handoffSourceMatch(source: "$2" | "$3" | "m.id"): string {
  if (!["$2", "$3", "m.id"].includes(source)) throw new TypeError("invalid handoff source expression");
  return `(h.source_message_id=${source} OR EXISTS (
    SELECT 1 FROM owner_tasks hs WHERE hs.shop_id=$1 AND hs.handoff_id IS NOT NULL AND hs.handoff_id=h.id
      AND coalesce(hs.detail->'closedDaySourceIds','[]'::jsonb) ? (${source})::text
    ) OR h.id IN (SELECT q.handoff_id FROM handoff_questions q WHERE q.shop_id=$1 AND q.message_id=${source}))`;
}

/** 날짜 판정 두 조회가 같은 가게·확인 건으로 할 일을 이읍니다. */
export const HANDOFF_OWNER_TASK_JOIN = "LEFT JOIN owner_tasks t ON t.shop_id=$1 AND t.handoff_id=h.id";
