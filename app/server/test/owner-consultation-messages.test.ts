import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import { maskValue } from "../src/masked-values";
import { ApiError } from "../src/problem";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { failingAccessInsert } from "./support/access-log";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newUuid, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-24T06:00:00Z"),
  ORIGIN = "https://siljang.example";
interface Page {
  consultationId: string;
  status: string;
  customerChannelFriend: boolean;
  items: {
    messageId: string;
    at: string;
    author: string;
    kind: string;
    text: string | null;
    photos: { url: string }[];
    delivery: string | null;
  }[];
  nextCursor: string | null;
}
describeDb("사장님의 상담 대화 API-043(TASK-077)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  const { fc } = singleKeyCrypto();
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 상담 조회 가게");
    await issueTestBookingLink(isolated.db, shop);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  function call(query = "", id = shop.consultationId, authenticated = true, failLog = false) {
    const connect = () => isolated.connect();
    const app = createApp({
      connect: failLog ? failingAccessInsert(connect) : connect,
      scopes: {
        owner: async (c) => {
          if (c.req.header("x-test-owner") !== shop.ownerId) throw new ApiError("unauthenticated");
          return createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId });
        },
      },
      services: { now: () => NOW, fieldCrypto: fc },
      logSink: () => {},
    });
    return app.request(
      `${ORIGIN}/api/owner/consultations/${id}/messages${query}`,
      { headers: { "x-test-owner": authenticated ? shop.ownerId : "", "CF-Connecting-IP": "203.0.113.77" } },
      testEnv(),
    );
  }
  async function page(response: Response): Promise<Page> {
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    expectSchema("ConsultationMessagePage", body);
    return body as Page;
  }
  it("전화·계좌는 복원하고 카드번호는 끝4자리·긴 숫자는 표시자만 보임", async () => {
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db);
    const values = await scoped.transaction(async (tx) =>
      Promise.all([
        maskValue(tx, fc, shop.consultationId, "phone", "01000005678"),
        maskValue(tx, fc, shop.consultationId, "account", "110123456789"),
        maskValue(tx, fc, shop.consultationId, "card", "4111111111111234"),
        maskValue(tx, fc, shop.consultationId, "long_number", "9911221234567"),
      ]),
    );
    await isolated.db.query("UPDATE messages SET body_masked=$2 WHERE id=$1", [shop.messageId, values.join(" / ")]);
    const body = await page(await call()),
      text = body.items.find((x) => x.messageId === shop.messageId)?.text;
    expect(text).toContain("01000005678");
    expect(text).toContain("110123456789");
    expect(text).toContain("[카드번호1]");
    expect(text).toContain("1234");
    expect(text).toContain("[긴숫자1]");
    expect(JSON.stringify(body)).not.toContain("4111111111111234");
    expect(JSON.stringify(body)).not.toContain("9911221234567");
    const logs = (await isolated.db.query("SELECT api_id,subject_ids FROM access_logs WHERE shop_id=$1", [shop.shopId]))
      .rows;
    expect(logs).toEqual([{ api_id: "API-043", subject_ids: [shop.customerId] }]);
  });
  it("사장님 답과 다른 손님 안내를 저장된 본문 그대로 시각 순으로 섞음", async () => {
    const a = newUuid(),
      b = newUuid();
    await isolated.db.query("UPDATE messages SET created_at=$2 WHERE id=$1", [
      shop.messageId,
      new Date(NOW.getTime() - 2000),
    ]);
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status,created_at) VALUES($1,$2,$3,$4,$5,'owner_reply',$6,'synthetic','사장님 답 [계좌번호1]','deferred',$7),($8,$2,$3,$4,$5,'payment_request',$9,'synthetic','계좌번호 자리','pending',$10)",
      [
        a,
        shop.shopId,
        shop.customerId,
        shop.consultationId,
        shop.orderId,
        `notice:${a}:owner_reply`,
        new Date(NOW.getTime() - 1000),
        b,
        `notice:${b}:payment_request`,
        NOW,
      ],
    );
    const body = await page(await call());
    expect(body.items.map((x) => x.messageId)).toEqual([shop.messageId, a, b]);
    expect(body.items[1]).toMatchObject({
      author: "owner",
      kind: "text",
      delivery: "deferred",
      text: "사장님 답 [계좌번호1]",
      photos: [],
    });
    expect(body.items[2]).toMatchObject({
      author: "notice",
      kind: "text",
      delivery: "sending",
      text: "계좌번호 자리",
      photos: [],
    });
  });
  it("지운 상담은 대화가 남아 있어도 deleted·빈 목록", async () => {
    await isolated.db.query("UPDATE consultations SET status='deleted',deleted_at=$2 WHERE id=$1", [
      shop.consultationId,
      NOW,
    ]);
    expect(await page(await call())).toMatchObject({ status: "deleted", items: [], nextCursor: null });
  });
  it("로그인이 없으면401", async () => {
    await expectProblem(await call("", shop.consultationId, false), "unauthenticated");
  });
  it.each(["?limit=0", "?limit=101", "?limit=1.5", "?cursor=bad!", "?cursor="])(
    "잘못된 목록 조건은422(%s)",
    async (query) => {
      await expectProblem(await call(query), "validation_failed");
    },
  );
  it("다른 가게·없는 상담·잘못된 ID는 같은404", async () => {
    const other = await createShop(isolated.db, "다른 합성 상담 가게");
    for (const id of [other.consultationId, newUuid(), "not-a-uuid"]) {
      await expectProblem(await call("", id), "not_found");
    }
  });
  it("접속기록을 남기지 못하면 내용 없이500", async () => {
    await expectProblem(await call("", shop.consultationId, true, true), "internal");
  });
});
