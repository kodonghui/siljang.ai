import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { type DbConnector, pgConnector } from "../src/db";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { createShop, issueTestBookingLink, linkTestChannel } from "./support/shops";

const NOW = new Date("2026-11-22T03:00:00Z");
const ACK = { version: "2.0", template: { outputs: [{ simpleText: { text: "후기를 남겨 주셔서 고마워요" } }] } };

describeDb("API-072 업무 중복과 트랜잭션(TASK-028)", () => {
  const db = testDb();
  afterAll(() => db.close());

  async function fixture(received = true) {
    const shop = await createShop(db, "후기 중복 시험 가게");
    await issueTestBookingLink(db, shop);
    await linkTestChannel(db, shop.channelId);
    const payment = newUuid();
    if (received) {
      await db.transaction(async (tx) => {
        await tx.query(
          "UPDATE payment_requests SET status='paid', arrived_amount=amount, arrived_at=$2, paid_at=$2 WHERE id=$1",
          [shop.paymentRequestId, NOW],
        );
        await tx.query(
          "INSERT INTO payments (id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES ($1,$2,$3,$4,35000,$5)",
          [payment, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
        );
        await tx.query(
          "UPDATE orders SET status='received', confirmed_at=$2, confirmed_payment_id=$3, finished_at=$2 WHERE id=$1",
          [shop.orderId, NOW, payment],
        );
        await tx.query(
          "INSERT INTO productions (shop_id,order_id,completed_at,handed_over_at,handover_kind) VALUES ($1,$2,$3,$3,'pickup')",
          [shop.shopId, shop.orderId, NOW],
        );
      });
    }
    const order = await db.query<{ order_no: string }>("SELECT order_no FROM orders WHERE id=$1", [shop.orderId]);
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    let at = NOW;
    const send = (
      options: {
        user?: string;
        text?: string;
        orderNo?: string;
        connect?: DbConnector;
        photos?: string;
        omitOrderNo?: boolean;
      } = {},
    ) =>
      createApp({
        ...(options.connect ? { connect: options.connect } : {}),
        services: { now: () => at },
        logSink: () => {},
      }).request(
        "/api/kakao/skills/review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: "후기 남기기",
              block: { id: "review" },
              user: { id: options.user ?? shop.userKey, type: "botUserKey" },
            },
            action: {
              id: "review",
              params: {
                review_text: options.text ?? "합성 후기 글",
                ...(options.photos ? { review_photos: options.photos } : {}),
              },
              clientExtra: options.omitOrderNo ? {} : { orderNo: options.orderNo ?? order.rows[0]?.order_no },
            },
          }),
        },
        testEnv(),
      );
    return {
      shop,
      send,
      advance: () => {
        at = new Date(at.getTime() + 2001);
      },
    };
  }

  it("같은 후기 HTTP 세 번은 실제 후기 버전·수신을 한 번만 쓰고 API-072의 같은 답을 돌려줌", async () => {
    const h = await fixture();
    const results = await Promise.all([h.send(), h.send(), h.send()]);
    expect(results.map((r) => r.headers.get("Siljang-Outcome")).sort()).toEqual([
      "duplicate",
      "duplicate",
      "review_saved",
    ]);
    for (const r of results) {
      const body = await r.json();
      expectSchema("SkillTemplateResponse", body);
      expect(body).toEqual(ACK);
    }
    expect((await db.query("SELECT body,version FROM reviews WHERE order_id=$1", [h.shop.orderId])).rows).toEqual([
      { body: "합성 후기 글", version: 1 },
    ]);
    expect(
      (
        await db.query("SELECT id FROM messages WHERE shop_id=$1 AND consultation_id=$2 AND kind='card'", [
          h.shop.shopId,
          h.shop.consultationId,
        ])
      ).rowCount,
    ).toBe(1);
    expect((await db.query("SELECT id FROM ai_calls WHERE shop_id=$1", [h.shop.shopId])).rowCount).toBe(0);
  });

  it("DB 저장 실패는 수신 키와 후기 함께 롤백해 같은 요청 재시도로 한 번 저장함", async () => {
    const h = await fixture();
    const connect: DbConnector = (dsn) => {
      const conn = pgConnector(dsn);
      return {
        query: conn.query.bind(conn),
        abort: conn.abort.bind(conn),
        close: conn.close.bind(conn),
        transaction: (work) =>
          conn.transaction((tx) =>
            work({
              query: (sql, params) => {
                if (/INSERT INTO reviews/.test(sql)) throw new Error("합성 후기 저장 중단");
                return tx.query(sql, params);
              },
            }),
          ),
      };
    };
    expect((await h.send({ connect })).headers.get("Siljang-Outcome")).toBe("server_error");
    expect((await db.query("SELECT id FROM messages WHERE shop_id=$1 AND kind='card'", [h.shop.shopId])).rowCount).toBe(
      0,
    );
    expect((await h.send()).headers.get("Siljang-Outcome")).toBe("review_saved");
    expect((await h.send()).headers.get("Siljang-Outcome")).toBe("duplicate");
    expect((await db.query("SELECT id FROM reviews WHERE order_id=$1", [h.shop.orderId])).rowCount).toBe(1);
  });

  it("새 수신 구간의 수정은 새 버전 하나이고 이전 버전은 보존함", async () => {
    const h = await fixture();
    expect((await h.send()).headers.get("Siljang-Outcome")).toBe("review_saved");
    h.advance();
    expect((await h.send({ text: "바꾼 합성 후기" })).headers.get("Siljang-Outcome")).toBe("review_saved");
    expect(
      (
        await db.query(
          "SELECT body,version,superseded_at IS NULL AS current FROM reviews WHERE order_id=$1 ORDER BY version",
          [h.shop.orderId],
        )
      ).rows,
    ).toEqual([
      { body: "합성 후기 글", version: 1, current: false },
      { body: "바꾼 합성 후기", version: 2, current: true },
    ]);
  });

  it("주문번호가 없으면 같은 손님에게 전한 최근 후기 부탁의 받은 주문만 사용함", async () => {
    const h = await fixture();
    expect((await h.send({ omitOrderNo: true })).headers.get("Siljang-Outcome")).toBe("review_not_allowed");
    await db.query(
      `INSERT INTO notifications (shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status,sent_at)
      VALUES ($1,$2,$3,$4,'review_request',$5,'review_request-v1','합성 후기 부탁','delivered_on_reply',$6)`,
      [
        h.shop.shopId,
        h.shop.customerId,
        h.shop.consultationId,
        h.shop.orderId,
        `notice:${h.shop.orderId}:review_request`,
        NOW,
      ],
    );
    expect((await h.send({ omitOrderNo: true })).headers.get("Siljang-Outcome")).toBe("review_saved");
    expect((await db.query("SELECT id FROM reviews WHERE order_id=$1", [h.shop.orderId])).rowCount).toBe(1);
  });

  it("끝난 상담의 받은 주문에도 후기를 남기되 상담을 다시 열지 않음", async () => {
    const h = await fixture();
    await db.query("UPDATE consultations SET status='ended',ended_at=$2 WHERE id=$1", [h.shop.consultationId, NOW]);
    expect((await h.send()).headers.get("Siljang-Outcome")).toBe("review_saved");
    expect((await db.query("SELECT status FROM consultations WHERE shop_id=$1", [h.shop.shopId])).rows).toEqual([
      { status: "ended" },
    ]);
  });

  it.each(["", "x".repeat(1001)])("빈 글/긴 글은 수신 키를 남기지 않아 고쳐서 다시 보낼 수 있음", async (text) => {
    const h = await fixture();
    expect((await h.send({ text })).headers.get("Siljang-Outcome")).toBe("review_invalid");
    expect((await h.send()).headers.get("Siljang-Outcome")).toBe("review_saved");
    expect((await db.query("SELECT id FROM reviews WHERE order_id=$1", [h.shop.orderId])).rowCount).toBe(1);
  });

  it("사진의 전체 처리가 연결되기 전에는 글만 저장한 성공으로 답하지 않음", async () => {
    const h = await fixture();
    expect((await h.send({ photos: JSON.stringify({ imageQuantity: "1" }) })).headers.get("Siljang-Outcome")).toBe(
      "not_accepting",
    );
    expect((await db.query("SELECT id FROM reviews WHERE order_id=$1", [h.shop.orderId])).rowCount).toBe(0);
  });

  it.each(["아직 받지 않음", "다른 손님", "다른 주문번호"])("%s 요청은 후기를 남기지 않음", async (reason) => {
    const h = await fixture(reason !== "아직 받지 않음");
    const r = await h.send(
      reason === "다른 손님" ? { user: newUuid() } : reason === "다른 주문번호" ? { orderNo: "ZZZZZZZZ" } : {},
    );
    expect(r.headers.get("Siljang-Outcome")).toBe("review_not_allowed");
    expect((await db.query("SELECT id FROM reviews WHERE shop_id=$1", [h.shop.shopId])).rowCount).toBe(0);
  });
});
