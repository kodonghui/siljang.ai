import { afterAll, expect, it } from "vitest";
import { type AppOptions, createApp } from "../src/app";
import { pgConnector, type Queryable, type RequestDb } from "../src/db";
import { createOwnerScope, ownerOfShopScope } from "../src/owner-scope";
import { ApiError } from "../src/problem";
import { createShopScope, type ShopScope } from "../src/shop-scope";
import { StorageUnavailableError } from "../src/storage";
import { newUploadId, tempKey } from "../src/uploads";
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

interface PriceValue {
  version: number;
  revision: string;
  current: boolean;
  options: { optionId: string; name: string; amount: number; inStandard: boolean }[];
  designs: { designId: string; imageUrl: string; inStandard: boolean }[];
}
async function photo(
  h: Awaited<ReturnType<typeof fixture>>,
  at = NOW,
  purpose: "design_image" | "license_photo" = "design_image",
) {
  const id = newUploadId(purpose, at);
  await h.store.put(tempKey(createOwnerScope(h.ownerId), id), new Uint8Array([1, 2, 3]), "image/png");
  return id;
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

  it("도안과 기본 디자인 범위는 새 버전에 함께 남고 이전 버전의 금액/범위/사진은 보존됨", async () => {
    const h = await fixture();
    const uploadId = await photo(h);
    const body = {
      ...input(),
      designs: [{ name: "캐릭터 도안", uploadId, optionKey: null, inStandard: false, position: 0 }],
    };
    const firstResponse = await h.call("POST", "/owner/price-list/versions", body);
    expect(firstResponse.status, await firstResponse.clone().text()).toBe(201);
    const first = ((await firstResponse.json()) as { priceList: PriceValue }).priceList;
    const design = first.designs[0];
    if (!design) throw new Error("합성 도안 없음");
    const keys = [...h.store.objects.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^shops/${h.shopId}/design_image/[0-9a-f-]{36}/${uploadId}$`));
    const secondBody = {
      ...input(first.revision),
      options: input().options.map((o, i) => ({ ...o, amount: i === 0 ? 38000 : o.amount })),
      designs: [
        { name: "캐릭터 도안", sourceDesignId: design.designId, optionKey: null, inStandard: true, position: 0 },
      ],
    };
    const secondResponse = await h.call("POST", "/owner/price-list/versions", secondBody);
    expect(secondResponse.status, await secondResponse.clone().text()).toBe(201);
    const second = ((await secondResponse.json()) as { priceList: PriceValue }).priceList;
    expect(second.version).toBe(2);
    expect(second.options[0]?.amount).toBe(38000);
    expect(second.designs[0]).toMatchObject({ inStandard: true });
    const old = (await (await h.call("GET", "/owner/price-list/versions/1")).json()) as PriceValue;
    expect(old).toMatchObject({
      version: 1,
      current: false,
      options: [
        { amount: 35000, inStandard: true },
        { amount: 0, inStandard: true },
      ],
      designs: [{ inStandard: false }],
    });
    for (const url of [design.imageUrl, second.designs[0]?.imageUrl, old.designs[0]?.imageUrl]) {
      if (!url) throw new Error("합성 사진 주소 없음");
      const photoResponse = await h.app.request(url, {}, testEnv({ FILE_URL_KEY: TEST_HASH_KEY }));
      expect(photoResponse.status).toBe(200);
      expect([...new Uint8Array(await photoResponse.arrayBuffer())]).toEqual([1, 2, 3]);
    }
    expect([...h.store.objects.keys()]).toEqual(keys);
    const same = await h.call("POST", "/owner/price-list/versions", { ...secondBody, baseRevision: second.revision });
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({ outcome: "unchanged", priceList: { version: 2 } });
  });

  it("동시에 저장하면 한 버전만 만들고 같은 요청 키는 처음 버전을 다시 읽음", async () => {
    const h = await fixture();
    const key = newRequestKey(),
      secondKey = newRequestKey();
    const results = await Promise.all([
      h.call("POST", "/owner/price-list/versions", input(), true, key),
      h.call("POST", "/owner/price-list/versions", input(), true, secondKey),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const first = results.find((r) => r.status === 201);
    if (!first) throw new Error("합성 첫 버전 없음");
    const price = ((await first.json()) as { priceList: PriceValue }).priceList;
    expect((await db.query("SELECT count(*)::int AS n FROM price_lists WHERE shop_id=$1", [h.shopId])).rows).toEqual([
      { n: 1 },
    ]);
    const successfulKey = results[0]?.status === 201 ? key : secondKey;
    {
      const replay = await h.call("POST", "/owner/price-list/versions", input(), true, successfulKey);
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await replay.json()).toMatchObject({ outcome: "created", priceList: { version: 1 } });
      await expectProblem(
        await h.call("POST", "/owner/price-list/versions", input(price.revision), true, successfulKey),
        "idempotency_key_reused",
      );
    }
  });

  it.each([false, true])(
    "복사 실패(응답 유실=%s)는 새 복사본만 정리하고 이전 버전/사진/원본을 보존함",
    async (lost) => {
      const h = await fixture();
      const firstUpload = await photo(h);
      const firstResponse = await h.call("POST", "/owner/price-list/versions", {
        ...input(),
        designs: [{ name: "첫 도안", uploadId: firstUpload, optionKey: null, inStandard: true, position: 0 }],
      });
      const first = ((await firstResponse.json()) as { priceList: PriceValue }).priceList;
      const oldKeys = [...h.store.objects.keys()];
      const nextUpload = await photo(h);
      if (lost) {
        const copy = h.store.copy.bind(h.store);
        h.store.copy = async (from, to) => {
          await copy(from, to);
          throw new StorageUnavailableError("synthetic copy response lost");
        };
      } else h.store.failOn.add("copy");
      const response = await h.call("POST", "/owner/price-list/versions", {
        ...input(first.revision),
        designs: [{ name: "새 도안", uploadId: nextUpload, optionKey: null, inStandard: true, position: 0 }],
      });
      await expectProblem(response, "storage_unavailable");
      expect([...h.store.objects.keys()].filter((k) => k.startsWith("shops/"))).toEqual(oldKeys);
      expect(h.store.objects.has(tempKey(createOwnerScope(h.ownerId), nextUpload))).toBe(true);
      expect(await (await h.call("GET", "/owner/price-list")).json()).toMatchObject({ version: 1, current: true });
    },
  );

  it("커밋 응답 유실이면 실제로 쓰인 도안을 지우지 않고 같은 키가 저장된 결과를 읽음", async () => {
    let lose = true;
    const h = await fixture({
      connect: (secret) => {
        const base = pgConnector(secret);
        return {
          query: (sql, params) => base.query(sql, params),
          transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => {
            const result = await base.transaction(fn);
            if (lose) {
              lose = false;
              throw new Error("synthetic commit response lost");
            }
            return result;
          },
          abort: () => base.abort(),
          close: () => base.close(),
        } satisfies RequestDb;
      },
    });
    const uploadId = await photo(h),
      key = newRequestKey();
    const body = {
      ...input(),
      designs: [{ name: "커밋된 도안", uploadId, optionKey: null, inStandard: true, position: 0 }],
    };
    await expectProblem(await h.call("POST", "/owner/price-list/versions", body, true, key), "internal");
    const keys = [...h.store.objects.keys()].filter((k) => k.startsWith("shops/"));
    expect(keys).toHaveLength(1);
    const replay = await h.call("POST", "/owner/price-list/versions", body, true, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect([...h.store.objects.keys()].filter((k) => k.startsWith("shops/"))).toEqual(keys);
    expectSchema("PriceListResult", await replay.json());
  });

  it("사진 소유자 변환은 인증된 사장님 가게 범위만 허용함", () => {
    const ownerId = newUuid(),
      shopId = newUuid();
    expect(ownerOfShopScope(createShopScope(shopId, { kind: "owner", ownerId })).ownerId).toBe(ownerId);
    for (const scope of [
      createShopScope(shopId, { kind: "public" }),
      { shopId, via: { kind: "owner", ownerId } } as ShopScope,
    ])
      expect(() => ownerOfShopScope(scope)).toThrow();
  });
});
