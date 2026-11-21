/** TASK-158: 여러 가게에서 지울 후보의 ID와 시각만 찾는다. 내용 읽기·쓰기는 가게 범위에서 다시 확인한다. */
export const PURGE_SOURCES = {
  orders: {
    phase: 1,
    sql: `SELECT t.shop_id, t.id, t.finished_at AS due_at FROM orders t
      WHERE t.personal_data_purged_at IS NULL AND t.finished_at <= $1::timestamptz - interval '30 days'
        AND NOT (t.id = ANY($3::uuid[]))
      ORDER BY t.finished_at, t.id LIMIT $2`,
  },
  ended: {
    phase: 2,
    sql: `SELECT t.shop_id, t.id, t.ended_at AS due_at FROM consultations t
      WHERE t.status = 'ended' AND t.ended_at <= $1::timestamptz - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM handoffs h WHERE h.shop_id = t.shop_id AND h.consultation_id = t.id AND h.status = 'open')
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shop_id = t.shop_id AND o.personal_data_purged_at IS NULL
          AND (o.consultation_id = t.id
            OR o.id IN (SELECT cc.order_id FROM confirm_cards cc WHERE cc.shop_id = t.shop_id AND cc.consultation_id = t.id)
            OR o.id IN (SELECT ide.order_id FROM issue_details ide WHERE ide.shop_id = t.shop_id AND ide.consultation_id = t.id)
            OR o.id IN (SELECT hr.order_id FROM handoffs hr WHERE hr.shop_id = t.shop_id AND hr.consultation_id = t.id)
            OR o.id IN (SELECT hd.day_used_order_id FROM handoffs hd WHERE hd.shop_id = t.shop_id AND hd.consultation_id = t.id)
            OR o.id IN (SELECT hl.limit_used_order_id FROM handoffs hl WHERE hl.shop_id = t.shop_id AND hl.consultation_id = t.id)
            OR o.id IN (SELECT hq.order_id FROM handoff_questions hq JOIN handoffs hj ON hj.shop_id = t.shop_id AND hj.id = hq.handoff_id
                         WHERE hq.shop_id = t.shop_id AND hj.consultation_id = t.id)
            OR o.id IN (SELECT no.order_id FROM notifications no WHERE no.shop_id = t.shop_id AND no.consultation_id = t.id)))
        AND NOT (t.id = ANY($3::uuid[]))
      ORDER BY t.ended_at, t.id LIMIT $2`,
  },
  dropped: {
    phase: 2,
    sql: `SELECT t.shop_id, t.id, t.dropped_at AS due_at FROM consultations t
      WHERE t.status = 'dropped' AND t.dropped_at <= $1::timestamptz - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM handoffs h WHERE h.shop_id = t.shop_id AND h.consultation_id = t.id AND h.status = 'open')
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shop_id = t.shop_id AND o.personal_data_purged_at IS NULL
          AND (o.consultation_id = t.id
            OR o.id IN (SELECT cc.order_id FROM confirm_cards cc WHERE cc.shop_id = t.shop_id AND cc.consultation_id = t.id)
            OR o.id IN (SELECT ide.order_id FROM issue_details ide WHERE ide.shop_id = t.shop_id AND ide.consultation_id = t.id)
            OR o.id IN (SELECT hr.order_id FROM handoffs hr WHERE hr.shop_id = t.shop_id AND hr.consultation_id = t.id)
            OR o.id IN (SELECT hd.day_used_order_id FROM handoffs hd WHERE hd.shop_id = t.shop_id AND hd.consultation_id = t.id)
            OR o.id IN (SELECT hl.limit_used_order_id FROM handoffs hl WHERE hl.shop_id = t.shop_id AND hl.consultation_id = t.id)
            OR o.id IN (SELECT hq.order_id FROM handoff_questions hq JOIN handoffs hj ON hj.shop_id = t.shop_id AND hj.id = hq.handoff_id
                         WHERE hq.shop_id = t.shop_id AND hj.consultation_id = t.id)
            OR o.id IN (SELECT no.order_id FROM notifications no WHERE no.shop_id = t.shop_id AND no.consultation_id = t.id)))
        AND NOT (t.id = ANY($3::uuid[]))
      ORDER BY t.dropped_at, t.id LIMIT $2`,
  },
  issue: {
    phase: 3,
    sql: `SELECT t.shop_id, t.id, t.issue_keep_until AS due_at FROM kept_records t
      WHERE t.issue_purged_at IS NULL AND t.issue_keep_until <= $1
        AND NOT (t.id = ANY($3::uuid[]))
      ORDER BY t.issue_keep_until, t.id LIMIT $2`,
  },
  contract: {
    phase: 3,
    sql: `SELECT t.shop_id, t.id, t.contract_keep_until AS due_at FROM kept_records t
      WHERE (t.issue_keep_until IS NULL OR t.issue_purged_at IS NOT NULL) AND t.contract_keep_until <= $1
        AND NOT (t.id = ANY($3::uuid[]))
      ORDER BY t.contract_keep_until, t.id LIMIT $2`,
  },
  customers: {
    phase: 4,
    sql: `SELECT t.shop_id, t.id, t.created_at AS due_at FROM customers t
      WHERE t.kakao_user_key IS NOT NULL AND t.created_at <= $1
        AND NOT EXISTS (SELECT 1 FROM consultations c WHERE c.shop_id = t.shop_id AND c.customer_id = t.id AND c.status <> 'deleted')
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shop_id = t.shop_id AND o.customer_id = t.id AND o.personal_data_purged_at IS NULL)
        AND NOT (t.id = ANY($3::uuid[]))
      ORDER BY t.created_at, t.id LIMIT $2`,
  },
  access: {
    phase: 5,
    sql: `SELECT t.shop_id, t.id, t.accessed_at AS due_at FROM access_logs t
      WHERE t.accessed_at <= least($1::timestamptz, now()) - interval '2 years'
        AND NOT (t.id = ANY($3::uuid[]))
      ORDER BY t.accessed_at, t.id LIMIT $2`,
  },
  tools: {
    phase: 7,
    sql: `SELECT t.shop_id, t.id, t.called_at AS due_at FROM ai_tool_calls t
      WHERE t.called_at <= $1::timestamptz - interval '30 days'
        AND NOT (t.id = ANY($3::uuid[]))
      ORDER BY t.called_at, t.id LIMIT $2`,
  },
  files: {
    phase: 8,
    sql: `SELECT t.shop_id, t.id, t.queued_at AS due_at FROM file_deletions t
      WHERE t.queued_at <= $1 AND (t.last_tried_at IS NULL OR (t.last_tried_at AT TIME ZONE 'Asia/Seoul')::date < ($1::timestamptz AT TIME ZONE 'Asia/Seoul')::date)
        AND NOT (t.id = ANY($3::uuid[]))
      ORDER BY t.queued_at, t.id LIMIT $2`,
  },
} as const;

export type PurgeSourceName = keyof typeof PURGE_SOURCES;

/** 다른 가게의 내용 없이 전체 삭제 대기 건수만 남긴다. */
export const PURGE_PENDING_FILES = "SELECT count(*)::int AS count FROM file_deletions";

/** 정적 검사와 실행기가 함께 적용하는 후보 읽기의 겉 형식. 하위 질의도 ID나 존재 여부만 읽는다. */
export function isPurgeFindSql(sql: string): boolean {
  const normalized = sql.replace(/\s+/g, " ").trim();
  return (
    /^SELECT t\.shop_id, t\.id, t\.([a-z_]+) AS due_at FROM (orders|consultations|kept_records|customers|access_logs|ai_tool_calls|file_deletions) t WHERE .+ ORDER BY t\.\1, t\.id LIMIT \$2$/.test(
      normalized,
    ) &&
    !/\b(insert|update|delete|union|intersect|except|returning)\b/i.test(normalized) &&
    [...normalized.matchAll(/\bSELECT (.*?) FROM\b/gi)].every(
      (m, i) => i === 0 || /^(1|[a-z_]+\.(id|order_id|day_used_order_id|limit_used_order_id))$/i.test(m[1] ?? ""),
    )
  );
}
