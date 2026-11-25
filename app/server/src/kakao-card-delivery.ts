import { readConfirmCardDelivery } from "./confirm-card-store";
import type { KakaoCallbackClaim } from "./kakao-callback-store";
import type { ShopRequestDb } from "./shop-scope";

/** 실제 보낼 카드만 선점·기한과 현재 버전으로 다시 읽습니다. 가게 범위 연결만 받습니다. */
export async function readClaimedKakaoCard(
  db: ShopRequestDb,
  messageId: string,
  claim: KakaoCallbackClaim,
  now: () => Date,
) {
  return db.transaction(async (tx) => {
    await tx.found("SELECT id FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE", [claim.customer_id]);
    await tx.found("SELECT id FROM consultations WHERE shop_id=$1 AND id=$2 AND customer_id=$3 FOR UPDATE", [
      claim.consultation_id,
      claim.customer_id,
    ]);
    const source = await tx.run(
      `SELECT id FROM messages WHERE shop_id=$1 AND id=$2 AND consultation_id=$3
        AND kakao_callback_enc=$4 AND kakao_callback_claim_until=$5 AND kakao_callback_deadline_at>$6 FOR UPDATE`,
      [messageId, claim.consultation_id, claim.kakao_callback_enc, claim.kakao_callback_claim_until, now()],
    );
    return source.rowCount === 1
      ? readConfirmCardDelivery(tx, {
          customerId: claim.customer_id,
          consultationId: claim.consultation_id,
          sourceMessageId: messageId,
          now: now(),
        })
      : null;
  });
}
