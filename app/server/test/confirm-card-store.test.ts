import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { type ConfirmCardCommand, pressConfirmCard, showConfirmCard } from "../src/confirm-card-store";
import { kakaoConfirmCardReply } from "../src/kakao-confirm-card";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { prepareOrderCardSource } from "./support/order-card";
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
    await prepareOrderCardSource(isolated.db, shop, NOW);
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
    await prepareOrderCardSource(isolated.db, shop, NOW);
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
  it("사용한 카드의 초안이 제출된 뒤에도 처음 결과로 답하고 다시 실행하지 않음", async () => {
    await isolated.db.query("UPDATE order_drafts SET status='active' WHERE id=$1", [shop.draftId]);
    const card = await showConfirmCard(scoped(), {
      ...identity(),
      kind: "order_request",
      draftId: shop.draftId,
      now: NOW,
    });
    const execute = vi.fn<ConfirmCardCommand>(async (tx) => {
      await tx.run("UPDATE order_drafts SET status='submitted' WHERE shop_id=$1 AND id=$2", [shop.draftId]);
      return { outcome: "order_requested", text: "주문을 요청했어요" };
    });
    expect((await press(card.cardKey, "confirm", execute)).outcome).toBe("order_requested");
    const second = await press(card.cardKey, "confirm", execute);
    expect(second.outcome).toBe("card_used");
    expect(second.firstResult).toEqual({ outcome: "order_requested", text: "주문을 요청했어요" });
    expect(second.card).toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
  });
  it("재시도 결과를 성공으로 소비하지 않고 명령의 앞선 쓰기도 되돌림", async () => {
    const card = await show();
    const before = (
      await isolated.db.query("SELECT last_customer_message_at FROM consultations WHERE id=$1", [shop.consultationId])
    ).rows[0];
    await expect(
      press(card.cardKey, "confirm", async (tx) => {
        await tx.run("UPDATE consultations SET last_customer_message_at=$3 WHERE shop_id=$1 AND id=$2", [
          shop.consultationId,
          NOW,
        ]);
        return { outcome: "retry_needed", text: "다시 눌러 주세요" };
      }),
    ).rejects.toThrow();
    expect(
      (await isolated.db.query("SELECT last_customer_message_at FROM consultations WHERE id=$1", [shop.consultationId]))
        .rows[0],
    ).toEqual(before);
    expect((await press(card.cardKey)).outcome).toBe("order_cancelled");
  });

  it("주문 버전2로 만든 카드를 버전3에서 누르면 실행0건과 새 카드", async () => {
    const nextVersion = async (version: number) =>
      isolated.db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO order_details SELECT (jsonb_populate_record(NULL::order_details,to_jsonb(d)||jsonb_build_object('version',$2::int,'id',gen_random_uuid(),'source','owner_amount_change','amount_change_reason','합성 버전 확인'))).* FROM order_details d WHERE d.order_id=$1 AND d.version=1",
          [shop.orderId, version],
        );
        await tx.query("UPDATE orders SET version=$2 WHERE id=$1", [shop.orderId, version]);
      });
    await nextVersion(2);
    const card = await show();
    await nextVersion(3);
    const execute = vi.fn<ConfirmCardCommand>();
    const result = await press(card.cardKey, "confirm", execute);
    expect(result.outcome).toBe("card_stale");
    expect(result.card?.cardKey).not.toBe(card.cardKey);
    expect(execute).not.toHaveBeenCalled();
    expect(
      (
        await isolated.db.query("SELECT order_version FROM confirm_cards WHERE shop_id=$1 AND card_key=$2", [
          shop.shopId,
          result.card?.cardKey,
        ])
      ).rows,
    ).toEqual([{ order_version: 3 }]);
  });
  it("API-070 공통 card_shown 응답은 저장된 요약과 불투명 카드 키만 보냄", async () => {
    const card = await show();
    const response = kakaoConfirmCardReply(
      {
        json: (body, status, headers) =>
          new Response(JSON.stringify(body), { status: status ?? 200, headers: headers ?? {} }),
      },
      { outcome: "card_shown", text: "주문 내용을 확인해 주세요", card },
    );
    expect(response.headers.get("Siljang-Outcome")).toBe("card_shown");
    const body = await response.json();
    expectSchema("SkillTemplateResponse", body);
    const text = JSON.stringify(body);
    expect(text).toContain(card.cardKey);
    expect(text).not.toContain(shop.customerId);
    expect(text).not.toContain(shop.orderId);
    expect((await isolated.db.query("SELECT status FROM orders WHERE id=$1", [shop.orderId])).rows).toEqual([
      { status: "awaiting_payment" },
    ]);
  });
  it("합성 취소 실행기가 연결됐을 때 누르기 전0건·두 번 눌러도 상태 변경1건", async () => {
    const card = await show();
    const execute = vi.fn<ConfirmCardCommand>(async (tx, input) => {
      const written = await tx.run(
        "UPDATE orders SET status='cancelled',cancelled_at=$3,cancel_kind='customer' WHERE shop_id=$1 AND id=$2 AND customer_id=$4 AND status='awaiting_payment'",
        [input.orderId, NOW, input.customerId],
      );
      expect(written.rowCount).toBe(1);
      return { outcome: "order_cancelled", text: "주문을 취소했어요" };
    });
    expect(execute).not.toHaveBeenCalled();
    expect((await press(card.cardKey, "confirm", execute)).outcome).toBe("order_cancelled");
    expect((await press(card.cardKey, "confirm", execute)).outcome).toBe("card_used");
    expect(execute).toHaveBeenCalledOnce();
    expect((await isolated.db.query("SELECT status,cancel_kind FROM orders WHERE id=$1", [shop.orderId])).rows).toEqual(
      [{ status: "cancelled", cancel_kind: "customer" }],
    );
  });
  it("새 상담에서도 같은 손님의 지난 주문 신고·동의 철회 카드를 만들 수 있음", async () => {
    await isolated.db.query("UPDATE consultations SET status='ended',ended_at=$2 WHERE id=$1", [
      shop.consultationId,
      NOW,
    ]);
    const current = newUuid();
    await isolated.db.query(
      "INSERT INTO consultations(id,shop_id,customer_id,opened_at,last_customer_message_at) VALUES($1,$2,$3,$4,$4)",
      [current, shop.shopId, shop.customerId, NOW],
    );
    for (const kind of ["issue_report", "consent_withdrawal"] as const) {
      const card = await showConfirmCard(scoped(), {
        ...identity(),
        consultationId: current,
        kind,
        orderId: shop.orderId,
        now: NOW,
      });
      expect(card.cardKey).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      const other = await createShop(isolated.db, "다른 지난 주문 가게");
      await expect(
        showConfirmCard(scoped(), { ...identity(), consultationId: current, kind, orderId: other.orderId, now: NOW }),
      ).rejects.toThrow();
    }
    await expect(
      showConfirmCard(scoped(), {
        ...identity(),
        consultationId: current,
        kind: "cancel",
        orderId: shop.orderId,
        now: NOW,
      }),
    ).rejects.toThrow();
  });
  it("기한이 지나도 원래 보인 카드는 보존하고 대체 키를 따로 기록", async () => {
    const card = await show();
    const result = await pressConfirmCard(scoped(), {
      ...identity(),
      cardKey: card.cardKey,
      choice: "confirm",
      now: new Date(NOW.getTime() + 30 * 60000),
    });
    const saved = (
      await isolated.db.query("SELECT payload FROM confirm_cards WHERE shop_id=$1 AND card_key=$2", [
        shop.shopId,
        card.cardKey,
      ])
    ).rows[0]?.payload;
    expect(saved).toMatchObject({ presentation: card, replacedBy: { cardKey: result.card?.cardKey } });
  });
  it("거절된 옛 카드를 다시 눌러도 기한 지난 대체 버튼을 다시 보내지 않음", async () => {
    const card = await show();
    await pressConfirmCard(scoped(), {
      ...identity(),
      cardKey: card.cardKey,
      choice: "confirm",
      now: new Date(NOW.getTime() + 30 * 60000),
    });
    const answer = await pressConfirmCard(scoped(), {
      ...identity(),
      cardKey: card.cardKey,
      choice: "confirm",
      now: new Date(NOW.getTime() + 90 * 60000),
    });
    expect(answer.outcome).toBe("card_used");
    expect(answer.firstResult?.outcome).toBe("card_expired");
    expect(answer.card).toBeUndefined();
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ n: 2 }]);
  });
  it("31분 뒤 안 할래요는 사용 처리와 새 카드를 남기지 않음", async () => {
    const card = await show();
    const execute = vi.fn<ConfirmCardCommand>();
    const result = await pressConfirmCard(
      scoped(),
      { ...identity(), cardKey: card.cardKey, choice: "decline", now: new Date(NOW.getTime() + 31 * 60000) },
      execute,
    );
    expect(result.outcome).toBe("declined");
    expect(result.card).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect((await isolated.db.query("SELECT used_at FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rows).toEqual(
      [{ used_at: null }],
    );
  });
  it("초안이 바뀐 뒤 안 할래요도 아무것도 남기지 않음", async () => {
    await isolated.db.query("UPDATE order_drafts SET status='active' WHERE id=$1", [shop.draftId]);
    const card = await showConfirmCard(scoped(), {
      ...identity(),
      kind: "order_request",
      draftId: shop.draftId,
      now: NOW,
    });
    await isolated.db.query("UPDATE order_drafts SET revision=revision+1 WHERE id=$1", [shop.draftId]);
    await prepareOrderCardSource(isolated.db, shop, NOW);
    expect((await press(card.cardKey, "decline")).outcome).toBe("declined");
    expect((await isolated.db.query("SELECT used_at FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rows).toEqual(
      [{ used_at: null }],
    );
  });
  it("받은 카드의 초안이 이미 제출됐으면 타인 카드로 오인하지 않고 재시도 안내", async () => {
    await isolated.db.query("UPDATE order_drafts SET status='active' WHERE id=$1", [shop.draftId]);
    const card = await showConfirmCard(scoped(), {
      ...identity(),
      kind: "order_request",
      draftId: shop.draftId,
      now: NOW,
    });
    await isolated.db.query("UPDATE order_drafts SET status='submitted' WHERE id=$1", [shop.draftId]);
    expect((await press(card.cardKey)).outcome).toBe("retry_needed");
    expect((await isolated.db.query("SELECT used_at FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rows).toEqual(
      [{ used_at: null }],
    );
  });
});
