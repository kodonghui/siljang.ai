import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { type ConfirmCardCommand, pressConfirmCard, showConfirmCard } from "../src/confirm-card-store";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-24T01:00:00Z");
describeDb("손님 확인 카드 저장과 한 번 실행(TASK-081)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 확인 카드 가게");
    await linkTestChannel(isolated.db, shop.channelId);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = (db = isolated.db) =>
    shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), db);
  const identity = () => ({ customerId: shop.customerId, consultationId: shop.consultationId });
  const show = () => showConfirmCard(scoped(), { ...identity(), kind: "cancel", orderId: shop.orderId, now: NOW });
  const press = (
    cardKey: string,
    choice: "confirm" | "decline" = "confirm",
    execute: ConfirmCardCommand = vi.fn(async () => ({ outcome: "order_cancelled", text: "주문을 취소했어요" })),
  ) => pressConfirmCard(scoped(), { ...identity(), cardKey, choice, now: new Date(NOW.getTime() + 1000) }, execute);

  it("말의 제안은 저장 값의 카드만 만들고 주문 상태를 바꾸지 않음", async () => {
    const card = await show();
    expect(card.cardKey).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(card.description).toContain("35,000");
    expect(JSON.stringify(card)).not.toContain(shop.customerId);
    expect((await isolated.db.query("SELECT status FROM orders WHERE id=$1", [shop.orderId])).rows[0]).toEqual({
      status: "awaiting_payment",
    });
    const rows = await isolated.db.query(
      "SELECT order_version,extract(epoch FROM (expires_at-created_at))::int AS ttl,used_at,payload FROM confirm_cards WHERE shop_id=$1 AND card_key=$2",
      [shop.shopId, card.cardKey],
    );
    expect(rows.rows[0]?.order_version).toBe(1);
    expect(rows.rows[0]?.ttl).toBe(1800);
    expect(rows.rows[0]?.used_at).toBeNull();
    expect(JSON.stringify(rows.rows[0]?.payload)).not.toMatch(/customer_phone|allergy|account_number/);
  });
  it("다른 손님과 다른 상담은 같은 거절이며 명령0건", async () => {
    const card = await show(),
      execute = vi.fn();
    const other = await createShop(isolated.db, "다른 합성 가게");
    for (const changed of [{ customerId: other.customerId }, { consultationId: other.consultationId }]) {
      const answer = await pressConfirmCard(
        scoped(),
        { ...identity(), ...changed, cardKey: card.cardKey, choice: "confirm", now: NOW },
        execute,
      );
      expect(answer.outcome).toBe("card_not_yours");
    }
    expect(execute).not.toHaveBeenCalled();
  });
  it("다른 가게 키와 없는 키는 같은 거절이며 쓰기0건", async () => {
    const card = await show(),
      other = await createShop(isolated.db, "외부 합성 가게"),
      execute = vi.fn();
    const db = shopRequestDb(createShopScope(other.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
    const own = {
      customerId: other.customerId,
      consultationId: other.consultationId,
      choice: "confirm" as const,
      now: NOW,
    };
    expect(await pressConfirmCard(db, { ...own, cardKey: card.cardKey }, execute)).toEqual(
      await pressConfirmCard(db, { ...own, cardKey: "missing_card_key_12345" }, execute),
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it("안 할래요는 명령과 사용 표시를 남기지 않음", async () => {
    const card = await show(),
      execute = vi.fn();
    expect((await press(card.cardKey, "decline", execute)).outcome).toBe("declined");
    expect(execute).not.toHaveBeenCalled();
    expect(
      (
        await isolated.db.query("SELECT used_at FROM confirm_cards WHERE shop_id=$1 AND card_key=$2", [
          shop.shopId,
          card.cardKey,
        ])
      ).rows[0]?.used_at,
    ).toBeNull();
  });
  it("30분 정각은 실행0건이며 현재 값으로 새 카드", async () => {
    const card = await show(),
      execute = vi.fn();
    const result = await pressConfirmCard(
      scoped(),
      { ...identity(), cardKey: card.cardKey, choice: "confirm", now: new Date(NOW.getTime() + 30 * 60000) },
      execute,
    );
    expect(result.outcome).toBe("card_expired");
    expect(result.card?.cardKey).not.toBe(card.cardKey);
    expect(execute).not.toHaveBeenCalled();
    expect(
      (
        await isolated.db.query("SELECT outcome FROM confirm_cards WHERE shop_id=$1 AND card_key=$2", [
          shop.shopId,
          card.cardKey,
        ])
      ).rows[0]?.outcome,
    ).toBe("expired");
  });
  it("버전이 바뀐 초안은 실행0건이며 새 고친 번호의 카드", async () => {
    await isolated.db.query("UPDATE order_drafts SET status='active' WHERE id=$1", [shop.draftId]);
    const card = await showConfirmCard(scoped(), {
      ...identity(),
      kind: "order_request",
      draftId: shop.draftId,
      now: NOW,
    });
    await isolated.db.query("UPDATE order_drafts SET revision=revision+1 WHERE id=$1", [shop.draftId]);
    const execute = vi.fn(),
      result = await press(card.cardKey, "confirm", execute);
    expect(result.outcome).toBe("card_stale");
    expect(result.card?.cardKey).not.toBe(card.cardKey);
    expect(execute).not.toHaveBeenCalled();
  });
  it("동시에 두 번 눌러도 합성 명령은 한 번이고 처음 결과를 보존", async () => {
    const card = await show(),
      execute = vi.fn(async () => ({ outcome: "order_cancelled", text: "처음 처리 결과" }));
    const a = isolated.connect(),
      b = isolated.connect();
    try {
      const replies = await Promise.all(
        [a, b].map((db) =>
          pressConfirmCard(scoped(db), { ...identity(), cardKey: card.cardKey, choice: "confirm", now: NOW }, execute),
        ),
      );
      expect(replies.map((x) => x.outcome).sort()).toEqual(["card_used", "order_cancelled"]);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(replies.find((x) => x.outcome === "card_used")?.firstResult).toEqual({
        outcome: "order_cancelled",
        text: "처음 처리 결과",
      });
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });
  it("명령이 쓰기 뒤 실패하면 사용 표시와 명령 쓰기를 함께 취소", async () => {
    const card = await show();
    await expect(
      press(card.cardKey, "confirm", async (tx) => {
        await tx.run("UPDATE consultations SET last_customer_message_at=$3 WHERE shop_id=$1 AND id=$2", [
          shop.consultationId,
          NOW,
        ]);
        throw new Error("synthetic_command_failed");
      }),
    ).rejects.toThrow("synthetic_command_failed");
    expect(
      (
        await isolated.db.query("SELECT used_at FROM confirm_cards WHERE shop_id=$1 AND card_key=$2", [
          shop.shopId,
          card.cardKey,
        ])
      ).rows[0]?.used_at,
    ).toBeNull();
    expect((await press(card.cardKey)).outcome).toBe("order_cancelled");
  });
  it("실행기가 아직 연결되지 않으면 재시도 안내이고 카드를 소비하지 않음", async () => {
    const card = await show();
    expect(
      (await pressConfirmCard(scoped(), { ...identity(), cardKey: card.cardKey, choice: "confirm", now: NOW })).outcome,
    ).toBe("retry_needed");
    expect((await press(card.cardKey)).outcome).toBe("order_cancelled");
  });
});
