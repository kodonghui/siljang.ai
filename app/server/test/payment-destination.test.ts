import { afterAll, expect, it } from "vitest";
import { type AppOptions, createApp } from "../src/app";
import { ApiError } from "../src/problem";
import { createShopScope } from "../src/shop-scope";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, newUuid, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";

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

async function fixture(options: AppOptions = {}) {
  const ownerId = newUuid(),
    shopId = newUuid();
  const { fc } = singleKeyCrypto();
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
      paymentDestination: { ...input(), holderMismatchConfirmed: null },
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
});
