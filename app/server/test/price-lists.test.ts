import { afterAll, expect, it } from "vitest";
import { type AppOptions, createApp } from "../src/app";
import { ApiError } from "../src/problem";
import { createShopScope } from "../src/shop-scope";
import { expectProblem, expectSchema } from "./support/contract";
import { collectLogs, describeDb, newRequestKey, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { MemoryStore } from "./support/storage";

const ORIGIN = "https://siljang.example";
const NOW = new Date("2026-11-22T05:00:00Z");
const db = testDb();
const OWNER = "x-test-owner";

function input(baseRevision: string | null = null) {
  return {
    baseRevision,
    options: [
      {
        key: "size",
        group: "size",
        name: "1호",
        priceKind: "fixed",
        amount: 35000,
        amountMax: null,
        inStandard: true,
        position: 0,
      },
      {
        key: "flavor",
        group: "flavor",
        name: "생크림",
        priceKind: "fixed",
        amount: 0,
        amountMax: null,
        inStandard: true,
        position: 0,
      },
    ],
    rules: [],
    designs: [],
  };
}

async function fixture(options: AppOptions = {}) {
  const ownerId = newUuid(),
    shopId = newUuid();
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO owners (id,kakao_account_id) VALUES ($1,$2)", [
      ownerId,
      BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 13)}`).toString(),
    ]);
    await tx.query(
      `INSERT INTO shops (id,owner_id,name,contact_phone,contact_email,business_address,business_name,representative_name,business_reg_no,mail_order_exemption,food_license_no,food_business_type,license_photo_key,entrustment_terms_version,entrustment_consented_at)
      VALUES ($1,$2,'가격표 합성 가게','010-0000-0000','price@example.com','서울 합성로1','합성 제과','시험사장','1234567890','합성 면제','2026-0001','bakery','license/synthetic.jpg','test-v1',$3)`,
      [shopId, ownerId, NOW],
    );
  });
  const store = new MemoryStore();
  const logs = collectLogs();
  const app = createApp({
    scopes: {
      owner: async (c) => {
        if (c.req.header(OWNER) !== ownerId) throw new ApiError("unauthenticated");
        return createShopScope(shopId, { kind: "owner", ownerId });
      },
    },
    services: { storage: store, now: () => NOW },
    logSink: logs.sink,
    ...options,
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
      testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
    );
  }
  return { app, store, ownerId, shopId, call, logs };
}

describeDb("TASK-038 가격표 버전 API-016~019", () => {
  afterAll(async () => db.close());

  it("설정 전 현재 가격표는404 not_set, 버전 목록은200 빈 목록", async () => {
    const h = await fixture();
    await expectProblem(await h.call("GET", "/owner/price-list"), "not_set");
    const versions = await h.call("GET", "/owner/price-list/versions");
    expect(versions.status).toBe(200);
    expect(await versions.json()).toEqual({ items: [] });
    await expectProblem(await h.call("GET", "/owner/price-list/versions/1"), "not_found");
  });

  it("첫 저장은201 버전1이고 현재/버전 하나/목록으로 읽힘", async () => {
    const h = await fixture();
    const response = await h.call("POST", "/owner/price-list/versions", input());
    expect(response.status, (await response.clone().text()) + JSON.stringify(h.logs.lines)).toBe(201);
    const result = (await response.json()) as { priceList: { revision: string } };
    expectSchema("PriceListResult", result);
    expect(result).toMatchObject({
      outcome: "created",
      priceList: {
        version: 1,
        current: true,
        options: [
          { name: "1호", amount: 35000 },
          { name: "생크림", amount: 0 },
        ],
        rules: [],
        designs: [],
      },
    });
    for (const path of ["/owner/price-list", "/owner/price-list/versions/1"]) {
      const read = await h.call("GET", path);
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual(result.priceList);
    }
    const list = await (await h.call("GET", "/owner/price-list/versions")).json();
    expectSchema("VersionList", list);
    expect(list).toMatchObject({ items: [{ version: 1, supersededAt: null }] });
    const same = await h.call("POST", "/owner/price-list/versions", input(result.priceList.revision));
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({
      outcome: "unchanged",
      priceList: { version: 1, revision: result.priceList.revision },
    });
  });

  it.each([
    ["GET", "/owner/price-list", undefined],
    ["POST", "/owner/price-list/versions", input()],
    ["GET", "/owner/price-list/versions", undefined],
    ["GET", "/owner/price-list/versions/1", undefined],
  ])("인증 없는 %s %s는401", async (method, path, body) => {
    const h = await fixture();
    await expectProblem(await h.call(method, path, body, false), "unauthenticated");
  });
});
