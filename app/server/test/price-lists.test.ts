import { afterAll, expect, it } from "vitest";
import { type AppOptions, createApp } from "../src/app";
import { pgConnector, type Queryable, type RequestDb } from "../src/db";
import { createOwnerScope, ownerOfShopScope } from "../src/owner-scope";
import { createOwnerSession } from "../src/owner-session";
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

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("합성 시험 항목 없음");
  return value;
}

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

  it("가게 없는 실제 사장님 세션은 4개 경로 모두404 shop_not_registered", async () => {
    const session = await createOwnerSession(
      db,
      { accountId: BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 13)}`).toString(), friend: false },
      NOW,
      false,
    );
    const app = createApp({ services: { now: () => NOW }, logSink: () => {} });
    for (const [method, path] of [
      ["GET", "/owner/price-list"],
      ["POST", "/owner/price-list/versions"],
      ["GET", "/owner/price-list/versions"],
      ["GET", "/owner/price-list/versions/1"],
    ] as const)
      await expectProblem(
        await app.request(
          `${ORIGIN}/api${path}`,
          {
            method,
            headers: {
              origin: ORIGIN,
              cookie: `siljang_owner=${session.token}`,
              "content-type": "application/json",
              "Idempotency-Key": newRequestKey(),
            },
            ...(method === "POST" ? { body: JSON.stringify(input()) } : {}),
          },
          testEnv(),
        ),
        "shop_not_registered",
      );
  });

  it("DB 장애는4개 경로 모두500이며 내부 오류를 응답에 싣지 않음", async () => {
    const h = await fixture({
      connect: () => {
        throw new Error("synthetic private database failure");
      },
    });
    for (const [method, path] of [
      ["GET", "/owner/price-list"],
      ["POST", "/owner/price-list/versions"],
      ["GET", "/owner/price-list/versions"],
      ["GET", "/owner/price-list/versions/1"],
    ] as const) {
      const problem = await expectProblem(
        await h.call(method, path, method === "POST" ? input() : undefined),
        "internal",
      );
      expect(JSON.stringify(problem)).not.toContain("private database");
    }
  });

  it.each(["0", "-1", "1.5", "not-a-version", "2147483648", "9".repeat(101)])(
    "잘못되거나 없는 버전 %s는404",
    async (version) => {
      const h = await fixture();
      await expectProblem(await h.call("GET", `/owner/price-list/versions/${version}`), "not_found");
    },
  );

  it("본문 형식·요청 키·잘못된 입력은422이고 버전을 남기지 않음", async () => {
    const h = await fixture();
    for (const [contentType, key, raw, field, code] of [
      ["text/plain", newRequestKey(), "{}", "header:Content-Type", "not_allowed"],
      ["application/json", newRequestKey(), "{", "/", "bad_json"],
      ["application/json", "", JSON.stringify(input()), "header:Idempotency-Key", "required"],
      [
        "application/json",
        newRequestKey(),
        JSON.stringify({ ...input(), options: [{ ...input().options[0], priceKind: "from" }] }),
        "/options/0/inStandard",
        "not_allowed",
      ],
    ] as const) {
      const response = await h.app.request(
        `${ORIGIN}/api/owner/price-list/versions`,
        {
          method: "POST",
          headers: { origin: ORIGIN, [OWNER]: h.ownerId, "content-type": contentType, "Idempotency-Key": key },
          body: raw,
        },
        testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
      );
      const problem = await expectProblem(response, "validation_failed");
      expect(problem).toMatchObject({ errors: expect.arrayContaining([{ field, code }]) });
    }
    expect((await db.query("SELECT count(*)::int AS n FROM price_lists WHERE shop_id=$1", [h.shopId])).rows).toEqual([
      { n: 0 },
    ]);
  });

  it.each(["missing", "expired", "other_owner", "wrong_purpose", "too_large", "wrong_type"])(
    "도안 업로드 %s는 저장 전에 거절",
    async (kind) => {
      const h = await fixture();
      const uploadId = await photo(
        h,
        kind === "expired" ? new Date(NOW.getTime() - 3_600_000) : NOW,
        kind === "wrong_purpose" ? "license_photo" : "design_image",
      );
      const key = tempKey(createOwnerScope(h.ownerId), uploadId);
      if (kind === "missing") await h.store.delete(key);
      if (kind === "other_owner") {
        await h.store.put(tempKey(createOwnerScope(newUuid()), uploadId), new Uint8Array([1]), "image/png");
        await h.store.delete(key);
      }
      if (kind === "too_large") await h.store.put(key, new Uint8Array(10 * 1024 * 1024 + 1), "image/png");
      if (kind === "wrong_type") await h.store.put(key, new Uint8Array([1]), "text/plain");
      const problem = await expectProblem(
        await h.call("POST", "/owner/price-list/versions", {
          ...input(),
          designs: [{ name: "도안", uploadId, optionKey: null, inStandard: false, position: 0 }],
        }),
        "validation_failed",
      );
      expect(problem).toMatchObject({
        errors: [
          {
            field: "/designs/0/uploadId",
            code: kind === "wrong_purpose" ? "upload_wrong_purpose" : "upload_not_found",
          },
        ],
      });
      expect([...h.store.objects.keys()].filter((k) => k.startsWith("shops/"))).toEqual([]);
      expect((await db.query("SELECT count(*)::int AS n FROM price_lists WHERE shop_id=$1", [h.shopId])).rows).toEqual([
        { n: 0 },
      ]);
    },
  );

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

  it("규칙의 옵션 참조와 도안 범위를 같은 버전에 남기고 참조 이름·입력 순서만 바꾸면 버전 그대로", async () => {
    const h = await fixture(),
      uploadId = await photo(h);
    const body = {
      ...input(),
      options: [
        ...input().options,
        {
          key: "flower",
          group: "design",
          name: "꽃",
          priceKind: "fixed",
          amount: 5000,
          amountMax: null,
          inStandard: true,
          position: 0,
        },
      ],
      rules: [
        { kind: "exclude", optionA: "size", optionB: "flavor", amount: null },
        { kind: "surcharge", optionA: "flower", optionB: "flavor", amount: 1000 },
      ],
      designs: [{ name: "꽃 도안", uploadId, optionKey: "flower", inStandard: true, position: 0 }],
    };
    const response = await h.call("POST", "/owner/price-list/versions", body);
    expect(response.status, await response.clone().text()).toBe(201);
    const result = (await response.json()) as {
      priceList: PriceValue & {
        rules: { kind: string; optionAId: string; optionBId: string; amount: number | null }[];
      };
    };
    expectSchema("PriceListResult", result);
    const ids = new Map(result.priceList.options.map((o) => [o.name, o.optionId]));
    for (const rule of result.priceList.rules) {
      expect([rule.optionAId, rule.optionBId]).toEqual(
        (rule.kind === "exclude" ? [ids.get("1호"), ids.get("생크림")] : [ids.get("꽃"), ids.get("생크림")]).sort(),
      );
      expect(rule.amount).toBe(rule.kind === "exclude" ? null : 1000);
    }
    const renamed = new Map(body.options.map((o, i) => [o.key, `new_${i}`]));
    const designId = required(result.priceList.designs[0]).designId;
    const same = await h.call("POST", "/owner/price-list/versions", {
      ...body,
      baseRevision: result.priceList.revision,
      options: body.options.map((o) => ({ ...o, key: renamed.get(o.key) })).reverse(),
      rules: body.rules
        .map((r) => ({ ...r, optionA: renamed.get(r.optionB), optionB: renamed.get(r.optionA) }))
        .reverse(),
      designs: [
        {
          name: "꽃 도안",
          sourceDesignId: designId.toUpperCase(),
          optionKey: renamed.get("flower"),
          inStandard: true,
          position: 0,
        },
      ],
    });
    expect(same.status, await same.clone().text()).toBe(200);
    expect(await same.json()).toMatchObject({ outcome: "unchanged", priceList: { version: 1 } });
  });

  it.each([false, true])(
    "사진 복사 뒤 DB 실패의 정리는 다른 저장 성공 사진을 건드리지 않음(동시=%s)",
    async (concurrent) => {
      let fail = true;
      const h = await fixture({
        connect: (secret) => {
          const base = pgConnector(secret);
          return {
            query: (sql, params) => base.query(sql, params),
            transaction: (fn) =>
              base.transaction((tx) =>
                fn({
                  query: async (sql, params) => {
                    if (fail && /^INSERT INTO price_options/.test(sql)) {
                      fail = false;
                      throw new Error("synthetic child insert failure");
                    }
                    return tx.query(sql, params);
                  },
                }),
              ),
            abort: () => base.abort(),
            close: () => base.close(),
          } satisfies RequestDb;
        },
      });
      const uploadId = await photo(h),
        key = newRequestKey();
      const body = {
        ...input(),
        designs: [{ name: "같은 원본", uploadId, optionKey: null, inStandard: false, position: 0 }],
      };
      if (concurrent) {
        const responses = await Promise.all([
          h.call("POST", "/owner/price-list/versions", body),
          h.call("POST", "/owner/price-list/versions", body),
        ]);
        expect(responses.map((r) => r.status).sort()).toEqual([201, 500]);
      } else {
        await expectProblem(await h.call("POST", "/owner/price-list/versions", body, true, key), "internal");
        expect([...h.store.objects.keys()].filter((k) => k.startsWith("shops/"))).toEqual([]);
        expect(h.store.objects.has(tempKey(createOwnerScope(h.ownerId), uploadId))).toBe(true);
        expect((await h.call("POST", "/owner/price-list/versions", body, true, key)).status).toBe(201);
      }
      expect((await db.query("SELECT count(*)::int AS n FROM price_lists WHERE shop_id=$1", [h.shopId])).rows).toEqual([
        { n: 1 },
      ]);
      const keys = [...h.store.objects.keys()].filter((k) => k.startsWith("shops/"));
      expect(keys).toHaveLength(1);
      const current = (await (await h.call("GET", "/owner/price-list")).json()) as PriceValue;
      const url = required(current.designs[0]).imageUrl;
      const image = await h.app.request(url, {}, testEnv({ FILE_URL_KEY: TEST_HASH_KEY }));
      expect(image.status).toBe(200);
      expect([...new Uint8Array(await image.arrayBuffer())]).toEqual([1, 2, 3]);
    },
  );

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
