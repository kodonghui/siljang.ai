import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { type CustomerCommandKind, pressConfirmCard, showConfirmCard } from "../src/confirm-card-store";
import { kakaoConfirmCardReply } from "../src/kakao-confirm-card";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { createConsentWithdrawalFixture } from "./support/consent-withdrawal-fixture";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { prepareOrderCardSource } from "./support/order-card";
import { createShop, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-28T06:00:00Z");
describeDb("공통 확인 카드의 교체 응답 재시도(TASK-081)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
  });
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 교체 응답 가게");
    await linkTestChannel(isolated.db, shop.channelId);
    await prepareOrderCardSource(isolated.db, shop, NOW);
    await isolated.db.query("UPDATE order_drafts SET status='active' WHERE id=$1", [shop.draftId]);
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
  const identity = () => ({ customerId: shop.customerId, consultationId: shop.consultationId });
  const kinds = [
    "cancel",
    "order_request",
    "payment_claim",
    "change_request",
    "issue_report",
    "consent_withdrawal",
  ] as const;
  async function prepare(kind: CustomerCommandKind) {
    if (kind === "payment_claim")
      await isolated.db.query(
        "UPDATE payment_requests SET issued_at=$2,delivered_at=$2,due_at=$2::timestamptz+interval '12 hours',due_cap_at=$2::timestamptz+interval '2 days' WHERE id=$1",
        [shop.paymentRequestId, NOW],
      );
    if (kind === "change_request") {
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
    }
    if (kind === "issue_report" || kind === "consent_withdrawal") {
      ({ shop } = await createConsentWithdrawalFixture(isolated.db, NOW));
      if (kind === "issue_report")
        await isolated.db.query(
          "INSERT INTO issue_details(shop_id,consultation_id,order_id,description,health_concern) VALUES($1,$2,$3,'합성 신고 설명',false)",
          [shop.shopId, shop.consultationId, shop.orderId],
        );
    }
    return showConfirmCard(scoped(), {
      ...identity(),
      kind,
      now: NOW,
      sourceMessageId: shop.messageId,
      ...(kind === "order_request" ? { draftId: shop.draftId } : { orderId: shop.orderId }),
      ...(kind === "change_request" ? { proposedChanges: { lettering: "합성 변경 문구" } } : {}),
    });
  }
  const render = async (answer: Parameters<typeof kakaoConfirmCardReply>[1]) => {
    const response = kakaoConfirmCardReply(
      { json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }) },
      answer,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Siljang-Outcome")).toBe(answer.outcome);
    const body = await response.json();
    expectSchema("SkillTemplateResponse", body);
    return body;
  };
  const press = (cardKey: string, now: Date, execute = vi.fn()) =>
    pressConfirmCard(scoped(), { ...identity(), cardKey, choice: "confirm", now }, execute);
  async function changed(kind: CustomerCommandKind) {
    if (kind === "order_request") {
      await isolated.db.query("UPDATE order_drafts SET revision=revision+1 WHERE id=$1", [shop.draftId]);
      await prepareOrderCardSource(isolated.db, shop, NOW);
    } else
      await isolated.db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO order_details SELECT (jsonb_populate_record(NULL::order_details,to_jsonb(d)||jsonb_build_object('version',d.version+1,'id',gen_random_uuid(),'source','owner_amount_change','amount_change_reason','합성 버전 확인'))).* FROM order_details d JOIN orders o ON o.id=d.order_id AND o.version=d.version WHERE d.order_id=$1",
          [shop.orderId],
        );
        await tx.query("UPDATE orders SET version=version+1 WHERE id=$1", [shop.orderId]);
      });
  }
  it.each(kinds)("%s에서도 만료 교체 응답을 놓친 원래 버튼은 유효한 새 카드를 다시 보인다", async (kind) => {
    const card = await prepare(kind);
    const execute = vi.fn(async () => ({
      outcome: kind === "cancel" ? "order_cancelled" : "order_requested",
      text: "합성 첫 결과",
    }));
    const input = {
      ...identity(),
      cardKey: card.cardKey,
      choice: "confirm" as const,
      now: new Date(NOW.getTime() + 30 * 60000),
    };
    const first = await pressConfirmCard(scoped(), input, execute),
      retry = await pressConfirmCard(scoped(), input, execute);
    expect(first.outcome).toBe("card_expired");
    expect(first.card).toBeDefined();
    expect(retry.outcome).toBe("card_used");
    expect(retry.card?.cardKey).toBe(first.card?.cardKey);
    expect(execute).not.toHaveBeenCalled();
    expect(await render(retry)).toEqual(await render(first));
  });
  it.each(kinds)("%s에서도 버전 변경 응답을 놓치면 같은 현재 카드만 다시 보인다", async (kind) => {
    const card = await prepare(kind),
      execute = vi.fn();
    await changed(kind);
    const first = await press(card.cardKey, NOW, execute),
      retry = await press(card.cardKey, NOW, execute);
    expect(first.outcome).toBe("card_stale");
    expect(retry.card?.cardKey).toBe(first.card?.cardKey);
    expect(await render(retry)).toEqual(await render(first));
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(kinds)("%s의 이미 교체된 버튼 거절은 다시 만료돼도 쓰기 없이 끝난다", async (kind) => {
    const original = await prepare(kind);
    await changed(kind);
    await press(original.cardKey, NOW);
    const before = (
      await isolated.db.query("SELECT id,payload,used_at,outcome FROM confirm_cards WHERE shop_id=$1 ORDER BY id", [
        shop.shopId,
      ])
    ).rows;
    const execute = vi.fn();
    const result = await pressConfirmCard(
      scoped(),
      { ...identity(), cardKey: original.cardKey, choice: "decline", now: new Date(NOW.getTime() + 30 * 60000) },
      execute,
    );
    expect(result.outcome).toBe("declined");
    expect(result.card).toBeUndefined();
    expect(
      (
        await isolated.db.query("SELECT id,payload,used_at,outcome FROM confirm_cards WHERE shop_id=$1 ORDER BY id", [
          shop.shopId,
        ])
      ).rows,
    ).toEqual(before);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(kinds)("%s의 예전 버튼은 교체 카드가 다시 만료돼도 현재 카드만 갱신한다", async (kind) => {
    const original = await prepare(kind),
      execute = vi.fn();
    await changed(kind);
    const stale = await press(original.cardKey, NOW, execute);
    const before = (
      await isolated.db.query("SELECT payload->'result' AS result FROM confirm_cards WHERE card_key=$1", [
        original.cardKey,
      ])
    ).rows;
    const at = new Date(NOW.getTime() + 30 * 60000);
    const expired = await press(original.cardKey, at, execute),
      repeated = await press(original.cardKey, at, execute);
    expect(expired.replacementState).toBe("expired");
    expect(expired.card?.cardKey).toBeDefined();
    expect(expired.card?.cardKey).not.toBe(stale.card?.cardKey);
    expect(repeated.card?.cardKey).toBe(expired.card?.cardKey);
    expect(await render(repeated)).toEqual(await render(expired));
    expect(
      (
        await isolated.db.query("SELECT payload->'result' AS result FROM confirm_cards WHERE card_key=$1", [
          original.cardKey,
        ])
      ).rows,
    ).toEqual(before);
    expect((await isolated.db.query("SELECT id FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rowCount).toBe(3);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(["kind", "null_order", "draft", "customer", "consultation", "shop", "cycle"] as const)(
    "교체 참조의 %s 경계가 바뀌면 표시·업무를 거절한다",
    async (fault) => {
      const kind = fault === "draft" || fault === "null_order" ? "order_request" : "cancel";
      const original = await prepare(kind);
      await changed(kind);
      const replacement = await press(original.cardKey, NOW);
      expect(replacement.card).toBeDefined();
      const key = replacement.card?.cardKey;
      if (fault === "kind")
        await isolated.db.query("UPDATE confirm_cards SET kind='payment_claim' WHERE card_key=$1", [key]);
      if (fault === "null_order")
        await isolated.db.query("UPDATE confirm_cards SET order_id=$2 WHERE card_key=$1", [key, shop.orderId]);
      if (fault === "draft") {
        const draft = newUuid();
        await isolated.db.query(
          "INSERT INTO order_drafts(id,shop_id,consultation_id,status) VALUES($1,$2,$3,'submitted')",
          [draft, shop.shopId, shop.consultationId],
        );
        await isolated.db.query("UPDATE confirm_cards SET draft_id=$2 WHERE card_key=$1", [key, draft]);
      }
      if (fault === "customer") {
        const customer = newUuid(),
          consultation = newUuid();
        await isolated.db.query(
          "INSERT INTO customers(id,shop_id,kakao_channel_id,kakao_user_key) VALUES($1,$2,$3,$4)",
          [customer, shop.shopId, shop.channelId, newUuid()],
        );
        await isolated.db.query("INSERT INTO consultations(id,shop_id,customer_id) VALUES($1,$2,$3)", [
          consultation,
          shop.shopId,
          customer,
        ]);
        await isolated.db.query("UPDATE confirm_cards SET customer_id=$2,consultation_id=$3 WHERE card_key=$1", [
          key,
          customer,
          consultation,
        ]);
      }
      if (fault === "consultation") {
        const consultation = newUuid();
        await isolated.db.query(
          "INSERT INTO consultations(id,shop_id,customer_id,status,ended_at) VALUES($1,$2,$3,'ended',$4)",
          [consultation, shop.shopId, shop.customerId, NOW],
        );
        await isolated.db.query("UPDATE confirm_cards SET consultation_id=$2 WHERE card_key=$1", [key, consultation]);
      }
      if (fault === "shop") {
        const other = await createShop(isolated.db, "다른 합성 교체 가게");
        await linkTestChannel(isolated.db, other.channelId);
        const otherDb = shopRequestDb(
          createShopScope(other.shopId, { kind: "job", job: "kakao_callback" }),
          isolated.db,
        );
        const card = await showConfirmCard(otherDb, {
          kind: "cancel",
          customerId: other.customerId,
          consultationId: other.consultationId,
          orderId: other.orderId,
          now: NOW,
        });
        await isolated.db.query(
          "UPDATE confirm_cards SET payload=jsonb_set(payload,'{replacedBy}',$2::jsonb) WHERE card_key=$1",
          [original.cardKey, JSON.stringify({ cardKey: card.cardKey })],
        );
      }
      if (fault === "cycle")
        await isolated.db.query(
          "UPDATE confirm_cards SET used_at=$2,outcome='stale',payload=jsonb_set(payload,'{replacedBy}',$3::jsonb) WHERE card_key=$1",
          [key, NOW, JSON.stringify({ cardKey: original.cardKey })],
        );
      const before = (
        await isolated.db.query("SELECT id,payload,used_at,outcome FROM confirm_cards WHERE shop_id=$1 ORDER BY id", [
          shop.shopId,
        ])
      ).rows;
      const execute = vi.fn(),
        result = await press(original.cardKey, NOW, execute);
      expect(result.outcome).toBe("retry_needed");
      expect(result.card).toBeUndefined();
      expect(
        (
          await isolated.db.query("SELECT id,payload,used_at,outcome FROM confirm_cards WHERE shop_id=$1 ORDER BY id", [
            shop.shopId,
          ])
        ).rows,
      ).toEqual(before);
      expect(execute).not.toHaveBeenCalled();
    },
  );
  it.each(["order_requested", "day_full", "order_limit_reached"])(
    "교체 주문 요청이 끝났으면 예전 버튼도 처음 %s 결과를 보존한다",
    async (outcome) => {
      const original = await prepare("order_request");
      await changed("order_request");
      const replacement = await press(original.cardKey, NOW);
      const execute = vi.fn(async () => ({ outcome, text: "합성 처음 업무 결과" }));
      const first = await press(replacement.card?.cardKey ?? "missing_card_key_12345", NOW, execute);
      const again = await press(original.cardKey, NOW, execute);
      expect(first.outcome).toBe(outcome);
      expect(again).toMatchObject({ outcome: "card_used", firstResult: { outcome, text: first.text } });
      expect(again.card).toBeUndefined();
      expect(execute).toHaveBeenCalledOnce();
    },
  );
  it("교체 결제가 이미 요청된 현재 상태면 입금자/새 카드를 보이거나 명령하지 않는다", async () => {
    const original = await prepare("payment_claim");
    await changed("payment_claim");
    await press(original.cardKey, NOW);
    await isolated.db.query(
      "UPDATE payment_requests SET status='claimed',claimed_at=$2,version=version+1 WHERE id=$1",
      [shop.paymentRequestId, NOW],
    );
    const execute = vi.fn(),
      result = await press(original.cardKey, NOW, execute);
    expect(result.outcome).toBe("not_allowed_now");
    expect(result.card).toBeUndefined();
    expect(result.text).toContain("이미 결제 확인을 요청했어요");
    expect(execute).not.toHaveBeenCalled();
  });
  it("교체 카드의 첫 전달 시계만 시작되면 같은 키를 지키고 실제 결제는 쓰지 않는다", async () => {
    const original = await prepare("payment_claim");
    await isolated.db.query("UPDATE payment_requests SET delivered_at=NULL,due_at=due_cap_at WHERE id=$1", [
      shop.paymentRequestId,
    ]);
    const at = new Date(NOW.getTime() + 30 * 60000),
      first = await press(original.cardKey, at);
    await isolated.db.query(
      "UPDATE payment_requests SET delivered_at=$2,due_at=$2::timestamptz+interval '12 hours' WHERE id=$1",
      [shop.paymentRequestId, at],
    );
    const before = (await isolated.db.query("SELECT * FROM payment_requests WHERE id=$1", [shop.paymentRequestId]))
      .rows;
    const execute = vi.fn(),
      retry = await press(original.cardKey, at, execute);
    expect(retry.card?.cardKey).toBe(first.card?.cardKey);
    expect(
      (
        await isolated.db.query(
          "SELECT payload->'paymentClaimBinding'->>'awaitingDelivery' AS awaiting FROM confirm_cards WHERE card_key=$1",
          [retry.card?.cardKey],
        )
      ).rows[0]?.awaiting,
    ).toBe("false");
    expect(
      (await isolated.db.query("SELECT * FROM payment_requests WHERE id=$1", [shop.paymentRequestId])).rows,
    ).toEqual(before);
    expect(execute).not.toHaveBeenCalled();
  });
});
