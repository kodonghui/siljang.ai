import type { RequestDb } from "../../src/db";
import type { ShopFixture } from "./shops";

/** 고정 시험 시각에 유효한 서버 견적과 취소 조문을 준비한다. 실제 업무/모델 호출은 없다. */
export async function prepareOrderCardSource(db: RequestDb, shop: ShopFixture, now: Date) {
  await db.query(
    "UPDATE quotes SET quoted_at=$3::timestamptz-interval '1 second',valid_until=$3::timestamptz+interval '72 hours',draft_revision=(SELECT revision FROM order_drafts WHERE shop_id=$1 AND id=$4) WHERE shop_id=$1 AND id=$2",
    [shop.shopId, shop.quoteId, now, shop.draftId],
  );
  await db.query(
    "INSERT INTO rule_clauses (shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) SELECT $1,$2,'pre_production_cancel',1,'합성 제작 전 취소','시작 전','수수료를 빼고 환불' WHERE NOT EXISTS(SELECT 1 FROM rule_clauses WHERE shop_id=$1 AND operating_rules_id=$2 AND clause_key='pre_production_cancel')",
    [shop.shopId, shop.operatingRulesId],
  );
}
