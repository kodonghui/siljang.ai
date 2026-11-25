import { SKILL_WORK_MS } from "./kakao-callback";
import { claimKakaoCallback, finishKakaoCallback } from "./kakao-callback-store";
import { KAKAO_PHOTO_TEXT } from "./kakao-photo-context";
import { runKakaoPhotoTurn, storeKakaoPhotoContext } from "./kakao-photo-turn";
import { kakaoReply } from "./kakao-reply";
import { prepareKakaoReview } from "./kakao-review";
import { kakaoReviewPhotoUrls } from "./kakao-review-photos";
import { kakaoReceiptKey } from "./kakao-skill-auth";
import type { ShopRequest } from "./routes";

/** API072의 사진은 받은 자기 주문을 확인한 뒤 내려받으며, 부분 글 후기 성공을 남기지 않습니다. */
export async function receiveKakaoPhotoReview(r: ShopRequest): Promise<Response> {
  const request = r.kakaoSkill;
  if (request === undefined) throw new Error("photo review request unavailable");
  const started = performance.now(),
    left = () => Math.max(0, SKILL_WORK_MS - (performance.now() - started));
  const urls = kakaoReviewPhotoUrls(request.payload.action.params.review_photos, request.receivedAt);
  if (typeof urls === "string") return kakaoReply(r, urls);
  const key = await kakaoReceiptKey(request.requestKeySecret, request.payload, request.receivedAt, "review");
  const prepared = await r.db.transaction(async (tx) => {
    const receipt = await prepareKakaoReview(tx, request, key, true);
    if (typeof receipt === "string") {
      if (receipt !== "duplicate") return kakaoReply(r, receipt, { repeatReview: true });
      const result = (
        await tx.run<{ body_masked: string }>(
          `SELECT o.body_masked FROM messages i JOIN messages o ON o.shop_id=$1 AND o.consultation_id=i.consultation_id AND o.trace_id=i.id::text
          WHERE i.shop_id=$1 AND i.kakao_message_id=$2 AND o.direction='outbound' AND o.author='system' AND o.kind='photo' ORDER BY o.created_at,o.id LIMIT 1`,
          [key],
        )
      ).rows[0];
      const text =
        result === undefined
          ? "사진을 확인하고 있어요"
          : (Object.values(KAKAO_PHOTO_TEXT).find((value) => value === result.body_masked) ?? "사진을 확인하고 있어요");
      return kakaoReply(r, "duplicate", { repeatReview: true, repeatReviewText: text });
    }
    const envelope = await storeKakaoPhotoContext(
      tx,
      receipt.messageId,
      {
        kind: "review",
        urls,
        review: {
          orderId: receipt.orderId,
          text: receipt.text,
          consent: request.payload.action.params.photo_consent === "동의",
        },
      },
      r.services,
      request.receivedAt,
    );
    return { receipt, envelope };
  });
  if (prepared instanceof Response) return prepared;
  const claim = await claimKakaoCallback(r.db, prepared.receipt.messageId, r.services.now());
  if (claim === null || claim === "busy") {
    await r.db.transaction(async (tx) => {
      await tx.run("SELECT id FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE", [prepared.receipt.customerId]);
      const cleared = await tx.run(
        `UPDATE messages SET kakao_callback_enc=NULL,kakao_callback_deadline_at=NULL,kakao_callback_claim_until=NULL,kind='card'
        WHERE shop_id=$1 AND id=$2 AND kakao_callback_enc=$3 AND kakao_callback_claim_until IS NULL`,
        [prepared.receipt.messageId, prepared.envelope],
      );
      if (cleared.rowCount === 1)
        await tx.run(
          `INSERT INTO messages(shop_id,consultation_id,direction,author,kind,body_masked,trace_id,delivery,sent_at)
        VALUES($1,$2,'outbound','system','photo',$3,$4,'delivered_later',$5)`,
          [
            prepared.receipt.consultationId,
            KAKAO_PHOTO_TEXT.photo_download_failed,
            prepared.receipt.messageId,
            r.services.now(),
          ],
        );
    });
    return kakaoReply(r, "photo_download_failed");
  }
  const turn = await runKakaoPhotoTurn(r.db, prepared.receipt.messageId, claim, r.services, r.services.now, {
    budgetMs: Math.max(1, left() - 150),
  });
  if (turn.kind !== "reply") return kakaoReply(r, "photo_download_failed");
  const response = kakaoReply(r, turn.reply.outcome);
  await finishKakaoCallback(
    r.db,
    prepared.receipt.messageId,
    claim,
    turn.reply.text,
    r.services.now(),
    [],
    turn.reply.id,
  );
  return response;
}
