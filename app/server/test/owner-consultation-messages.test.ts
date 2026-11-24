import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import { type DbConnector, pgConnector } from "../src/db";
import { toBase64Url } from "../src/encoding";
import { maskValue } from "../src/masked-values";
import { ApiError } from "../src/problem";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { failingAccessInsert } from "./support/access-log";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_DATABASE_URL, testDb, testEnv } from "./support/db";
import { newFieldKey, singleKeyCrypto } from "./support/field-keys";
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
  const fileUrlKey = newFieldKey();
  const role = `owner077_${newUuid().replaceAll("-", "")}`;
  let runtimeUrl: string;
  const logs: unknown[] = [];
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await isolated.db.query(`CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await isolated.db.query(
      readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8").replaceAll(
        ':"runtime_role"',
        `"${role}"`,
      ),
    );
    const name = (await isolated.db.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    url.username = role;
    url.password = "";
    runtimeUrl = url.toString();
  }, 30000);
  beforeEach(async () => {
    logs.length = 0;
    shop = await createShop(isolated.db, "합성 상담 조회 가게");
    await issueTestBookingLink(isolated.db, shop);
  });
  afterAll(async () => {
    await isolated?.close();
    const admin = testDb();
    try {
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.close();
    }
  });
  function call(
    query = "",
    id = shop.consultationId,
    authenticated = true,
    failLog = false,
    connect: DbConnector = () => isolated.connect(),
  ) {
    const app = createApp({
      connect: failLog ? failingAccessInsert(connect) : connect,
      scopes: {
        owner: async (c) => {
          if (c.req.header("x-test-owner") !== shop.ownerId) throw new ApiError("unauthenticated");
          return createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId });
        },
      },
      services: { now: () => NOW, fieldCrypto: fc },
      logSink: (line) => {
        logs.push(line);
      },
    });
    return app.request(
      `${ORIGIN}/api/owner/consultations/${id}/messages${query}`,
      { headers: { "x-test-owner": authenticated ? shop.ownerId : "", "CF-Connecting-IP": "203.0.113.77" } },
      testEnv({ FILE_URL_KEY: fileUrlKey }),
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
  it("같은 시각의 메시지·안내를 저장 순서로 한 개씩 빠짐없이 넘김", async () => {
    const noticeId = newUuid(),
      messageId = newUuid();
    await isolated.db.query("UPDATE messages SET created_at=$2 WHERE id=$1", [shop.messageId, NOW]);
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,created_at) VALUES($1,$2,$3,$4,'owner_reply',$5,'synthetic','두 번째',$6)",
      [noticeId, shop.shopId, shop.customerId, shop.consultationId, `notice:${noticeId}:owner_reply`, NOW],
    );
    await isolated.db.query(
      "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,body_masked,delivery,created_at) VALUES($1,$2,$3,'outbound','system','text','세 번째','skill_response',$4)",
      [messageId, shop.shopId, shop.consultationId, NOW],
    );
    const first = await page(await call("?limit=1"));
    expect(first.nextCursor).not.toBeNull();
    const second = await page(await call(`?limit=1&cursor=${first.nextCursor}`));
    expect(second.nextCursor).not.toBeNull();
    const third = await page(await call(`?limit=1&cursor=${second.nextCursor}`));
    expect(third.nextCursor).toBeNull();
    expect([...first.items, ...second.items, ...third.items].map((x) => x.messageId)).toEqual([
      shop.messageId,
      noticeId,
      messageId,
    ]);
    const ownOther = newUuid();
    await isolated.db.query(
      "INSERT INTO consultations(id,shop_id,customer_id,status,ended_at) VALUES($1,$2,$3,'ended',$4)",
      [ownOther, shop.shopId, shop.customerId, NOW],
    );
    await expectProblem(await call(`?cursor=${first.nextCursor}`, ownOther), "validation_failed");
  });
  it("참고 사진은 저장 위치를 감춘15분 서명 주소만 보임", async () => {
    const key = `shops/${shop.shopId}/reference/${newUuid()}.webp`;
    await isolated.db.query("UPDATE messages SET kind='photo' WHERE id=$1", [shop.messageId]);
    await isolated.db.query(
      "INSERT INTO reference_photos(shop_id,draft_id,message_id,storage_key,content_type,byte_size) VALUES($1,$2,$3,$4,'image/webp',32)",
      [shop.shopId, shop.draftId, shop.messageId, key],
    );
    const body = await page(await call()),
      url = new URL(body.items[0]?.photos[0]?.url ?? "");
    expect(url.pathname).toMatch(/^\/api\/files\/v1\//);
    expect(Number(url.searchParams.get("exp"))).toBe(NOW.getTime() / 1000 + 900);
    expect(JSON.stringify(body)).not.toContain(key);
    expect(JSON.stringify(body)).not.toContain("storage_key");
  });
  it("개인정보를 지운 주문의 안내를 대화에 다시 섞지 않음", async () => {
    const id = newUuid();
    await isolated.db.query(
      "INSERT INTO notifications(shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body) VALUES($1,$2,$3,$4,'payment_request',$5,'synthetic','지운 주문의 안내')",
      [shop.shopId, shop.customerId, shop.consultationId, shop.orderId, `notice:${id}:payment_request`],
    );
    await isolated.db.query(
      "UPDATE orders SET status='cancelled',cancelled_at=$2,cancel_kind='customer',finished_at=$3,personal_data_purged_at=$2,lock_version=lock_version+1 WHERE id=$1",
      [shop.orderId, NOW, new Date(NOW.getTime() - 31 * 86400000)],
    );
    const body = await page(await call());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.messageId).toBe(shop.messageId);
    expect(JSON.stringify(body)).not.toContain("지운 주문의 안내");
  });
  it("끝난 상담은 내용을 지우기 전까지 ended로 그대로 보임", async () => {
    await isolated.db.query("UPDATE consultations SET status='ended',ended_at=$2 WHERE id=$1", [
      shop.consultationId,
      NOW,
    ]);
    const body = await page(await call());
    expect(body.status).toBe("ended");
    expect(body.items).toHaveLength(1);
  });
  it("최소 역할로 복원·안내·사진을 조회하고 민감한 값은 로그에 없음", async () => {
    const phone = "01000005678",
      notice = newUuid(),
      key = `shops/${shop.shopId}/reference/${newUuid()}.webp`;
    const masked = await shopRequestDb(
      createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }),
      isolated.db,
    ).transaction((tx) => maskValue(tx, fc, shop.consultationId, "phone", phone));
    await isolated.db.query("UPDATE messages SET body_masked=$2,kind='photo' WHERE id=$1", [shop.messageId, masked]);
    await isolated.db.query(
      "INSERT INTO reference_photos(shop_id,draft_id,message_id,storage_key,content_type,byte_size) VALUES($1,$2,$3,$4,'image/webp',32)",
      [shop.shopId, shop.draftId, shop.messageId, key],
    );
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body) VALUES($1,$2,$3,$4,'owner_reply',$5,'synthetic','제한 역할 답')",
      [notice, shop.shopId, shop.customerId, shop.consultationId, `notice:${notice}:owner_reply`],
    );
    const body = await page(
      await call("", shop.consultationId, true, false, () => pgConnector(new Secret(runtimeUrl))),
    );
    expect(body.items.find((x) => x.messageId === shop.messageId)).toMatchObject({
      text: phone,
      photos: [{ url: expect.any(String) }],
    });
    expect(body.items.find((x) => x.messageId === notice)).toMatchObject({
      author: "owner",
      delivery: "sending",
      photos: [],
    });
    expect(JSON.stringify(logs)).not.toContain(phone);
    expect(JSON.stringify(logs)).not.toContain(key);
  });
  it.each([
    ["pending", "sending"],
    ["retrying", "sending"],
    ["confirming", "sending"],
    ["sent", "event_api"],
    ["deferred", "deferred"],
    ["delivered_on_reply", "delivered_later"],
    ["dropped", "failed"],
  ])("안내 전달 상태 %s는 %s", async (status, delivery) => {
    const id = newUuid(),
      sent = status === "sent" || status === "delivered_on_reply",
      task = status === "sent" || status === "confirming",
      created = new Date(NOW.getTime() - 60000);
    await isolated.db.query("UPDATE messages SET created_at=$2 WHERE id=$1", [
      shop.messageId,
      new Date(NOW.getTime() - 120000),
    ]);
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status,created_at,sent_at,kakao_task_id,requested_at) VALUES($1,$2,$3,$4,'payment_request',$5,'synthetic','합성 안내 [계좌번호1]',$6,$7,$8,$9,$10)",
      [
        id,
        shop.shopId,
        shop.customerId,
        shop.consultationId,
        `notice:${id}:payment_request`,
        status,
        created,
        sent ? NOW : null,
        task ? "synthetic-task" : null,
        task ? NOW : null,
      ],
    );
    const body = await page(await call()),
      item = body.items.find((x) => x.messageId === id);
    expect(item).toMatchObject({ author: "notice", delivery, text: "합성 안내 [계좌번호1]", photos: [] });
    expect(Date.parse(item?.at ?? "")).toBe((sent ? NOW : created).getTime());
  });
  it("다른 가게에 묶어 암호화한 값은 내용 없이500이고 로그에 원문 없음", async () => {
    const phone = "01000005678",
      scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db);
    const token = await scoped.transaction((tx) => maskValue(tx, fc, shop.consultationId, "phone", phone));
    const sealed = await fc.seal(phone, { purpose: "masked_values.original", shopId: newUuid() });
    await isolated.db.query("UPDATE masked_values SET original_enc=$3 WHERE shop_id=$1 AND consultation_id=$2", [
      shop.shopId,
      shop.consultationId,
      sealed,
    ]);
    await isolated.db.query("UPDATE messages SET body_masked=$2 WHERE id=$1", [shop.messageId, token]);
    const response = await call();
    await expectProblem(response, "internal");
    expect(JSON.stringify(logs)).not.toContain(phone);
    expect(JSON.stringify(logs)).not.toContain(sealed);
  });
  it("계약의100000자를 지킬 때 마지막 이모지까지 보존함", async () => {
    const text = "가".repeat(99999) + "🙂";
    await isolated.db.query("UPDATE messages SET body_masked=$2 WHERE id=$1", [shop.messageId, text]);
    const body = await page(await call());
    expect(body.items[0]?.text).toBe(text);
  });
  it("복원으로100000자를 넘으면 표시만 한도로 줄이고 저장된 글은 그대로", async () => {
    const token = await shopRequestDb(
      createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }),
      isolated.db,
    ).transaction((tx) => maskValue(tx, fc, shop.consultationId, "phone", "01012345678901234567"));
    const original = token.repeat(14000);
    await isolated.db.query("UPDATE messages SET body_masked=$2 WHERE id=$1", [shop.messageId, original]);
    const body = await page(await call());
    expect(Array.from(body.items[0]?.text ?? "")).toHaveLength(100000);
    expect((await isolated.db.query("SELECT body_masked FROM messages WHERE id=$1", [shop.messageId])).rows).toEqual([
      { body_masked: original },
    ]);
  });
  it("메시지와 같은 ID인 안내에는 메시지 사진을 붙이지 않음", async () => {
    const key = `shops/${shop.shopId}/reference/${newUuid()}.webp`;
    await isolated.db.query("UPDATE messages SET kind='photo' WHERE id=$1", [shop.messageId]);
    await isolated.db.query(
      "INSERT INTO reference_photos(shop_id,draft_id,message_id,storage_key,content_type,byte_size) VALUES($1,$2,$3,$4,'image/webp',32)",
      [shop.shopId, shop.draftId, shop.messageId, key],
    );
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body) VALUES($1,$2,$3,$4,'owner_reply',$5,'synthetic','같은 ID의 안내')",
      [shop.messageId, shop.shopId, shop.customerId, shop.consultationId, `notice:${shop.messageId}:owner_reply`],
    );
    const body = await page(await call());
    expect(body.items.find((x) => x.author === "owner")?.photos).toEqual([]);
    expect(body.items.find((x) => x.author === "customer")?.photos).toHaveLength(1);
  });
  it("유효한 base64여도 잘못된 커서 내용·범위·상담은422", async () => {
    for (const value of [
      null,
      [],
      [1, shop.consultationId, "9223372036854775808", "1"],
      [1, shop.consultationId, "0", "0"],
      [1, shop.shopId, "0", "1"],
    ]) {
      const token = toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
      await expectProblem(await call(`?cursor=${token}`), "validation_failed");
    }
  });
});
