/** 만료된 콜백의 식별자만 찾는다. 내용은 가게 범위 안에서 읽고 쓴다. */
export const EXPIRED_KAKAO_CALLBACKS = `SELECT t.shop_id, t.id, t.kakao_callback_deadline_at AS due_at
  FROM messages t
  WHERE t.direction = 'inbound' AND t.kakao_callback_enc IS NOT NULL
    AND t.kakao_callback_deadline_at <= $1
  ORDER BY t.kakao_callback_deadline_at, t.id LIMIT $2`;
