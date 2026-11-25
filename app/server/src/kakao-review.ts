/** API072의 같은 사용자·받은 주문 확인을 글/사진 수신에서 공유합니다. */
import { type AuthorizedKakaoSkill, kakaoReceiptKey } from "./kakao-skill-auth";
import type { ShopDb, ShopRequestDb } from "./shop-scope";

export type KakaoReviewOutcome =
  | "review_saved"
  | "review_not_allowed"
  | "review_invalid"
  | "duplicate"
  | "not_accepting";
export interface KakaoReviewReceipt {
  readonly orderId: string;
  readonly consultationId: string;
  readonly customerId: string;
  readonly messageId: string;
  readonly text: string;
}

export async function receiveKakaoTextReview(
  db: ShopRequestDb,
  request: AuthorizedKakaoSkill,
): Promise<KakaoReviewOutcome> {
  const { payload, receivedAt } = request;
  if (
    payload.action.clientExtra.check !== undefined ||
    (payload.action.params.review_photos !== undefined && payload.action.params.review_photos !== "")
  )
    return "not_accepting";
  const key = await kakaoReceiptKey(request.requestKeySecret, payload, receivedAt, "review");
  return db.transaction(async (tx) => {
    const receipt = await prepareKakaoReview(tx, request, key);
    if (typeof receipt === "string") return receipt;
    await saveKakaoReview(tx, receipt.orderId, receipt.text, receivedAt);
    return "review_saved";
  });
}

export async function prepareKakaoReview(
  tx: ShopDb,
  request: AuthorizedKakaoSkill,
  receiptKey: string,
  photo = false,
): Promise<KakaoReviewReceipt | KakaoReviewOutcome> {
  const { payload, receivedAt, channelId } = request;
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
  if ((await tx.run("SELECT id FROM messages WHERE shop_id = $1 AND kakao_message_id = $2", [receiptKey])).rowCount > 0)
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
  const saved = await tx.run<{ id: string }>(
    `INSERT INTO messages (shop_id, consultation_id, direction, author, kind, kakao_message_id, body_masked, created_at)
    VALUES ($1, $2, 'inbound', 'customer', $3, $4, '후기 제출', $5)
    ON CONFLICT (shop_id, kakao_message_id) DO NOTHING RETURNING id`,
    [order.consultation_id, photo ? "text" : "card", receiptKey, receivedAt],
  );
  if (saved.rowCount === 0) return "duplicate";

  const messageId = saved.rows[0]?.id;
  if (messageId === undefined) throw new Error("review receipt unavailable");
  return { orderId: order.id, consultationId: order.consultation_id, customerId, messageId, text };
}

/** 비동기 사진 처리가 늦게 끝나도 더 최근에 받은 후기의 현재 표시를 되돌리지 않습니다. */
export async function saveKakaoReview(
  tx: ShopDb,
  orderId: string,
  text: string,
  receivedAt: Date,
  source: "text" | "photo" = "text",
): Promise<string> {
  const versions = await tx.found<{ version: number }>(
    "SELECT coalesce(max(version),0)::integer AS version FROM reviews WHERE shop_id=$1 AND order_id=$2",
    [orderId],
  );
  // 사진용 추가 권한을 적용하기 전에도 기존 글 후기는 원래의 열 권한으로 처리한다.
  if (source === "text") {
    await tx.run("UPDATE reviews SET superseded_at=$3 WHERE shop_id=$1 AND order_id=$2 AND superseded_at IS NULL", [
      orderId,
      receivedAt,
    ]);
    return (
      await tx.found<{ id: string }>(
        "INSERT INTO reviews(shop_id,order_id,version,body,created_at) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [orderId, versions.version + 1, text, receivedAt],
      )
    ).id;
  }
  const current = (
    await tx.run<{ created_at: Date }>(
      "SELECT created_at FROM reviews WHERE shop_id=$1 AND order_id=$2 AND superseded_at IS NULL ORDER BY version DESC LIMIT 1 FOR UPDATE",
      [orderId],
    )
  ).rows[0];
  await tx.run(
    "UPDATE reviews SET superseded_at=$3 WHERE shop_id=$1 AND order_id=$2 AND superseded_at IS NULL AND created_at<=$3",
    [orderId, receivedAt],
  );
  const supersededAt = current !== undefined && current.created_at > receivedAt ? current.created_at : null;
  const row = await tx.found<{ id: string }>(
    "INSERT INTO reviews(shop_id,order_id,version,body,created_at,superseded_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    [orderId, versions.version + 1, text, receivedAt, supersededAt],
  );
  return row.id;
}
