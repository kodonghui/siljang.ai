import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { pressConfirmCard, showConfirmCard } from "../src/confirm-card-store";
import { CHANGE_REQUESTED_TEXT } from "../src/kakao-change-request-message";
import { kakaoConfirmCardReply } from "../src/kakao-confirm-card";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-28T06:00:00Z");
describeDb("변경 카드의 저장된 첫 결과와 공통 응답", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 변경 카드 가게");
    await linkTestChannel(isolated.db, shop.channelId);
    const payment = newUuid();
    await isolated.db.query(
      "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_at=$2,arrived_amount=amount WHERE id=$1",
      [shop.paymentRequestId, NOW],
    );
    await isolated.db.query(
      "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
      [payment, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
    );
    await isolated.db.query(
      "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1",
      [shop.orderId, NOW, payment],
    );
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
  const identity = () => ({ customerId: shop.customerId, consultationId: shop.consultationId });
  const render = async (answer: Awaited<ReturnType<typeof pressConfirmCard>>) => {
    const response = kakaoConfirmCardReply(
      { json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }) },
      answer,
    );
    expect(response.headers.get("Siljang-Outcome")).toBe(answer.outcome);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expectSchema("SkillTemplateResponse", body);
    return body;
  };

  it("실제 저장 카드의 한 번 실행과 재클릭이 같은 첫 결과만 보인다", async () => {
    const card = await showConfirmCard(scoped(), {
      ...identity(),
      kind: "change_request",
      orderId: shop.orderId,
      proposedChanges: { lettering: "합성 변경 문구" },
      now: NOW,
    });
    const execute = vi.fn(async () => ({ outcome: "change_requested", text: CHANGE_REQUESTED_TEXT }));
    const input = { ...identity(), cardKey: card.cardKey, choice: "confirm" as const, now: NOW };
    const first = await pressConfirmCard(scoped(), input, execute),
      repeated = await pressConfirmCard(scoped(), input, execute);
    expect(first.outcome).toBe("change_requested");
    expect(repeated.outcome).toBe("card_used");
    expect(execute).toHaveBeenCalledTimes(1);
    const before = await render(first),
      after = await render(repeated);
    expect(before).toEqual(after);
    expect(after).toHaveProperty("template.outputs", [{ simpleText: { text: CHANGE_REQUESTED_TEXT } }]);
    for (const value of [shop.customerId, shop.orderId, card.cardKey, "이미 처리했어요"])
      expect(JSON.stringify(after)).not.toContain(value);
    expect(
      (
        await isolated.db.query("SELECT used_at,payload->'result' AS result FROM confirm_cards WHERE card_key=$1", [
          card.cardKey,
        ])
      ).rows[0],
    ).toEqual({ used_at: NOW, result: { outcome: "change_requested", text: CHANGE_REQUESTED_TEXT } });
  });
  it("안 할래요는 변경 명령과 사용 표시 없이 고정 응답만 보인다", async () => {
    const card = await showConfirmCard(scoped(), {
      ...identity(),
      kind: "change_request",
      orderId: shop.orderId,
      proposedChanges: { lettering: "합성 변경 문구" },
      now: NOW,
    });
    const execute = vi.fn();
    const answer = await pressConfirmCard(
      scoped(),
      { ...identity(), cardKey: card.cardKey, choice: "decline", now: NOW },
      execute,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(await render(answer)).toHaveProperty("template.outputs", [
      { simpleText: { text: "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요" } },
    ]);
    expect(
      (await isolated.db.query("SELECT used_at FROM confirm_cards WHERE card_key=$1", [card.cardKey])).rows[0]?.used_at,
    ).toBeNull();
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM change_requests WHERE shop_id=$1", [shop.shopId]))
        .rows[0]?.n,
    ).toBe(0);
  });
});
