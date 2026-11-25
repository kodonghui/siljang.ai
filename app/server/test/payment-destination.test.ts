import { afterAll, describe, expect, it } from "vitest";
import { type AppOptions, createApp } from "../src/app";
import { pgConnector, type Queryable, type RequestDb } from "../src/db";
import { createOwnerSession } from "../src/owner-session";
import { parsePaymentDestination } from "../src/payment-destination-input";
import { ApiError } from "../src/problem";
import { createShopScope } from "../src/shop-scope";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, newUuid, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { createShop, type ShopFixture } from "./support/shops";

const ORIGIN = "https://siljang.example";
const PATH = "/owner/payment-destination";
const NOW = new Date("2026-11-22T05:00:00Z");
const db = testDb();
const OWNER = "x-test-owner";

function input(baseRevision: string | null = null) {
  return {
    baseRevision,
    bankName: "합성은행",
    accountNumber: "123456-01-234567",
    holderName: "시험사장",
    cardPaymentUrl: null,
  };
}

async function fixture(options: AppOptions = {}, existing?: ShopFixture) {
  const ownerId = existing?.ownerId ?? newUuid(),
    shopId = existing?.shopId ?? newUuid();
  const { fc } = singleKeyCrypto();
  if (!existing)
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO owners (id,kakao_account_id) VALUES ($1,$2)", [
        ownerId,
        BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 13)}`).toString(),
      ]);
      await tx.query(
        `INSERT INTO shops (id,owner_id,name,contact_phone,contact_email,business_address,business_name,representative_name,business_reg_no,mail_order_exemption,food_license_no,food_business_type,license_photo_key,entrustment_terms_version,entrustment_consented_at)
       VALUES ($1,$2,'계좌 합성 가게','010-0000-0000','account@example.com','서울 합성로1','합성 제과','시험사장','1234567890','합성 면제','2026-0001','bakery','license/synthetic.jpg','test-v1',$3)`,
        [shopId, ownerId, NOW],
      );
    });
  const app = createApp({
    scopes: {
      owner: async (c) => {
        if (c.req.header(OWNER) !== ownerId) throw new ApiError("unauthenticated");
        return createShopScope(shopId, { kind: "owner", ownerId });
      },
    },
    services: { now: () => NOW, fieldCrypto: fc },
    logSink: () => {},
    ...options,
  });
  const call = (method: string, body?: unknown, authenticated = true, key = newRequestKey()) =>
    app.request(
      `${ORIGIN}/api${PATH}`,
      {
        method,
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "Idempotency-Key": key,
          ...(authenticated ? { [OWNER]: ownerId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      testEnv(),
    );
  return { shopId, ownerId, fc, app, call };
}

async function saved(h: Awaited<ReturnType<typeof fixture>>, body = input()) {
  const response = await h.call("PUT", body);
  expect(response.status, await response.clone().text()).toBe(200);
  const result = (await response.json()) as {
    outcome: string;
    paymentDestination: { revision: string; accountNumber: string; holderMismatchConfirmed: boolean | null };
  };
  expectSchema("PaymentDestinationResult", result);
  return result.paymentDestination;
}

async function verified(h: Awaited<ReturnType<typeof fixture>>, holder = "시험사장") {
  const operator = await db.query<{ id: string }>(
    "INSERT INTO operators (email,display_name) VALUES ($1,'합성 운영자') RETURNING id",
    [`${newUuid()}@operator.example`],
  );
  const id = operator.rows[0]?.id;
  await db.query(
    "UPDATE payment_accounts SET holder_name=$2,holder_checked_by=$3,holder_checked_at=$4 WHERE shop_id=$1 AND retired_at IS NULL",
    [h.shopId, holder, id, NOW],
  );
  await db.query(
    "UPDATE shops SET license_status='verified',license_reviewed_by=$2,license_reviewed_at=$3 WHERE id=$1",
    [h.shopId, id, NOW],
  );
  return id;
}

async function read(h: Awaited<ReturnType<typeof fixture>>) {
  const response = await h.call("GET");
  expect(response.status, await response.clone().text()).toBe(200);
  const value = (await response.json()) as { revision: string; accountNumber: string };
  expectSchema("PaymentDestination", value);
  return value;
}

describeDb("TASK-040 API-024/025 결제 계좌", () => {
  afterAll(async () => db.close());

  it("새 가게는 계좌 미등록 404이고 처음 저장은 암호화한 자기 계좌 200임", async () => {
    const h = await fixture();
    await expectProblem(await h.call("GET"), "not_set");
    const saved = await h.call("PUT", input());
    expect(saved.status, await saved.clone().text()).toBe(200);
    const value = await saved.json();
    expectSchema("PaymentDestinationResult", value);
    expect(value).toMatchObject({
      outcome: "created",
      paymentDestination: {
        bankName: input().bankName,
        accountNumber: input().accountNumber,
        holderName: input().holderName,
        cardPaymentUrl: null,
        holderMismatchConfirmed: null,
      },
    });
    const rows = await db.query<{ account_number_enc: string; account_last4: string }>(
      "SELECT * FROM payment_accounts WHERE shop_id=$1",
      [h.shopId],
    );
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0];
    expect(row?.account_last4).toBe("4567");
    expect(JSON.stringify(rows.rows)).not.toContain(input().accountNumber);
    expect(
      await h.fc.open(row?.account_number_enc ?? "", { purpose: "payment_accounts.account_number", shopId: h.shopId }),
    ).toBe(input().accountNumber);
    const read = await h.call("GET");
    expect(read.status).toBe(200);
    expectSchema("PaymentDestination", await read.json());
    expect((await db.query("SELECT id FROM owner_alerts WHERE shop_id=$1", [h.shopId])).rowCount).toBe(0);
  });

  it.each(["GET", "PUT"])("인증 없는 %s는 401임", async (method) => {
    const h = await fixture();
    await expectProblem(await h.call(method, method === "PUT" ? input() : undefined, false), "unauthenticated");
  });

  it("다른 예금주는 확인 전409·DB0건이고 확인 뒤 답을 남김", async () => {
    const h = await fixture();
    const body = { ...input(), holderName: "다른 합성 이름" };
    await expectProblem(await h.call("PUT", body), "confirmation_required");
    expect((await db.query("SELECT id FROM payment_accounts WHERE shop_id=$1", [h.shopId])).rowCount).toBe(0);
    const saved = await h.call("PUT", { ...body, confirm: ["holder_mismatch"] });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await saved.json()).toMatchObject({
      outcome: "created",
      paymentDestination: { holderMismatchConfirmed: true },
    });
  });

  it("같은 입력은 unchanged·같은 키는 원래 계좌를 재전송하며 확인 답도 보존함", async () => {
    const h = await fixture();
    const key = newRequestKey();
    const body = { ...input(), holderName: "다른 합성 이름", confirm: ["holder_mismatch"] };
    const first = await h.call("PUT", body, true, key);
    expect(first.status).toBe(200);
    const firstValue = (await first.json()) as { paymentDestination: { revision: string } };
    const replay = await h.call("PUT", body, true, key);
    expect(await replay.json()).toEqual(firstValue);
    const unchanged = await h.call("PUT", {
      ...body,
      baseRevision: firstValue.paymentDestination.revision,
      confirm: [],
    });
    expect(await unchanged.json()).toMatchObject({
      outcome: "unchanged",
      paymentDestination: { holderMismatchConfirmed: true, revision: firstValue.paymentDestination.revision },
    });
    await expectProblem(await h.call("PUT", { ...body, bankName: "다른 은행" }, true, key), "idempotency_key_reused");
    expect((await db.query("SELECT id FROM payment_accounts WHERE shop_id=$1", [h.shopId])).rowCount).toBe(1);
  });

  it("계좌 변경은 옛 행/이미 나간 안내를 보존하고 새 안내의 현재 계좌와 알림 한 건을 남김", async () => {
    const shop = await createShop(db, "합성 계좌 보존 가게");
    const h = await fixture({}, shop);
    const oldNumber = input().accountNumber;
    const enc = await h.fc.seal(oldNumber, { shopId: h.shopId, purpose: "payment_accounts.account_number" });
    await db.query("UPDATE payment_accounts SET account_number_enc=$2,account_last4='4567' WHERE shop_id=$1", [
      h.shopId,
      enc,
    ]);
    await verified(h);
    const old = await read(h);
    const before = await db.query("SELECT row_to_json(p) AS row FROM payment_requests p WHERE p.shop_id=$1", [
      h.shopId,
    ]);
    const replacement = {
      ...input(old.revision),
      accountNumber: "999999-12-345678",
      cardPaymentUrl: "https://pay.example/new",
    };
    const key = newRequestKey();
    const response = await h.call("PUT", replacement, true, key);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: "created",
      paymentDestination: { accountNumber: replacement.accountNumber },
    });
    const rows = await db.query<{ id: string; retired_at: Date | null; account_number_enc: string }>(
      "SELECT * FROM payment_accounts WHERE shop_id=$1 ORDER BY retired_at NULLS LAST",
      [h.shopId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.id).toBe(shop.paymentAccountId);
    expect(rows.rows[0]?.retired_at).not.toBeNull();
    expect(
      await h.fc.open(rows.rows[0]?.account_number_enc ?? "", {
        shopId: h.shopId,
        purpose: "payment_accounts.account_number",
      }),
    ).toBe(oldNumber);
    expect(
      (await db.query("SELECT row_to_json(p) AS row FROM payment_requests p WHERE p.shop_id=$1", [h.shopId])).rows,
    ).toEqual(before.rows);
    const current = rows.rows[1];
    await db.query(
      "UPDATE payment_requests SET status='closed',closed_at=now(),close_reason='superseded' WHERE shop_id=$1",
      [h.shopId],
    );
    await db.query(
      `INSERT INTO payment_requests (shop_id,order_id,kind,event_key,amount,payment_account_id,card_payment_url,due_at,due_cap_at)
      SELECT $1,$2,'reissue',$3,35000,p.id,p.card_payment_url,now()+interval '12 hours',now()+interval '12 hours'
      FROM payment_accounts p WHERE p.shop_id=$1 AND p.retired_at IS NULL`,
      [h.shopId, shop.orderId, `pay:${shop.paymentRequestId}:reissue`],
    );
    const requests = await db.query<{ kind: string; payment_account_id: string; card_payment_url: string | null }>(
      "SELECT kind,payment_account_id,card_payment_url FROM payment_requests WHERE shop_id=$1 ORDER BY kind",
      [h.shopId],
    );
    expect(requests.rows).toEqual([
      { kind: "first", payment_account_id: shop.paymentAccountId, card_payment_url: null },
      { kind: "reissue", payment_account_id: current?.id, card_payment_url: replacement.cardPaymentUrl },
    ]);
    const replay = await h.call("PUT", replacement, true, key);
    expect(replay.status).toBe(200);
    const alerts = await db.query<{ kind: string; owner_task_id: string | null; event_key: string }>(
      "SELECT * FROM owner_alerts WHERE shop_id=$1",
      [h.shopId],
    );
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0]).toMatchObject({
      kind: "payment_account_changed",
      owner_task_id: null,
      event_key: `alert:payment_account_changed:${current?.id}`,
    });
    expect(JSON.stringify(alerts.rows)).not.toContain(replacement.accountNumber);
    expect(JSON.stringify(alerts.rows)).not.toContain(oldNumber);
  });

  it("확인되지 않은 다른 예금주는 추가 확인을 해도409이며 옛 계좌를 보존함", async () => {
    const h = await fixture();
    await saved(h);
    await verified(h);
    const previous = await read(h);
    await expectProblem(
      await h.call("PUT", { ...input(previous.revision), holderName: "다른 합성 이름", confirm: ["holder_mismatch"] }),
      "holder_not_verified",
    );
    expect(await read(h)).toEqual(previous);
    expect((await db.query("SELECT id FROM payment_accounts WHERE shop_id=$1", [h.shopId])).rowCount).toBe(1);
    expect((await db.query("SELECT id FROM owner_alerts WHERE shop_id=$1", [h.shopId])).rowCount).toBe(0);
  });

  it.each(["시험사장", "합성 제과", "운영자 확인 이름"])(
    "확인된 대표자·상호·운영자 확인 이름 %s의 새 계좌를 허용함",
    async (holderName) => {
      const h = await fixture();
      await saved(h);
      await verified(h, "운영자 확인 이름");
      const old = await read(h);
      const changed = await saved(h, { ...input(old.revision), holderName, accountNumber: "1111111111" });
      expect(changed.accountNumber).toBe("1111111111");
      expect(changed.holderMismatchConfirmed).toBeNull();
    },
  );

  it("영업 신고 직전에 확인한 예금주는 계좌 교체 뒤에도 운영자 확인 이름으로 허용함", async () => {
    let current = NOW;
    const h = await fixture({ services: { now: () => current, fieldCrypto: singleKeyCrypto().fc } });
    await saved(h);
    await verified(h, "운영자 확인 이름");
    await db.query("UPDATE shops SET license_reviewed_at=$2 WHERE id=$1", [h.shopId, new Date(NOW.getTime() + 1000)]);
    current = new Date(NOW.getTime() + 2000);
    let previous = await read(h);
    for (const number of ["7777777777", "8888888888"]) {
      await saved(h, { ...input(previous.revision), holderName: "운영자 확인 이름", accountNumber: number });
      previous = await read(h);
    }
  });

  it("보류된 가게의 교체는 다시 확인 기다림이 되고 다른 신원/확인 상태는 그대로임", async () => {
    const h = await fixture();
    await saved(h);
    const operator = await verified(h);
    await db.query("UPDATE shops SET license_status='on_hold',license_hold_reason='합성 보류' WHERE id=$1", [h.shopId]);
    const old = await read(h);
    await saved(h, { ...input(old.revision), accountNumber: "2222222222" });
    const shop = await db.query(
      "SELECT license_status,license_hold_reason,license_reviewed_by,license_reviewed_at,business_name,representative_name FROM shops WHERE id=$1",
      [h.shopId],
    );
    expect(shop.rows).toEqual([
      {
        license_status: "pending",
        license_hold_reason: null,
        license_reviewed_by: null,
        license_reviewed_at: null,
        business_name: "합성 제과",
        representative_name: "시험사장",
      },
    ]);
    expect(operator).toBeTruthy();
  });

  it("동시 다른 키는200/409이고 같은 키는 재전송 또는 처리 중 뒤 원래 계좌를 읽음", async () => {
    const h = await fixture();
    const results = await Promise.all([
      h.call("PUT", input()),
      h.call("PUT", { ...input(), accountNumber: "3333333333" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const h2 = await fixture();
    const key = newRequestKey();
    const repeats = await Promise.all([h2.call("PUT", input(), true, key), h2.call("PUT", input(), true, key)]);
    expect(repeats.some((r) => r.status === 200)).toBe(true);
    for (const response of repeats) {
      if (response.status === 409) await expectProblem(response, "request_in_progress");
      else expect(response.status).toBe(200);
    }
    const replay = await h2.call("PUT", input(), true, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect((await db.query("SELECT id FROM payment_accounts WHERE shop_id=$1", [h2.shopId])).rowCount).toBe(1);
  });

  it("옛 revision/null은409이며 같은 내용이어도 충돌을 우회하지 않음", async () => {
    const h = await fixture();
    const first = await saved(h);
    await saved(h, { ...input(first.revision), accountNumber: "4444444444" });
    await expectProblem(
      await h.call("PUT", { ...input(first.revision), accountNumber: "4444444444" }),
      "version_conflict",
    );
    await expectProblem(await h.call("PUT", input()), "version_conflict");
  });

  it("새 계좌 쓰기 실패는 옛 행 교체/알림을 되돌리고 같은 키로 다시 저장함", async () => {
    let fail = false;
    const h = await fixture({
      connect: (settings) => {
        const base = pgConnector(settings);
        const wrap = (tx: Queryable): Queryable => ({
          query: <R = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => {
            if (fail && /INSERT INTO payment_accounts/.test(sql)) throw new Error("synthetic account insert failure");
            return tx.query<R>(sql, params);
          },
        });
        return {
          query: (sql, params) => base.query(sql, params),
          close: () => base.close(),
          abort: () => base.abort(),
          transaction: <T>(fn: (tx: Parameters<Parameters<RequestDb["transaction"]>[0]>[0]) => Promise<T>) =>
            base.transaction((tx) => fn(wrap(tx))),
        };
      },
    });
    const first = await saved(h);
    const key = newRequestKey();
    const next = { ...input(first.revision), accountNumber: "5555555555" };
    fail = true;
    await expectProblem(await h.call("PUT", next, true, key), "internal");
    expect((await db.query("SELECT retired_at FROM payment_accounts WHERE shop_id=$1", [h.shopId])).rows).toEqual([
      { retired_at: null },
    ]);
    expect((await db.query("SELECT id FROM owner_alerts WHERE shop_id=$1", [h.shopId])).rowCount).toBe(0);
    fail = false;
    expect((await h.call("PUT", next, true, key)).status).toBe(200);
  });

  it.each(["GET", "PUT"])("가게 없는 실제 세션의 %s는404임", async (method) => {
    const session = await createOwnerSession(
      db,
      { accountId: BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 13)}`).toString(), friend: false },
      NOW,
      false,
    );
    const app = createApp({ services: { now: () => NOW }, logSink: () => {} });
    const response = await app.request(
      `${ORIGIN}/api${PATH}`,
      {
        method,
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "Idempotency-Key": newRequestKey(),
          cookie: `siljang_owner=${session.token}`,
        },
        ...(method === "PUT" ? { body: JSON.stringify(input()) } : {}),
      },
      testEnv(),
    );
    await expectProblem(response, "shop_not_registered");
  });

  it.each(["GET", "PUT"])("DB 장애의 %s는500이고 내부 오류 값은 반환하지 않음", async (method) => {
    const h = await fixture({
      connect: () => ({
        query: async () => {
          throw new Error("synthetic private database failure");
        },
        transaction: async () => {
          throw new Error("synthetic private database failure");
        },
        close: async () => {},
        abort: async () => {},
      }),
    });
    const response = await h.call(method, method === "PUT" ? input() : undefined);
    const body = await expectProblem(response, "internal");
    expect(JSON.stringify(body)).not.toContain("synthetic private");
  });

  it("본문 형식·요청 키·필드 오류는422이고 계좌를 남기지 않음", async () => {
    const h = await fixture();
    for (const [contentType, body, key] of [
      ["text/plain", JSON.stringify(input()), newRequestKey()],
      ["application/json", "{", newRequestKey()],
      ["application/json", JSON.stringify(input()), null],
      ["application/json", JSON.stringify({ ...input(), accountNumber: "123" }), newRequestKey()],
    ] as const) {
      const response = await h.app.request(
        `${ORIGIN}/api${PATH}`,
        {
          method: "PUT",
          headers: {
            origin: ORIGIN,
            "content-type": contentType,
            [OWNER]: h.ownerId,
            ...(key === null ? {} : { "Idempotency-Key": key }),
          },
          body,
        },
        testEnv(),
      );
      expect(response.status, await response.clone().text()).toBe(422);
      expectSchema("Problem", await response.json());
    }
    expect((await db.query("SELECT id FROM payment_accounts WHERE shop_id=$1", [h.shopId])).rowCount).toBe(0);
  });
});

