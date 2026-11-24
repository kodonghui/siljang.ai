import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { customerQuote, quoteDraft } from "../src/quotes";
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
    await isolated.db.query(
      "INSERT INTO business_calendars (shop_id,daily_capacity,order_cutoff_days,order_cutoff_time) VALUES ($1,10,2,'18:00')",
      [base.shopId],
    );
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
  const quote = (selection?: { size?: string; design?: string; extras?: readonly string[] }) =>
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

  it("같은 금액이어도 다른 선택/주문 종류의 견적을 이전 ID로 재사용하지 않는다", async () => {
    const first = await quote();
    if (first.kind !== "quoted") throw new Error("첫 합성 견적이 없어요");
    await isolated.db.query(
      "INSERT INTO price_options (shop_id,price_list_id,option_group,name,amount,in_standard) VALUES ($1,$2,'design','무료 맞춤',0,false)",
      [shop.shopId, shop.priceListId],
    );
    const second = await quote({ design: "무료 맞춤" });
    if (second.kind !== "quoted") throw new Error("둘째 합성 견적이 없어요");
    expect(second.quote.id).not.toBe(first.quote.id);
    expect(second.quote).toMatchObject({ amount: 35000, orderKind: "custom" });
    expect(
      (await isolated.db.query("SELECT order_kind FROM quotes WHERE id=$1", [second.quote.id])).rows[0]?.order_kind,
    ).toBe("custom");
  });
  it("범위 옵션의 양끝과 조합 추가금을 합산한다", async () => {
    await isolated.db.query(
      "UPDATE price_options SET price_kind='range',amount=1000,amount_max=3000,in_standard=false WHERE id=$1",
      [shop.designOptionId],
    );
    await isolated.db.query("UPDATE order_drafts SET design_option_id=$2 WHERE id=$1", [
      shop.draftId,
      shop.designOptionId,
    ]);
    const size = (
      await isolated.db.query<{ size_option_id: string }>("SELECT size_option_id FROM order_drafts WHERE id=$1", [
        shop.draftId,
      ])
    ).rows[0];
    if (!size) throw new Error("합성 크기가 없어요");
    const [a, b] = [size.size_option_id, shop.designOptionId].sort();
    await isolated.db.query(
      "INSERT INTO price_option_rules (shop_id,price_list_id,rule_kind,option_a_id,option_b_id,amount) VALUES ($1,$2,'surcharge',$3,$4,2000)",
      [shop.shopId, shop.priceListId, a, b],
    );
    expect(await quote()).toMatchObject({
      kind: "quoted",
      quote: { amount: 38000, amountMax: 40000, displayKind: "range", orderKind: "custom" },
    });
  });
  it("부터 옵션이 하나라도 있으면 범위보다 우선하고 중복 추가 옵션은 한 번만 더한다", async () => {
    await isolated.db.query(
      "UPDATE price_options SET price_kind='range',amount=1000,amount_max=3000,in_standard=false WHERE id=$1",
      [shop.designOptionId],
    );
    await isolated.db.query("UPDATE order_drafts SET design_option_id=$2 WHERE id=$1", [
      shop.draftId,
      shop.designOptionId,
    ]);
    await isolated.db.query(
      "INSERT INTO price_options (shop_id,price_list_id,option_group,name,price_kind,amount,in_standard) VALUES ($1,$2,'extra','추가 장식','from',500,false)",
      [shop.shopId, shop.priceListId],
    );
    expect(await quote({ extras: ["추가 장식", "추가 장식"] })).toMatchObject({
      kind: "quoted",
      quote: { amount: 36500, amountMax: null, displayKind: "from", orderKind: "custom" },
    });
  });
  it("금지 조합은 금액이나 견적을 만들지 않고 넘긴다", async () => {
    const selected = (
      await isolated.db.query<{ size_option_id: string; flavor_option_id: string }>(
        "SELECT size_option_id,flavor_option_id FROM order_drafts WHERE id=$1",
        [shop.draftId],
      )
    ).rows[0];
    if (!selected) throw new Error("합성 선택이 없어요");
    const [a, b] = [selected.size_option_id, selected.flavor_option_id].sort();
    await isolated.db.query(
      "INSERT INTO price_option_rules (shop_id,price_list_id,rule_kind,option_a_id,option_b_id) VALUES ($1,$2,'exclude',$3,$4)",
      [shop.shopId, shop.priceListId, a, b],
    );
    expect(await quote()).toEqual({ kind: "cannot_calculate", reason: "combination_excluded" });
    expect((await isolated.db.query("SELECT id FROM quotes WHERE draft_id=$1", [shop.draftId])).rows).toHaveLength(0);
  });
  it("손님에게는 근거·내부 식별자·버전을 주지 않는다", async () => {
    const result = await quote();
    if (result.kind !== "quoted") throw new Error("합성 견적이 없어요");
    expect(customerQuote(result.quote)).toEqual({
      amount: 35000,
      amountMax: null,
      displayKind: "fixed",
      validUntil: new Date(NOW.getTime() + 72 * 3600000).toISOString(),
    });
    expect(Object.keys(customerQuote(result.quote)).sort()).toEqual([
      "amount",
      "amountMax",
      "displayKind",
      "validUntil",
    ]);
  });
  it("다른 가게의 초안이나 수신 메시지는404이고 견적을 만들지 않는다", async () => {
    const other = await createShop(isolated.db, "다른 견적 가게");
    await expect(
      quoteDraft(scoped(), { draftId: other.draftId, sourceMessageId: shop.messageId, now: NOW }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      quoteDraft(scoped(), { draftId: shop.draftId, sourceMessageId: other.messageId, now: NOW }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await isolated.db.query("SELECT id FROM quotes WHERE draft_id=$1", [shop.draftId])).rows).toHaveLength(0);
  });
  it("없는 가격표나 운영규정 버전은404이며 견적을 남기지 않는다", async () => {
    for (const version of [{ priceListVersion: 99 }, { operatingRulesVersion: 99 }])
      await expect(
        quoteDraft(scoped(), { draftId: shop.draftId, sourceMessageId: shop.messageId, now: NOW, ...version }),
      ).rejects.toMatchObject({ code: "not_found" });
    expect((await isolated.db.query("SELECT id FROM quotes WHERE draft_id=$1", [shop.draftId])).rows).toHaveLength(0);
  });
  it("같은 유효 견적은 재사용하고 만료 시각에는 새 견적을 만든다", async () => {
    const first = await quote(),
      second = await quote();
    if (first.kind !== "quoted" || second.kind !== "quoted") throw new Error("합성 견적이 없어요");
    expect(second.quote).toEqual(first.quote);
    const expired = await quoteDraft(scoped(), {
      draftId: shop.draftId,
      sourceMessageId: shop.messageId,
      now: new Date(NOW.getTime() + 72 * 3600000),
    });
    if (expired.kind !== "quoted") throw new Error("새 합성 견적이 없어요");
    expect(expired.quote.id).not.toBe(first.quote.id);
    expect(expired.quote.validUntil).toBe(new Date(NOW.getTime() + 144 * 3600000).toISOString());
  });
  it.each([false, true])("알레르기 답은 기본 디자인 판정에서 빼고 제외 재료만 맞춤으로 본다(%s)", async (excluded) => {
    await isolated.db.query(
      "UPDATE order_drafts SET allergy_consent='agreed',allergy_consent_version='allergy-v1',allergy_consent_at=$2,allergy_answer='땅콩',excluded_ingredients=$3 WHERE id=$1",
      [shop.draftId, NOW, excluded ? "호두" : null],
    );
    expect(await quote()).toMatchObject({ kind: "quoted", quote: { orderKind: excluded ? "custom" : "standard" } });
  });
});
