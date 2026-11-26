/** 저장/입력 계약이 허용하는 경계에서도 가린 응답의 형식과 원문 차단을 지킨다. */
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { CLIENT_IP_HEADER, TEST_IPV4 } from "./support/access-log";
import { expectSchema } from "./support/contract";
import { describeDb, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createShop } from "./support/shops";

const NOW = new Date("2026-11-28T06:00:00Z");
describeDb("운영자 가린 값의 입력 경계(TASK-159)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
  });
  it.each([
    ["*별", "--------", null, null],
    ["\t별", "12------", null, null],
    ["  별  ", "1234----", "별", "***-****-1234"],
    ["별", "--012345", "별", "***-****-2345"],
  ] as const)("이름 %s와 연락처 %s는 가린 목록/상세 계약을 지킨다", async (name, phone, maskedName, maskedPhone) => {
    const shop = await createShop(isolated.db, "합성 가린 값 경계"),
      session = await seedOperatorSession(isolated.db, NOW),
      app = createApp({ connect: () => isolated.connect(), services: { now: () => NOW } });
    await isolated.db.query("UPDATE order_details SET customer_name=$2,customer_phone=$3 WHERE order_id=$1", [
      shop.orderId,
      name,
      phone,
    ]);
    for (const suffix of ["/records", `/orders/${shop.orderId}`]) {
      const response = await app.request(
          `https://siljang.example/api/operator/shops/${shop.shopId}${suffix}`,
          { headers: { cookie: session.cookie, [CLIENT_IP_HEADER]: TEST_IPV4 } },
          testEnv(),
        ),
        body = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(200);
      expectSchema(suffix === "/records" ? "OperatorRecordList" : "OperatorOrder", body);
      const item = suffix === "/records" ? (body.orders as Record<string, unknown>[])[0] : body;
      expect(item).toMatchObject({ customerNameMasked: maskedName, customerPhoneMasked: maskedPhone });
      expect(JSON.stringify(body)).not.toContain(phone);
    }
  });
});
