import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { pressConfirmCard, readConfirmCardDelivery, showConfirmCard } from "../src/confirm-card-store";
import { type KakaoMessageOutput, kakaoMessageOutputs } from "../src/kakao-message-content";
import { kakaoConfirmAnswerMessage } from "../src/kakao-order-request-message";
import { readPaymentClaimSource } from "../src/payment-claim-presentation";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-25T01:00:00Z");
const NAME = "합성입금표시손님";
function firstCard(outputs: readonly KakaoMessageOutput[]) {
  const output = outputs[0];
  if (output === undefined || !("textCard" in output)) throw new Error("synthetic claim card missing");
  return output.textCard;
}
describeDb("SCR006 저장 카드의 표시 직전 결제 자료(TASK-107)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 입금 카드 가게");
    await linkTestChannel(isolated.db, shop.channelId);
    await isolated.db.query("UPDATE order_details SET customer_name=$2 WHERE order_id=$1", [shop.orderId, NAME]);
    await isolated.db.query(
      "UPDATE payment_requests SET issued_at=$2::timestamptz-interval '1 minute',delivered_at=$2,due_at=$2::timestamptz+interval '12 hours',due_cap_at=$2::timestamptz+interval '2 days' WHERE id=$1",
      [shop.paymentRequestId, NOW],
    );
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
  const identity = () => ({ customerId: shop.customerId, consultationId: shop.consultationId });
  const show = () =>
    showConfirmCard(scoped(), {
      ...identity(),
      kind: "payment_claim",
      orderId: shop.orderId,
      sourceMessageId: shop.messageId,
      now: NOW,
    });
  const read = (now = NOW) =>
    scoped().transaction((tx) => readConfirmCardDelivery(tx, { ...identity(), sourceMessageId: shop.messageId, now }));
  const press = (cardKey: string, now = NOW) => {
    const execute = vi.fn(async () => ({
      outcome: "payment_claimed",
      text: "사장님께 알렸어요. 확인되면 알려 드릴게요",
    }));
    return {
      execute,
      answer: pressConfirmCard(scoped(), { ...identity(), cardKey, choice: "confirm", now }, execute),
    };
  };
  async function expectPrivateStorage() {
    const saved = await isolated.db.query(
      "SELECT payload::text AS value FROM confirm_cards WHERE shop_id=$1 UNION ALL SELECT body_masked FROM messages WHERE shop_id=$1",
      [shop.shopId],
    );
    expect(JSON.stringify(saved.rows)).not.toContain(NAME);
    expect(JSON.stringify(saved.rows)).not.toMatch(/depositorName|customer_name|depositor_name/);
  }

  it("현재 결제의 금액·기한과 이름은 세 버튼으로 보이며 카드/메시지에는 이름을 저장하지 않음", async () => {
    const card = await show();
    const outputs = kakaoMessageOutputs([card]);
    expect(outputs).toHaveLength(1);
    expect(firstCard(outputs).description).toContain(`입금자 ${NAME}(주문자 이름)`);
    expect(firstCard(outputs).description).toContain("결제 기한 2026-11-25 22:00");
    expect(firstCard(outputs).description).toContain("10:30까지 눌러 주세요");
    expect(firstCard(outputs).buttons.map((button) => button.label)).toEqual([
      "결제 확인 요청",
      "입금자 이름이 달라요",
      "안 할래요",
    ]);
    expect(firstCard(outputs).buttons[1]).toMatchObject({ action: "block", blockId: "depositor" });
    await expectPrivateStorage();
  });
  it("저장 수신의 재전달도 같은 카드 키로 표시 직전에 이름을 읽고 업무를 쓰지 않음", async () => {
    const card = await show();
    const before = (await isolated.db.query("SELECT * FROM payment_requests WHERE id=$1", [shop.paymentRequestId]))
      .rows;
    const replay = await read();
    expect(replay.card?.cardKey).toBe(card.cardKey);
    if (replay.card === undefined) throw new Error("synthetic replay card missing");
    expect(JSON.stringify(kakaoMessageOutputs([replay.card]))).toContain(NAME);
    expect(
      (await isolated.db.query("SELECT * FROM payment_requests WHERE id=$1", [shop.paymentRequestId])).rows,
    ).toEqual(before);
    await expectPrivateStorage();
  });
  it("30분 정각의 새 카드는 SCR006 만료 문구/현재 값이고 명령0건", async () => {
    const card = await show();
    const pending = press(card.cardKey, new Date(NOW.getTime() + 30 * 60_000));
    const answer = await pending.answer;
    expect(answer.outcome).toBe("card_expired");
    expect(answer.card?.cardKey).not.toBe(card.cardKey);
    const outputs = kakaoConfirmAnswerMessage(answer).template.outputs;
    expect(outputs).toHaveLength(1);
    expect(firstCard(outputs).description).toContain("시간이 지나 새 카드를 보내 드려요");
    expect(firstCard(outputs).description).toContain(NAME);
    expect(pending.execute).not.toHaveBeenCalled();
    await expectPrivateStorage();
  });
  it("주문 버전이 같아도 결제 버전/기한이 바뀌면 새 카드이며 명령0건", async () => {
    const card = await show();
    await isolated.db.query(
      "UPDATE payment_requests SET version=version+1,due_at=due_at+interval '1 hour' WHERE id=$1",
      [shop.paymentRequestId],
    );
    const pending = press(card.cardKey);
    const answer = await pending.answer;
    expect(answer.outcome).toBe("card_stale");
    expect(answer.card?.cardKey).not.toBe(card.cardKey);
    expect(JSON.stringify(kakaoConfirmAnswerMessage(answer))).toContain("내용이 바뀌었어요. 새 카드를 확인해 주세요");
    expect(JSON.stringify(kakaoConfirmAnswerMessage(answer))).toContain("23:00");
    expect(pending.execute).not.toHaveBeenCalled();
    await expectPrivateStorage();
  });
  it("이미 요청한 결제는 요약/이름을 다시 보이지 않고 지금 상태이며 명령0건", async () => {
    const card = await show();
    await isolated.db.query(
      "UPDATE payment_requests SET status='claimed',claimed_at=$2,version=version+1 WHERE id=$1",
      [shop.paymentRequestId, NOW],
    );
    const pending = press(card.cardKey);
    const answer = await pending.answer;
    expect(answer.outcome).toBe("not_allowed_now");
    expect(answer.card).toBeUndefined();
    expect(answer.text).toContain("이미 결제 확인을 요청했어요");
    expect(JSON.stringify(await read())).not.toContain(NAME);
    expect(pending.execute).not.toHaveBeenCalled();
    await expectPrivateStorage();
  });
  it("처음 확인 요청과 같은 카드 재누름은 같은 한 문장이며 합성 명령 한 번", async () => {
    const card = await show();
    const execute = vi.fn(async () => ({
      outcome: "payment_claimed",
      text: "사장님께 알렸어요. 확인되면 알려 드릴게요",
    }));
    const input = { ...identity(), cardKey: card.cardKey, choice: "confirm" as const, now: NOW };
    const first = await pressConfirmCard(scoped(), input, execute);
    const second = await pressConfirmCard(scoped(), input, execute);
    expect(second.outcome).toBe("card_used");
    expect(kakaoConfirmAnswerMessage(second)).toEqual(kakaoConfirmAnswerMessage(first));
    expect(kakaoConfirmAnswerMessage(second).template.outputs).toEqual([
      { simpleText: { text: "사장님께 알렸어요. 확인되면 알려 드릴게요" } },
    ]);
    expect(await read()).toEqual({ text: "사장님께 알렸어요. 확인되면 알려 드릴게요" });
    expect(execute).toHaveBeenCalledOnce();
    await expectPrivateStorage();
  });
  it.each(["first", "reissue"] as const)("%s의 결제 기한 뒤 요청은 계속 표시할 수 있음", async (kind) => {
    await isolated.db.query(
      "UPDATE payment_requests SET kind=$2,event_key=$3,status='expired',issued_at=$4,delivered_at=$5,due_at=$6,expired_at=$6 WHERE id=$1",
      [
        shop.paymentRequestId,
        kind,
        `pay:${shop.orderId}:${kind}`,
        new Date(NOW.getTime() - 14 * 3600000),
        new Date(NOW.getTime() - 13 * 3600000),
        new Date(NOW.getTime() - 3600000),
      ],
    );
    expect((await show()).kind).toBe("payment_claim");
  });
  it("첫 전달 뒤 읽기 없이 눌러도 시계만 같은 카드에 반영하고 명령은 한 번", async () => {
    await isolated.db.query("UPDATE payment_requests SET delivered_at=NULL,due_at=due_cap_at WHERE id=$1", [
      shop.paymentRequestId,
    ]);
    const card = await show();
    await isolated.db.query(
      "UPDATE payment_requests SET delivered_at=$2,due_at=$2::timestamptz+interval '12 hours' WHERE id=$1",
      [shop.paymentRequestId, NOW],
    );
    const pending = press(card.cardKey);
    expect((await pending.answer).outcome).toBe("payment_claimed");
    expect(pending.execute).toHaveBeenCalledOnce();
    const payload = (
      await isolated.db.query<{ payload: { paymentClaimBinding?: { awaitingDelivery?: boolean } } }>(
        "SELECT payload FROM confirm_cards WHERE card_key=$1",
        [card.cardKey],
      )
    ).rows[0]?.payload;
    expect(payload?.paymentClaimBinding?.awaitingDelivery).toBe(false);
    expect(JSON.stringify(payload)).not.toContain(NAME);
  });
  it("만료로 닫힌 차액 변경은 현재 상태이며 확인 카드의 원본이 아님", async () => {
    await isolated.db.query(
      "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_amount=amount,arrived_at=$2 WHERE id=$1",
      [shop.paymentRequestId, NOW],
    );
    const payment = newUuid();
    await isolated.db.query(
      "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
      [payment, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
    );
    await isolated.db.query(
      "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1",
      [shop.orderId, NOW, payment],
    );
    const card = await showConfirmCard(scoped(), {
      ...identity(),
      kind: "change_request",
      orderId: shop.orderId,
      now: NOW,
    });
    const cardId = (
      await isolated.db.query<{ id: string }>("SELECT id FROM confirm_cards WHERE card_key=$1", [card.cardKey])
    ).rows[0]?.id;
    const change = newUuid();
    await isolated.db.query(
      "INSERT INTO change_requests(id,shop_id,order_id,card_id,base_version,status,changes,amount_delta,created_at,decided_at,closed_at) VALUES($1,$2,$3,$4,1,'closed_no_difference','{}',1000,$5,$6,$6)",
      [change, shop.shopId, shop.orderId, cardId, new Date(NOW.getTime() - 20000), NOW],
    );
    await isolated.db.query(
      "INSERT INTO payment_requests SELECT(jsonb_populate_record(NULL::payment_requests,to_jsonb(p)||$2::jsonb)).* FROM payment_requests p WHERE p.id=$1",
      [
        shop.paymentRequestId,
        JSON.stringify({
          id: newUuid(),
          kind: "difference",
          change_request_id: change,
          event_key: `pay:${change}:difference`,
          status: "expired",
          version: 1,
          amount: 1000,
          requested_amount: null,
          needs_amount_confirm: true,
          amount_confirmed_at: new Date(NOW.getTime() - 9000).toISOString(),
          delivered_at: new Date(NOW.getTime() - 9000).toISOString(),
          issued_at: new Date(NOW.getTime() - 10000).toISOString(),
          due_at: new Date(NOW.getTime() - 1000).toISOString(),
          due_cap_at: new Date(NOW.getTime() - 1000).toISOString(),
          expired_at: NOW.toISOString(),
          paid_at: null,
          arrived_at: null,
          arrived_amount: null,
        }),
      ],
    );
    const source = await scoped().transaction((tx) =>
      readPaymentClaimSource(tx, { ...identity(), orderId: shop.orderId }),
    );
    expect(source).toEqual({
      available: false,
      text: "지금은 할 수 없어요: 변경 요청이 닫혀 차액 결제를 요청할 수 없어요",
    });
  });
});
