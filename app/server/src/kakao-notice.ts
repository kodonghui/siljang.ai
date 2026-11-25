/** API-073의 일반 안내 읽기. 스킬 응답 생성은 발송 결과 확인과 구분한다. */
import { customerNoticeContents, READABLE_CUSTOMER_NOTICE_KINDS } from "./customer-notice-content";
import { kakaoConsultationMessage } from "./kakao-consultation-message";
import { kakaoReply } from "./kakao-reply";
import type { ShopRequest } from "./routes";
import { ForgedScopeError, isUuid } from "./shop-scope";

export async function receiveKakaoNotice(r: ShopRequest): Promise<Response> {
  const request = r.kakaoSkill;
  if (request === undefined || request.scope !== r.scope)
    throw new ForgedScopeError("missing authorized Kakao skill scope");
  const key = request.payload.params.noticeKey;
  if (request.status !== "linked" || !isUuid(key)) return kakaoReply(r, "notice_gone");
  const now = r.services.now();
  const row = (
    await r.db.run<{ body: string; kind: string; customer_id: string }>(
      `SELECT n.body,n.kind,n.customer_id FROM notifications n
      JOIN customers u ON u.shop_id=$1 AND u.id=n.customer_id AND u.kakao_channel_id=$3 AND u.kakao_user_key=$4
      JOIN consultations c ON c.shop_id=$1 AND c.id=n.consultation_id AND c.customer_id=u.id
      LEFT JOIN orders o ON o.shop_id=$1 AND o.id=n.order_id
      WHERE n.shop_id=$1 AND n.id=$2 AND n.kind=ANY($5::text[]) AND n.status<>'dropped'
        AND c.status<>'deleted' AND o.personal_data_purged_at IS NULL
        AND (n.scheduled_for IS NULL OR n.scheduled_for<=$6)
        AND (n.order_id IS NULL OR o.customer_id=n.customer_id)
        AND (n.kind<>'order_confirmed' OR o.status IN ('confirmed','received','no_pickup'))`,
      [key, request.channelId, request.payload.userId, READABLE_CUSTOMER_NOTICE_KINDS, now],
    )
  ).rows[0];
  if (!row?.body.trim()) return kakaoReply(r, "notice_gone");
  const contents = await customerNoticeContents(
    r.db,
    { id: key, customerId: row.customer_id, kind: row.kind, body: row.body },
    now,
    () => r.services.fieldCrypto(),
  );
  if (!contents?.length) return kakaoReply(r, "notice_gone");
  return r.json(kakaoConsultationMessage({ state: "normal", contents }), 200, {
    "Siljang-Outcome": "notice_shown",
    "Cache-Control": "no-store",
  });
}
