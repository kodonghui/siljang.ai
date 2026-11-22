import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { newSessionToken, tokenHash } from "../src/operator-session";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { createShop } from "./support/shops";

const ORIGIN = "https://siljang.example";
const NOW = new Date("2026-11-22T05:00:00Z");
const db = testDb();

async function fixture() {
  const shop = await createShop(db, "신고 확인 합성 가게");
  const operatorId = newUuid(),
    token = newSessionToken();
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO operators (id,email,display_name,auth_user_id,mfa_factor_id,mfa_enrolled_at) VALUES ($1,$2,'합성 운영자',$3,$4,$5)",
      [operatorId, `${newUuid()}@operator.example`, newUuid(), newUuid(), NOW],
    );
    await tx.query(
      "INSERT INTO operator_sessions (operator_id,token_hash,created_at,expires_at) VALUES ($1,$2,$3,$4)",
      [operatorId, await tokenHash(token), NOW, new Date(NOW.getTime() + 12 * 3_600_000)],
    );
  });
  const app = createApp({ services: { now: () => NOW }, logSink: () => {} });
  const call = (method: string, path: string, body?: unknown, authenticated = true) =>
    app.request(
      `${ORIGIN}/api${path}`,
      {
        method,
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "Idempotency-Key": newRequestKey(),
          ...(authenticated ? { cookie: `siljang_operator=${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
    );
  return { shop, operatorId, call };
}

describeDb("TASK-034 운영자의 영업 신고 확인 API-012/013/014", () => {
  afterAll(async () => db.close());
  it("운영자 세션으로 확인 기다림 목록을 읽음", async () => {
    const h = await fixture(),
      response = await h.call("GET", "/operator/shops");
    expect(response.status, await response.clone().text()).toBe(200);
    expectSchema("ReviewShopList", await response.json());
  });
  it("가게 상세는 은행/예금주/끝4자리와 신고증 주소만 보임", async () => {
    const h = await fixture(),
      response = await h.call("GET", `/operator/shops/${h.shop.shopId}`);
    expect(response.status, await response.clone().text()).toBe(200);
    const value = await response.json();
    expectSchema("ReviewShopDetail", value);
    expect(value).toMatchObject({
      shopId: h.shop.shopId,
      paymentAccount: { bankName: "시험은행", holderName: "시험사장", accountLast4: "9012" },
    });
    expect(JSON.stringify(value)).not.toContain(h.shop.customerId);
    expect(JSON.stringify(value)).not.toContain("accountNumber");
  });
  it("확인됨은 가게와 지금 계좌에 같은 운영자/시각을 함께 남김", async () => {
    const h = await fixture(),
      path = `/operator/shops/${h.shop.shopId}`;
    const response = await h.call("GET", path);
    expect(response.status).toBe(200);
    const current = (await response.json()) as { revision: string };
    const saved = await h.call("POST", `${path}/license-review`, {
      baseRevision: current.revision,
      decision: "verified",
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expectSchema("LicenseReviewResult", await saved.json());
    expect(
      (
        await db.query("SELECT license_status,license_reviewed_by,license_reviewed_at FROM shops WHERE id=$1", [
          h.shop.shopId,
        ])
      ).rows,
    ).toEqual([{ license_status: "verified", license_reviewed_by: h.operatorId, license_reviewed_at: NOW }]);
    expect(
      (
        await db.query(
          "SELECT holder_checked_by,holder_checked_at FROM payment_accounts WHERE shop_id=$1 AND retired_at IS NULL",
          [h.shop.shopId],
        )
      ).rows,
    ).toEqual([{ holder_checked_by: h.operatorId, holder_checked_at: NOW }]);
  });
  it.each(["list", "detail", "review"])("인증 없는 %s는401임", async (kind) => {
    const h = await fixture();
    const path =
      kind === "list"
        ? "/operator/shops"
        : `/operator/shops/${h.shop.shopId}${kind === "review" ? "/license-review" : ""}`;
    await expectProblem(
      await h.call(
        kind === "review" ? "POST" : "GET",
        path,
        kind === "review" ? { baseRevision: "revision", decision: "verified" } : undefined,
        false,
      ),
      "unauthenticated",
    );
  });
});
