import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { ApiError } from "../src/problem";
import { createShopScope } from "../src/shop-scope";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, newUuid, testDb, testEnv } from "./support/db";

const ORIGIN = "https://siljang.example";
const NOW = new Date("2026-11-22T05:00:00Z");
const db = testDb();
const OWNER = "x-test-owner";

function input(baseRevision: string | null = null) {
  return {
    baseRevision,
    quoteValidHours: 72,
    paymentDueHours: 12,
    issueReportHours: 24,
    changeDeadlineHours: 48,
    cancellationFeeKrw: 0,
    preProductionRefundPct: 100,
    dateChangeRefundBasis: "original_pickup",
    clauses: [
      {
        key: "pre_production_cancel",
        position: 1,
        title: "제작 전 취소",
        conditionText: "맞춤 재료를 주문하기 전이고 제작을 시작하기 전에 취소하는 경우",
        effectText: "취소 수수료만 빼고 모두 돌려드립니다.",
      },
    ],
    refundTiers: [],
  };
}

async function fixture() {
  const ownerId = newUuid(),
    shopId = newUuid();
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO owners (id,kakao_account_id) VALUES ($1,$2)", [
      ownerId,
      BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 13)}`).toString(),
    ]);
    await tx.query(
      `INSERT INTO shops (id,owner_id,name,contact_phone,contact_email,business_address,business_name,representative_name,business_reg_no,mail_order_exemption,food_license_no,food_business_type,license_photo_key,entrustment_terms_version,entrustment_consented_at)
      VALUES ($1,$2,'규정 합성 가게','010-0000-0000','rules@example.com','서울 합성로1','합성 제과','시험사장','1234567890','합성 면제','2026-0001','bakery','license/synthetic.jpg','test-v1',$3)`,
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
    services: { now: () => NOW },
    logSink: () => {},
  });
  async function call(method: string, path: string, body?: unknown, authenticated = true, key = newRequestKey()) {
    return app.request(
      `${ORIGIN}/api${path}`,
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
  }
  return { shopId, ownerId, app, call };
}

describeDb("TASK-039 운영규정 API-020~023", () => {
  afterAll(async () => db.close());

  it("새 가게는 기본 전액 환불/72·12·24시간 템플릿과 빈 버전 목록을 읽음", async () => {
    const h = await fixture();
    const response = await h.call("GET", "/owner/operating-rules");
    expect(response.status).toBe(200);
    const value = await response.json();
    expectSchema("OperatingRules", value);
    expect(value).toMatchObject({
      version: null,
      isTemplate: true,
      current: false,
      preProductionRefundPct: 100,
      preProductionLoweredAck: false,
      quoteValidHours: 72,
      paymentDueHours: 12,
      issueReportHours: 24,
      changeDeadlineHours: null,
      cancellationFeeKrw: 0,
      dateChangeRefundBasis: null,
      revision: null,
      clauses: [{ key: "pre_production_cancel", effectText: "취소 수수료만 빼고 모두 돌려드립니다." }],
    });
    const list = await h.call("GET", "/owner/operating-rules/versions");
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ items: [] });
    await expectProblem(await h.call("GET", "/owner/operating-rules/versions/1"), "not_found");
  });

  it("새 버전은201로 남고 현재/이전 조회·목록과 변경 없는 저장은200", async () => {
    const h = await fixture();
    const response = await h.call("POST", "/owner/operating-rules/versions", input());
    expect(response.status, await response.clone().text()).toBe(201);
    const result = (await response.json()) as { operatingRules: { revision: string } };
    expectSchema("OperatingRulesResult", result);
    expect(result).toMatchObject({
      outcome: "created",
      operatingRules: { version: 1, isTemplate: false, current: true, preProductionLoweredAck: false },
    });
    for (const path of ["/owner/operating-rules", "/owner/operating-rules/versions/1"])
      expect(await (await h.call("GET", path)).json()).toEqual(result.operatingRules);
    const list = await (await h.call("GET", "/owner/operating-rules/versions")).json();
    expectSchema("VersionList", list);
    expect(list).toMatchObject({ items: [{ version: 1, supersededAt: null }] });
    const same = await h.call("POST", "/owner/operating-rules/versions", input(result.operatingRules.revision));
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({ outcome: "unchanged", operatingRules: { version: 1 } });
  });

  it.each([
    ["GET", "/owner/operating-rules", undefined],
    ["POST", "/owner/operating-rules/versions", input()],
    ["GET", "/owner/operating-rules/versions", undefined],
    ["GET", "/owner/operating-rules/versions/1", undefined],
  ])("인증 없는 %s %s는401", async (method, path, body) => {
    const h = await fixture();
    await expectProblem(await h.call(method, path, body, false), "unauthenticated");
  });
});
