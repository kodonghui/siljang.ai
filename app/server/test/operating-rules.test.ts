import { afterAll, describe, expect, it } from "vitest";
import { type AppOptions, createApp } from "../src/app";
import { pgConnector, type RequestDb } from "../src/db";
import { MINOR_NOTICE, operatingRulesCardTexts, WITHDRAWAL_NOTICE } from "../src/operating-rules-card";
import { type ClauseInput, parseOperatingRules } from "../src/operating-rules-input";
import { createOwnerSession } from "../src/owner-session";
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

  it("낮춘 환불은 먼저409를 보이고 확인 선택을 새 버전에 남기며 같은 키 재전송은 한 버전", async () => {
    const h = await fixture(),
      key = newRequestKey();
    const body = {
      ...input(),
      preProductionRefundPct: 50,
      clauses: input().clauses.map((c) => ({ ...c, effectText: "취소 수수료를 뺀 금액의50%를 돌려드립니다." })),
    };
    const warning = await expectProblem(
      await h.call("POST", "/owner/operating-rules/versions", body, true, key),
      "confirmation_required",
    );
    expect(warning).toMatchObject({ confirm: [{ kind: "lowered_refund" }] });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM operating_rules WHERE shop_id=$1", [h.shopId])).rows,
    ).toEqual([{ n: 0 }]);
    const confirmed = { ...body, confirm: ["lowered_refund"] };
    const response = await h.call("POST", "/owner/operating-rules/versions", confirmed, true, key);
    expect(response.status, await response.clone().text()).toBe(201);
    const value = (await response.json()) as { operatingRules: { revision: string } };
    expect(value).toMatchObject({
      operatingRules: { preProductionRefundPct: 50, preProductionLoweredAck: true, version: 1 },
    });
    const replay = await h.call("POST", "/owner/operating-rules/versions", confirmed, true, key);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toMatchObject({ outcome: "created", operatingRules: { version: 1 } });
    const same = await h.call("POST", "/owner/operating-rules/versions", {
      ...body,
      baseRevision: value.operatingRules.revision,
    });
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({
      outcome: "unchanged",
      operatingRules: { preProductionLoweredAck: true },
    });
  });

  it("버전2의 결제 기한을 바꾼 버전3은 조문 원문/조건/효과를 보존하고 이전 버전을 바꾸지 않음", async () => {
    const h = await fixture();
    const first = (await (await h.call("POST", "/owner/operating-rules/versions", input())).json()) as {
      operatingRules: { revision: string };
    };
    const body = {
      ...input(first.operatingRules.revision),
      paymentDueHours: 18,
      clauses: [
        ...input().clauses,
        {
          key: "shop_cancel_compensation",
          position: 2,
          title: "가게 사정 취소",
          conditionText: "가게 사정으로 취소하는 경우",
          effectText: "바탕 금액을 모두 돌려드립니다.",
        },
      ],
    };
    const second = await h.call("POST", "/owner/operating-rules/versions", body);
    expect(second.status).toBe(201);
    const old = ((await second.json()) as { operatingRules: Record<string, unknown> }).operatingRules;
    const third = await h.call("POST", "/owner/operating-rules/versions", {
      ...body,
      baseRevision: old.revision,
      paymentDueHours: 24,
    });
    expect(third.status).toBe(201);
    expect(await third.json()).toMatchObject({
      operatingRules: { version: 3, paymentDueHours: 24, clauses: body.clauses },
    });
    const read = await (await h.call("GET", "/owner/operating-rules/versions/2")).json();
    expect(read).toMatchObject({ version: 2, current: false, paymentDueHours: 18, clauses: body.clauses });
    expectSchema("OperatingRules", read);
    const versions = await (await h.call("GET", "/owner/operating-rules/versions")).json();
    expect(versions).toMatchObject({ items: [{ version: 3, supersededAt: null }, { version: 2 }, { version: 1 }] });
    const replay = await expectProblem(
      await h.call("POST", "/owner/operating-rules/versions", body),
      "version_conflict",
    );
    expect(replay.code).toBe("version_conflict");
  });

  it.each([
    [[{ hoursBeforeMin: 72, hoursBeforeMax: null, refundPct: 50 }], "/refundTiers/0", "gap"],
    [
      [
        { hoursBeforeMin: 0, hoursBeforeMax: 72, refundPct: 0 },
        { hoursBeforeMin: 48, hoursBeforeMax: null, refundPct: 50 },
      ],
      "/refundTiers/1",
      "overlaps",
    ],
    [
      [
        { hoursBeforeMin: 0, hoursBeforeMax: 48, refundPct: 0 },
        { hoursBeforeMin: 72, hoursBeforeMax: null, refundPct: 50 },
      ],
      "/refundTiers/1",
      "gap",
    ],
    [[{ hoursBeforeMin: 0, hoursBeforeMax: 72, refundPct: 0 }], "/refundTiers/0", "gap"],
    [[], "/refundTiers", "required"],
  ])("잘못된 환불 단계 %j는 저장하지 않고 해당 행을 보임", async (refundTiers, field, code) => {
    const h = await fixture();
    const body = {
      ...input(),
      clauses: [
        ...input().clauses,
        {
          key: "staged_refund",
          position: 2,
          title: "단계별 환불",
          conditionText: "제작을 시작한 뒤 취소하는 경우",
          effectText: "남은 시간의 단계별 비율을 적용합니다.",
        },
      ],
      refundTiers,
    };
    const problem = await expectProblem(
      await h.call("POST", "/owner/operating-rules/versions", body),
      "validation_failed",
    );
    expect(problem).toMatchObject({ errors: expect.arrayContaining([{ field, code }]) });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM operating_rules WHERE shop_id=$1", [h.shopId])).rows,
    ).toEqual([{ n: 0 }]);
  });

  it("단계와 조문은 함께 남고 입력 순서만 바뀌면 버전 그대로", async () => {
    const h = await fixture();
    const body = {
      ...input(),
      clauses: [
        {
          key: "staged_refund",
          position: 2,
          title: "단계별 환불",
          conditionText: "제작을 시작한 뒤 취소하는 경우",
          effectText: "남은 시간의 단계별 비율을 적용합니다.",
        },
        ...input().clauses,
      ],
      refundTiers: [
        { hoursBeforeMin: 72, hoursBeforeMax: null, refundPct: 50 },
        { hoursBeforeMin: 0, hoursBeforeMax: 72, refundPct: 0 },
      ],
    };
    const response = await h.call("POST", "/owner/operating-rules/versions", body);
    expect(response.status, await response.clone().text()).toBe(201);
    const result = (await response.json()) as {
      operatingRules: { revision: string; clauses: unknown[]; refundTiers: unknown[] };
    };
    expect(result.operatingRules.clauses).toEqual([...body.clauses].reverse());
    expect(result.operatingRules.refundTiers).toEqual([...body.refundTiers].reverse());
    const same = await h.call("POST", "/owner/operating-rules/versions", {
      ...body,
      baseRevision: result.operatingRules.revision,
      clauses: [...body.clauses].reverse(),
      refundTiers: [...body.refundTiers].reverse(),
    });
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({ outcome: "unchanged", operatingRules: { version: 1 } });
  });

  it("두 글에 조문을 온전히 담고 끝에 청약철회/미성년 고지를 붙이며 한 조문이 넘치면 저장하지 않음(A21)", async () => {
    const h = await fixture();
    const clauses: ClauseInput[] = [
      {
        key: "pre_production_cancel",
        position: 1,
        title: "첫 조문",
        conditionText: "합성 조건",
        effectText: "가".repeat(700),
      },
      { key: "custom", position: 2, title: "둘째 조문", conditionText: "합성 조건", effectText: "나".repeat(700) },
    ];
    const texts = operatingRulesCardTexts(clauses, 1);
    expect(texts).toHaveLength(2);
    expect(texts.every((t) => [...t].length <= 1000)).toBe(true);
    expect(texts[0]).toContain(clauses[0]?.effectText);
    expect(texts[1]).toContain(clauses[1]?.effectText);
    expect(texts[1]).toContain(WITHDRAWAL_NOTICE);
    expect(texts[1]).toContain(MINOR_NOTICE);
    expect((await h.call("POST", "/owner/operating-rules/versions", { ...input(), clauses })).status).toBe(201);
    const current = (await (await h.call("GET", "/owner/operating-rules")).json()) as { revision: string };
    const tooLong = {
      ...input(current.revision),
      clauses: [{ ...input().clauses[0], conditionText: "조".repeat(600), effectText: "문".repeat(500) }],
    };
    const error = await expectProblem(
      await h.call("POST", "/owner/operating-rules/versions", tooLong),
      "validation_failed",
    );
    expect(error).toMatchObject({
      errors: expect.arrayContaining([
        { field: "/clauses", code: "exceeds_card_limit" },
        { field: "/clauses/0", code: "exceeds_card_limit" },
      ]),
    });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM operating_rules WHERE shop_id=$1", [h.shopId])).rows,
    ).toEqual([{ n: 1 }]);
  });

  it("가게 없는 실제 세션은4개 API 모두404 shop_not_registered", async () => {
    const session = await createOwnerSession(
      db,
      { accountId: BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 13)}`).toString(), friend: false },
      NOW,
      false,
    );
    const app = createApp({ services: { now: () => NOW }, logSink: () => {} });
    for (const [method, path] of [
      ["GET", "/owner/operating-rules"],
      ["POST", "/owner/operating-rules/versions"],
      ["GET", "/owner/operating-rules/versions"],
      ["GET", "/owner/operating-rules/versions/1"],
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

  it("DB 장애는4개 API 모두500이고 내부 오류는 응답에 넣지 않음", async () => {
    const h = await fixture({
      connect: () => {
        throw new Error("synthetic private rules database failure");
      },
    });
    for (const [method, path] of [
      ["GET", "/owner/operating-rules"],
      ["POST", "/owner/operating-rules/versions"],
      ["GET", "/owner/operating-rules/versions"],
      ["GET", "/owner/operating-rules/versions/1"],
    ] as const) {
      const error = await expectProblem(
        await h.call(method, path, method === "POST" ? input() : undefined),
        "internal",
      );
      expect(JSON.stringify(error)).not.toContain("private rules database");
    }
  });

  it.each(["0", "-1", "1.5", "not-a-version", "2147483648", "9".repeat(100)])("잘못된 버전%s는404", async (version) => {
    const h = await fixture();
    await expectProblem(await h.call("GET", `/owner/operating-rules/versions/${version}`), "not_found");
  });

  it("본문 형식·깨진 JSON·요청 키·필드 오류는422이며 버전을 남기지 않음", async () => {
    const h = await fixture();
    for (const [contentType, key, body, field, code] of [
      ["text/plain", newRequestKey(), "{}", "header:Content-Type", "not_allowed"],
      ["application/json", newRequestKey(), "{", "/", "bad_json"],
      ["application/json", "", JSON.stringify(input()), "header:Idempotency-Key", "required"],
      [
        "application/json",
        newRequestKey(),
        JSON.stringify({ ...input(), paymentDueHours: 721 }),
        "/paymentDueHours",
        "out_of_range",
      ],
    ] as const) {
      const response = await h.app.request(
        `${ORIGIN}/api/owner/operating-rules/versions`,
        {
          method: "POST",
          headers: { origin: ORIGIN, [OWNER]: h.ownerId, "content-type": contentType, "Idempotency-Key": key },
          body,
        },
        testEnv(),
      );
      expect(await expectProblem(response, "validation_failed")).toMatchObject({
        errors: expect.arrayContaining([{ field, code }]),
      });
    }
    expect(
      (await db.query("SELECT count(*)::int AS n FROM operating_rules WHERE shop_id=$1", [h.shopId])).rows,
    ).toEqual([{ n: 0 }]);
  });

  it("동시 저장은 한 버전만 남기고 같은 키 재전송/다른 본문 재사용을 구분함", async () => {
    const h = await fixture(),
      keys = [newRequestKey(), newRequestKey()] as const;
    const results = await Promise.all(
      keys.map((key) => h.call("POST", "/owner/operating-rules/versions", input(), true, key)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const key = results[0]?.status === 201 ? keys[0] : keys[1];
    const replay = await h.call("POST", "/owner/operating-rules/versions", input(), true, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    await expectProblem(
      await h.call("POST", "/owner/operating-rules/versions", { ...input(), paymentDueHours: 24 }, true, key),
      "idempotency_key_reused",
    );
    expect(
      (await db.query("SELECT count(*)::int AS n FROM operating_rules WHERE shop_id=$1", [h.shopId])).rows,
    ).toEqual([{ n: 1 }]);
  });

  it("조문 쓰기 실패는 새 버전/교체 시각을 되돌리고 같은 키로 다시 저장할 수 있음", async () => {
    let fail = false;
    const h = await fixture({
      connect: (secret) => {
        const base = pgConnector(secret);
        return {
          query: (sql, params) => base.query(sql, params),
          transaction: (fn) =>
            base.transaction((tx) =>
              fn({
                query: (sql, params) => {
                  if (fail && /^INSERT INTO rule_clauses/.test(sql)) {
                    fail = false;
                    throw new Error("synthetic clause write failure");
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
    const first = (
      (await (await h.call("POST", "/owner/operating-rules/versions", input())).json()) as {
        operatingRules: { revision: string };
      }
    ).operatingRules;
    const body = { ...input(first.revision), paymentDueHours: 24 },
      key = newRequestKey();
    fail = true;
    await expectProblem(await h.call("POST", "/owner/operating-rules/versions", body, true, key), "internal");
    expect(await (await h.call("GET", "/owner/operating-rules")).json()).toMatchObject({
      revision: first.revision,
      version: 1,
      current: true,
      paymentDueHours: 12,
    });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM operating_rules WHERE shop_id=$1", [h.shopId])).rows,
    ).toEqual([{ n: 1 }]);
    expect((await h.call("POST", "/owner/operating-rules/versions", body, true, key)).status).toBe(201);
  });

  it("카드 한도를 넘은 마지막50번째 조문을 필드 오류가 가리킴", async () => {
    const h = await fixture();
    const clauses = Array.from({ length: 50 }, (_, i) => ({
      key: "custom",
      position: i + 1,
      title: `합성 조문${i}`,
      conditionText: i === 49 ? "조건".repeat(300) : "조건",
      effectText: i === 49 ? "효과".repeat(250) : "효과",
    }));
    const error = await expectProblem(
      await h.call("POST", "/owner/operating-rules/versions", { ...input(), clauses }),
      "validation_failed",
    );
    expect(error).toMatchObject({
      errors: expect.arrayContaining([{ field: "/clauses/49", code: "exceeds_card_limit" }]),
    });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM operating_rules WHERE shop_id=$1", [h.shopId])).rows,
    ).toEqual([{ n: 0 }]);
  });
});

describe("API-021 입력 경계", () => {
  const clause = (patch: Record<string, unknown>) => ({ ...input(), clauses: [{ ...input().clauses[0], ...patch }] });
  const tiers = (refundTiers: unknown[]) => ({
    ...input(),
    clauses: [
      ...input().clauses,
      { key: "staged_refund", position: 2, title: "단계", conditionText: "제작한 뒤", effectText: "단계 적용" },
    ],
    refundTiers,
  });
  it.each([
    ["기한0", () => ({ ...input(), quoteValidHours: 0 }), "/quoteValidHours", "out_of_range"],
    ["기한721", () => ({ ...input(), issueReportHours: 721 }), "/issueReportHours", "out_of_range"],
    ["기한 소수", () => ({ ...input(), paymentDueHours: 1.5 }), "/paymentDueHours", "bad_format"],
    ["수수료 음수", () => ({ ...input(), cancellationFeeKrw: -1 }), "/cancellationFeeKrw", "out_of_range"],
    ["수수료 상한", () => ({ ...input(), cancellationFeeKrw: 10000001 }), "/cancellationFeeKrw", "out_of_range"],
    ["환불 상한", () => ({ ...input(), preProductionRefundPct: 101 }), "/preProductionRefundPct", "out_of_range"],
    ["환불 기준", () => ({ ...input(), dateChangeRefundBasis: "today" }), "/dateChangeRefundBasis", "not_allowed"],
    ["기준 버전 형식", () => ({ ...input(), baseRevision: "abc:1" }), "/baseRevision", "bad_format"],
    ["알 수 없는 가게", () => ({ ...input(), shopId: "synthetic" }), "/shopId", "unknown_field"],
    ["조문 없음", () => ({ ...input(), clauses: [] }), "/clauses", "required"],
    ["조문 키", () => clause({ key: "other" }), "/clauses/0/key", "not_allowed"],
    ["조문 순서", () => clause({ position: 0 }), "/clauses/0/position", "out_of_range"],
    ["제목 길이", () => clause({ title: "가".repeat(61) }), "/clauses/0/title", "too_long"],
    ["조건 길이", () => clause({ conditionText: "가".repeat(1001) }), "/clauses/0/conditionText", "too_long"],
    ["효과의 널 문자", () => clause({ effectText: "효과\0" }), "/clauses/0/effectText", "bad_format"],
    [
      "중복 조문",
      () => ({ ...input(), clauses: [...input().clauses, { ...input().clauses[0], position: 2 }] }),
      "/clauses/1/key",
      "duplicate",
    ],
    [
      "조문51개",
      () => ({
        ...input(),
        clauses: Array.from({ length: 51 }, (_, i) => ({ ...input().clauses[0], key: "custom", position: i + 1 })),
      }),
      "/clauses",
      "too_many",
    ],
    [
      "단계21개",
      () => tiers(Array.from({ length: 21 }, (_, i) => ({ hoursBeforeMin: i, hoursBeforeMax: i + 1, refundPct: 50 }))),
      "/refundTiers",
      "too_many",
    ],
    [
      "단계 시각 상한",
      () => tiers([{ hoursBeforeMin: 8761, hoursBeforeMax: null, refundPct: 50 }]),
      "/refundTiers/0/hoursBeforeMin",
      "out_of_range",
    ],
    [
      "단계 비율",
      () => tiers([{ hoursBeforeMin: 0, hoursBeforeMax: null, refundPct: -1 }]),
      "/refundTiers/0/refundPct",
      "out_of_range",
    ],
    ["낯선 확인 종류", () => ({ ...input(), confirm: ["other"] }), "/confirm/0", "not_allowed"],
  ] as const)("%s는 필드 오류", (_name, make, field, code) => {
    expect(() => parseOperatingRules(make())).toThrowError(
      expect.objectContaining({
        code: "validation_failed",
        extras: { errors: expect.arrayContaining([{ field, code }]) },
      }),
    );
  });

  it("기한/금액/비율의 양 끝과 조문50개·환불 단계20개는 허용", () => {
    const body = {
      ...input(),
      quoteValidHours: 1,
      paymentDueHours: 720,
      issueReportHours: 1,
      changeDeadlineHours: 720,
      cancellationFeeKrw: 10000000,
      preProductionRefundPct: 0,
      clauses: Array.from({ length: 50 }, (_, i) => ({
        key: i === 0 ? "staged_refund" : "custom",
        position: i + 1,
        title: `조문${i}`,
        conditionText: "조건",
        effectText: "효과",
      })),
      refundTiers: Array.from({ length: 20 }, (_, i) => ({
        hoursBeforeMin: i,
        hoursBeforeMax: i === 19 ? null : i + 1,
        refundPct: i === 19 ? 100 : 0,
      })),
    };
    expectSchema("OperatingRulesInput", body);
    expect(parseOperatingRules(body)).toMatchObject({
      quoteValidHours: 1,
      paymentDueHours: 720,
      preProductionRefundPct: 0,
    });
  });
});
