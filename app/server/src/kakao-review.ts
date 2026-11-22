/** TASK-028의 API-072 업무 중복 확인. 글 후기만 처리하며 사진/게시 동의의 전체 처리는 TASK-145가 이어간다. */
import { type AuthorizedKakaoSkill, kakaoReceiptKey } from "./kakao-skill-auth";
import type { ShopRequestDb } from "./shop-scope";

export type KakaoReviewOutcome =
  | "review_saved"
  | "review_not_allowed"
  | "review_invalid"
  | "duplicate"
  | "not_accepting";

export async function receiveKakaoTextReview(
  db: ShopRequestDb,
  request: AuthorizedKakaoSkill,
): Promise<KakaoReviewOutcome> {
  const { payload, receivedAt, channelId } = request;
  // 연결 확인 버튼은 업무 요청이 아니다. 사진이 있으면 글만 저장한 성공으로 오인하게 하지 않는다.
  if (
    payload.action.clientExtra.check !== undefined ||
    (payload.action.params.review_photos !== undefined && payload.action.params.review_photos !== "")
  )
    return "not_accepting";
  const receipt = await kakaoReceiptKey(request.requestKeySecret, payload, receivedAt, "review");
  return db.transaction(async (tx) => {
    const shop = await tx.run<{ booking_issued_at: Date | null }>(
      "SELECT booking_issued_at FROM shops WHERE id = $1 FOR SHARE",
    );
    if (shop.rows[0]?.booking_issued_at == null) return "not_accepting";
    const channel = await tx.run(
      "SELECT id FROM kakao_channels WHERE shop_id = $1 AND id = $2 AND status = 'linked' FOR SHARE",
      [channelId],
    );
    if (channel.rowCount === 0) return "not_accepting";
    const text = payload.action.params.review_text;
    if (typeof text !== "string" || !text.trim() || [...text].length > 1000 || text.includes("\0"))
      return "review_invalid";
    const customers = await tx.run<{ id: string }>(
      "SELECT id FROM customers WHERE shop_id = $1 AND kakao_channel_id = $2 AND kakao_user_key = $3 FOR UPDATE",
      [channelId, payload.userId],
    );
    const customerId = customers.rows[0]?.id;
    if (customerId === undefined) return "review_not_allowed";
    await tx.run(
      `UPDATE customers SET channel_friend = $3, friend_checked_at = $4
        WHERE shop_id = $1 AND id = $2 AND (friend_checked_at IS NULL OR friend_checked_at <= $4)`,
      [customerId, payload.isFriend, receivedAt],
    );
    if ((await tx.run("SELECT id FROM messages WHERE shop_id = $1 AND kakao_message_id = $2", [receipt])).rowCount > 0)
      return "duplicate";

    const orderNo = payload.action.clientExtra.orderNo;
    if (orderNo !== undefined && (typeof orderNo !== "string" || !/^[0-9A-Z]{6,8}$/.test(orderNo)))
      return "review_not_allowed";
    const orders =
      typeof orderNo === "string"
        ? await tx.run<{ id: string; consultation_id: string }>(
            `SELECT id, consultation_id FROM orders WHERE shop_id = $1 AND customer_id = $2 AND order_no = $3
            AND status = 'received' AND personal_data_purged_at IS NULL FOR SHARE`,
            [customerId, orderNo],
          )
        : await tx.run<{ id: string; consultation_id: string }>(
            `SELECT o.id, o.consultation_id FROM orders o WHERE o.shop_id = $1 AND o.customer_id = $2
            AND o.status = 'received' AND o.personal_data_purged_at IS NULL AND o.id = (
              SELECT n.order_id FROM notifications n WHERE n.shop_id = $1 AND n.customer_id = $2
                AND n.kind = 'review_request' AND n.status IN ('sent', 'delivered_on_reply') AND n.sent_at <= $3
              ORDER BY n.sent_at DESC, n.id DESC LIMIT 1) FOR SHARE`,
            [customerId, receivedAt],
          );
    const order = orders.rows[0];
    if (order === undefined) return "review_not_allowed";
    const saved = await tx.run(
      `INSERT INTO messages (shop_id, consultation_id, direction, author, kind, kakao_message_id, body_masked, created_at)
        VALUES ($1, $2, 'inbound', 'customer', 'card', $3, '후기 제출', $4)
        ON CONFLICT (shop_id, kakao_message_id) DO NOTHING RETURNING id`,
      [order.consultation_id, receipt, receivedAt],
    );
    if (saved.rowCount === 0) return "duplicate";
    const versions = await tx.run<{ version: number }>(
      "SELECT coalesce(max(version), 0)::integer AS version FROM reviews WHERE shop_id = $1 AND order_id = $2",
      [order.id],
    );
    await tx.run(
      "UPDATE reviews SET superseded_at = $3 WHERE shop_id = $1 AND order_id = $2 AND superseded_at IS NULL",
      [order.id, receivedAt],
    );
    await tx.run("INSERT INTO reviews (shop_id, order_id, version, body, created_at) VALUES ($1, $2, $3, $4, $5)", [
      order.id,
      (versions.rows[0]?.version ?? 0) + 1,
      text,
      receivedAt,
    ]);
    return "review_saved";
  });
}