describe("결제 계좌 입력 경계", () => {
  it.each([
    ["bankName", ""],
    ["bankName", "가".repeat(31)],
    ["bankName", true],
    ["bankName", "가\0"],
    ["holderName", ""],
    ["holderName", "가".repeat(31)],
    ["holderName", 42],
    ["accountNumber", "123456789"],
    ["accountNumber", "12345678901234567"],
    ["accountNumber", "12345a67890"],
    ["accountNumber", null],
    ["accountNumber", `${"-".repeat(31)}1234567890`],
    ["baseRevision", "bad:revision"],
    ["baseRevision", "x".repeat(65)],
    ["baseRevision", 42],
    ["cardPaymentUrl", "http://pay.example"],
    ["cardPaymentUrl", "https://"],
    ["cardPaymentUrl", "https://pay.example/a\nnext"],
    ["cardPaymentUrl", true],
    ["cardPaymentUrl", `https://pay.example/${"x".repeat(2048)}`],
    ["confirm", ["other"]],
    ["confirm", ["holder_mismatch", "holder_mismatch"]],
    ["confirm", null],
    ["shopId", newUuid()],
  ])("%s의 잘못된 경계를 거절함", (key, value) => {
    expect(() => parsePaymentDestination({ ...input(), [key]: value })).toThrowError(ApiError);
  });
  it.each([null, [], "text", {}, { ...input(), cardPaymentUrl: undefined }])(
    "빠진 입력과 다른 본문 형식을 거절함",
    (body) => {
      expect(() => parsePaymentDestination(body)).toThrowError(ApiError);
    },
  );
  it("은행·예금주30자/계좌10·16자리/구분자40자/주소2048자와 확인 하나를 받음", () => {
    for (const accountNumber of ["1234567890", "1234567890123456", `${"-".repeat(30)}1234567890`]) {
      const value = {
        ...input("r".repeat(64)),
        bankName: "가".repeat(30),
        holderName: "나".repeat(30),
        accountNumber,
        cardPaymentUrl: `https://pay.example/${"x".repeat(2048 - 20)}`,
        confirm: ["holder_mismatch"],
      };
      expect([...value.cardPaymentUrl].length).toBe(2048);
      expect(parsePaymentDestination(value)).toMatchObject(value);
    }
  });
  it("정규화 뒤2048자를 넘는 한글 카드 결제 링크는 거절한다", () => {
    const cardPaymentUrl = `https://pay.example/${"가".repeat(400)}`;
    expect([...cardPaymentUrl].length).toBeLessThan(2048);
    expect(new URL(cardPaymentUrl).href.length).toBeGreaterThan(2048);
    expect(() => parsePaymentDestination({ ...input(), cardPaymentUrl })).toThrowError(ApiError);
  });
});
