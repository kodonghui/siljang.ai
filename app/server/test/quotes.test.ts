import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { quoteDraft } from "../src/quotes";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-23T12:00:00Z");
describeDb("가게 가격표로 계산하는 견적(TASK-067)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    const base = await createShop(isolated.db, "합성 견적 가게");
    const draftId = newUuid();
    const selected = (
      await isolated.db.query<{ size_option_id: string; flavor_option_id: string }>(
        "SELECT size_option_id,flavor_option_id FROM order_drafts WHERE id=$1",
        [base.draftId],
      )
    ).rows[0];
    if (!selected) throw new Error("합성 초안이 없어요");
    await isolated.db.query(
      "INSERT INTO order_drafts (id,shop_id,consultation_id,price_list_id,size_option_id,flavor_option_id) VALUES ($1,$2,$3,$4,$5,$6)",
      [draftId, base.shopId, base.consultationId, base.priceListId, selected.size_option_id, selected.flavor_option_id],
    );
    shop = { ...base, draftId };
    await isolated.db.query("UPDATE price_lists SET version=3 WHERE id=$1", [shop.priceListId]);
    await isolated.db.query("UPDATE operating_rules SET version=2 WHERE id=$1", [shop.operatingRulesId]);
    await isolated.db.query("UPDATE orders SET requested_at=$2 WHERE id=$1", [shop.orderId, NOW]);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "quote" }), isolated.db);
  const quote = (selection?: { size?: string }) =>
    quoteDraft(scoped(), {
      draftId: shop.draftId,
      sourceMessageId: shop.messageId,
      now: NOW,
      ...(selection ? { selection } : {}),
    });
  it("1호 생크림은35000원·확정·버전3과 안내 뒤72시간이다", async () => {
    expect(await quote()).toMatchObject({
      kind: "quoted",
      quote: {
        amount: 35000,
        displayKind: "fixed",
        orderKind: "standard",
        priceListVersion: 3,
        operatingRulesVersion: 2,
        validUntil: new Date(NOW.getTime() + 72 * 3600000).toISOString(),
      },
    });
  });
  it("가격표에 없는3단은 금액 없이 사장님에게 넘긴다", async () => {
    const result = await quote({ size: "3단" });
    expect(result).toMatchObject({ kind: "cannot_calculate" });
    expect(JSON.stringify(result)).not.toContain('"amount":');
    expect(
      (await isolated.db.query("SELECT reason FROM handoffs WHERE consultation_id=$1", [shop.consultationId])).rows,
    ).toEqual([{ reason: "cannot_answer" }]);
  });
  it("35000원 기본과 범위 밖50000원부터 디자인은85000원부터 맞춤이다", async () => {
    await isolated.db.query("UPDATE price_options SET price_kind='from',amount=50000,in_standard=false WHERE id=$1", [
      shop.designOptionId,
    ]);
    await isolated.db.query("UPDATE order_drafts SET design_option_id=$2 WHERE id=$1", [
      shop.draftId,
      shop.designOptionId,
    ]);
    expect(await quote()).toMatchObject({
      kind: "quoted",
      quote: { amount: 85000, displayKind: "from", orderKind: "custom" },
    });
  });
  it("기본 옵션뿐이어도 참고 사진이 있으면 확정 금액의 맞춤이다", async () => {
    const id = newUuid();
    await isolated.db.query(
      "INSERT INTO messages (id,shop_id,consultation_id,direction,author,kind,kakao_message_id) VALUES ($1,$2,$3,'inbound','customer','photo',$4)",
      [id, shop.shopId, shop.consultationId, `synthetic:${id}`],
    );
    await isolated.db.query(
      "INSERT INTO reference_photos (shop_id,draft_id,message_id,storage_key,content_type,byte_size) VALUES ($1,$2,$3,'synthetic/photo.jpg','image/jpeg',10)",
      [shop.shopId, shop.draftId, id],
    );
    expect(await quote()).toMatchObject({
      kind: "quoted",
      quote: { amount: 35000, displayKind: "fixed", orderKind: "custom" },
    });
  });
  it("새 가격표/규정이 생겨도 요청한 주문은 받은 버전으로 계산한다", async () => {
    await isolated.db.query("UPDATE order_drafts SET status='submitted' WHERE id=$1", [shop.draftId]);
    await isolated.db.query("UPDATE orders SET draft_id=$2 WHERE id=$1", [shop.orderId, shop.draftId]);
    await isolated.db.query("UPDATE price_lists SET superseded_at=$2 WHERE id=$1", [shop.priceListId, NOW]);
    await isolated.db.query("UPDATE operating_rules SET superseded_at=$2 WHERE id=$1", [shop.operatingRulesId, NOW]);
    const price = newUuid(),
      rules = newUuid();
    await isolated.db.query("INSERT INTO price_lists (id,shop_id,version) VALUES ($1,$2,4)", [price, shop.shopId]);
    await isolated.db.query(
      "INSERT INTO price_options (shop_id,price_list_id,option_group,name,amount) VALUES ($1,$2,'size','1호',38000)",
      [shop.shopId, price],
    );
    await isolated.db.query(
      "INSERT INTO operating_rules (id,shop_id,version,change_deadline_hours,date_change_refund_basis) VALUES ($1,$2,3,24,'original_pickup')",
      [rules, shop.shopId],
    );
    expect(await quote()).toMatchObject({
      kind: "quoted",
      quote: { amount: 35000, priceListVersion: 3, operatingRulesVersion: 2 },
    });
    expect(
      (await isolated.db.query("SELECT operating_rules_id FROM orders WHERE id=$1", [shop.orderId])).rows[0]
        ?.operating_rules_id,
    ).toBe(shop.operatingRulesId);
  });
  it("옵션 합계가0원이면 견적을 남기지 않고 cannot_answer로 넘긴다", async () => {
    await isolated.db.query("UPDATE price_options SET amount=0 WHERE price_list_id=$1", [shop.priceListId]);
    expect(await quote()).toMatchObject({ kind: "cannot_calculate" });
    expect(
      (
        await isolated.db.query("SELECT count(*)::int AS n FROM quotes WHERE draft_id=$1 AND id<>$2", [
          shop.draftId,
          shop.quoteId,
        ])
      ).rows[0]?.n,
    ).toBe(0);
    expect(
      (await isolated.db.query("SELECT reason FROM handoffs WHERE consultation_id=$1", [shop.consultationId])).rows,
    ).toEqual([{ reason: "cannot_answer" }]);
  });
});
