import type { RequestDb } from "../../src/db";
import { newUuid } from "./db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./shops";

/** 완성·후기 사진의 동의와 게시를 갖춘 합성 자료. 외부 발신은 하지 않는다. */
export async function createConsentWithdrawalFixture(db: RequestDb, now: Date) {
  let shop: ShopFixture, review: string, completionConsent: string, reviewConsent: string;
  shop = await createShop(db, "합성 철회 카드 가게");
  await issueTestBookingLink(db, shop);
  await linkTestChannel(db, shop.channelId);
  const payment = newUuid(),
    production = newUuid(),
    completion = newUuid(),
    photo = newUuid();
  review = newUuid();
  completionConsent = newUuid();
  reviewConsent = newUuid();
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE payment_requests SET status='paid',arrived_amount=amount,arrived_at=$2,paid_at=$2 WHERE id=$1",
      [shop.paymentRequestId, now],
    );
    await tx.query(
      "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
      [payment, shop.shopId, shop.orderId, shop.paymentRequestId, now],
    );
    await tx.query(
      "UPDATE orders SET status='received',confirmed_at=$2,confirmed_payment_id=$3,finished_at=$2 WHERE id=$1",
      [shop.orderId, now, payment],
    );
    await tx.query(
      "INSERT INTO productions(id,shop_id,order_id,completed_at,handed_over_at,handover_kind) VALUES($1,$2,$3,$4,$4,'pickup')",
      [production, shop.shopId, shop.orderId, now],
    );
    await tx.query(
      "INSERT INTO completion_photos(id,shop_id,production_id,position,storage_key,content_type,byte_size) VALUES($1,$2,$3,1,'synthetic/completion.jpg','image/jpeg',1)",
      [completion, shop.shopId, production],
    );
    await tx.query("INSERT INTO reviews(id,shop_id,order_id,version,body) VALUES($1,$2,$3,1,'합성 후기')", [
      review,
      shop.shopId,
      shop.orderId,
    ]);
    await tx.query(
      "INSERT INTO review_photos(id,shop_id,review_id,position,storage_key,content_type,byte_size) VALUES($1,$2,$3,1,'synthetic/review.jpg','image/jpeg',1)",
      [photo, shop.shopId, review],
    );
    await tx.query(
      "INSERT INTO photo_consents(id,shop_id,order_id,scope,completion_photo_id,consented,publishable) VALUES($1,$2,$3,'completion_photo',$4,true,true)",
      [completionConsent, shop.shopId, shop.orderId, completion],
    );
    await tx.query(
      "INSERT INTO photo_consents(id,shop_id,order_id,scope,review_photo_id,consented,publishable) VALUES($1,$2,$3,'review_photo',$4,true,true)",
      [reviewConsent, shop.shopId, shop.orderId, photo],
    );
    await tx.query(
      "INSERT INTO portfolio_items(shop_id,photo_consent_id,completion_photo_id,consent_live) VALUES($1,$2,$3,true)",
      [shop.shopId, completionConsent, completion],
    );
  });
  return { shop, review, completionConsent, reviewConsent };
}
