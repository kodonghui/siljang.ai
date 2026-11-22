import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { KakaoCallbackJob } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { OWNER_COOKIE } from "../src/owner-oauth";
import { createOwnerSession } from "../src/owner-session";
import { Secret } from "../src/settings";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { createShop, issueTestBookingLink, linkTestChannel } from "./support/shops";

const db = testDb(),
  NOW = new Date("2026-11-22T03:00:00Z"),
  ORIGIN = "https://siljang.example",
  PATH = "/api/owner/shop",
  env = testEnv({ FILE_URL_KEY: TEST_HASH_KEY });
interface Shop {
  revision: string;
  shopId: string;
  name: string;
  contactEmail: string;
  ownerWaitMinutes: number;
  awaitingPaymentLimit: number;
  [key: string]: unknown;
}
interface Result {
  outcome: string;
  shop: Shop;
}
async function fixture() {
  const shop = await createShop(db, "가게 설정 합성 가게");
  const owner = (
    await db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [shop.ownerId])
  ).rows[0];
  if (!owner) throw new Error("합성 사장님 없음");
  const session = await createOwnerSession(db, { accountId: owner.kakao_account_id, friend: false }, NOW, false),
    cookie = `${OWNER_COOKIE}=${session.token}`;
  const clock = { now: NOW },
    jobs: KakaoCallbackJob[] = [];
  const app = createApp({
    services: {
      now: () => clock.now,
      fieldCrypto: singleKeyCrypto().fc,
      kakaoCallbackQueue: {
        async send(job) {
          jobs.push(job);
        },
      },
    },
    logSink: () => {},
  });
  const get = async () => {
    const response = await app.request(`${ORIGIN}${PATH}`, { headers: { cookie } }, env);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Shop;
    expectSchema("Shop", body);
    return body;
  };
  const patch = (body: unknown, key = newRequestKey(), path = PATH, bindings = env) =>
    app.request(
      `${ORIGIN}${path}`,
      {
        method: "PATCH",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
      bindings,
    );
  const change = async (changes: Record<string, unknown>) =>
    patch({ baseRevision: (await get()).revision, ...changes });
  const save = async (changes: Record<string, unknown>) => {
    const response = await change(changes);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = (await response.json()) as Result;
    expectSchema("ShopResult", result);
    return result;
  };
  const skillKey = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  const question = (utterance: string, userId = shop.userKey, callback = false) =>
    app.request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "content-type": "application/json", "Siljang-Skill-Key": skillKey },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: {
            utterance,
            block: { id: "synthetic-settings" },
            user: { id: userId, type: "botUserKey" },
            ...(callback ? { callbackUrl: "https://bot-api.kakao.com/v1/callback/synthetic_settings" } : {}),
          },
          action: { id: "synthetic-settings", params: {} },
        }),
      },
      env,
    );
  return { shop, cookie, app, get, patch, change, save, question, clock, jobs };
}

describeDb("TASK-037 가게 설정 부분 저장", () => {
  afterAll(async () => db.close());
  it("한 필드만 저장하고 나머지 신고/신원/계좌/주문은 보존함", async () => {
    const h = await fixture(),
      before = await h.get();
    const result = await h.save({ name: "바뀐 합성 가게" });
    expect(result.outcome).toBe("done");
    expect(result.shop.name).toBe("바뀐 합성 가게");
    for (const key of [
      "contactPhone",
      "businessName",
      "representativeName",
      "businessRegNo",
      "foodLicenseNo",
      "licenseStatus",
      "mailOrderExemption",
      "ownerWaitMinutes",
      "awaitingPaymentLimit",
    ])
      expect(result.shop[key]).toEqual(before[key]);
    expect(result.shop.revision).not.toBe(before.revision);
    expect((await db.query("SELECT status FROM orders WHERE shop_id=$1", [h.shop.shopId])).rows).toEqual([
      { status: "awaiting_payment" },
    ]);
  });
  it("연락처/주소와 전체 설정 경계 값을 저장하고 Unicode40자를 허용함", async () => {
    const h = await fixture(),
      changes = {
        name: "🍰".repeat(40),
        contactPhone: "02-000-0000",
        businessAddress: "서울 합성로 22",
        contactEmail: "changed@example.com",
        pickupAddress: "합성 픽업 장소",
        completionPhotoEnabled: true,
        idleCloseHours: 720,
        ownerWaitMinutes: 1440,
        dailyAiCostLimitKrw: 1000000,
        awaitingPaymentLimit: 10,
      };
    expect((await h.save(changes)).shop).toMatchObject(changes);
    expect(
      (
        await h.save({
          pickupAddress: null,
          completionPhotoEnabled: false,
          idleCloseHours: 1,
          ownerWaitMinutes: 10,
          dailyAiCostLimitKrw: 0,
          awaitingPaymentLimit: 0,
        })
      ).outcome,
    ).toBe("done");
  });
  it("통신판매업은 바꾼 뒤 현재 값으로 번호/기관/면제를 함께 검사함", async () => {
    const h = await fixture(),
      before = await h.get();
    const invalid = await expectProblem(await h.change({ mailOrderRegNo: "제2026-합성-001호" }), "validation_failed");
    expect(invalid.errors).toContainEqual({ field: "/mailOrderAuthority", code: "required" });
    expect((await h.get()).revision).toBe(before.revision);
    await h.save({ mailOrderRegNo: "제2026-합성-001호", mailOrderAuthority: "합성구청", mailOrderExemption: null });
    expect(
      (await expectProblem(await h.change({ mailOrderAuthority: null }), "validation_failed")).errors,
    ).toContainEqual({ field: "/mailOrderAuthority", code: "required" });
    expect(
      (await expectProblem(await h.change({ mailOrderRegNo: null, mailOrderAuthority: null }), "validation_failed"))
        .errors,
    ).toContainEqual({ field: "/mailOrderRegNo", code: "required" });
    expect(
      (await h.save({ mailOrderRegNo: null, mailOrderAuthority: null, mailOrderExemption: "합성 면제 사유" })).shop
        .mailOrderExemption,
    ).toBe("합성 면제 사유");
  });
  it("같은 값은unchanged이며 가게 버전을 바꾸지 않음", async () => {
    const h = await fixture(),
      before = await h.get(),
      result = await h.save({ name: before.name });
    expect(result.outcome).toBe("unchanged");
    expect(result.shop.revision).toBe(before.revision);
  });
  it("기다림120분의 기존 지연 시각은 보존하고 새 질문부터30분으로 정함", async () => {
    const h = await fixture();
    await issueTestBookingLink(db, h.shop);
    await linkTestChannel(db, h.shop.channelId);
    expect((await h.question("기존120분 질문")).headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    const rows = async () =>
      (
        await db.query<{ wait_due_at: Date }>(
          "SELECT wait_due_at FROM owner_tasks WHERE shop_id=$1 AND kind='handoff' ORDER BY wait_due_at",
          [h.shop.shopId],
        )
      ).rows.map((row) => row.wait_due_at.toISOString());
    const before = await rows();
    expect(before).toEqual([new Date(NOW.getTime() + 120 * 60_000).toISOString()]);
    await h.save({ ownerWaitMinutes: 30 });
    expect(await rows()).toEqual(before);
    expect((await h.question("새30분 질문", `synthetic-settings-${newUuid()}`)).headers.get("Siljang-Outcome")).toBe(
      "ai_key_missing",
    );
    expect(await rows()).toEqual([new Date(NOW.getTime() + 30 * 60_000).toISOString(), ...before]);
    expect(h.jobs).toHaveLength(0);
  });
  it("그날4,000원을 쓴 뒤3,000원/0원으로 낮추면 모델/큐 없이 넘기고 올리면 다시 큐에 넣음", async () => {
    const h = await fixture();
    await issueTestBookingLink(db, h.shop);
    await linkTestChannel(db, h.shop.channelId);
    const customer = newUuid(),
      consultation = newUuid();
    await db.query("INSERT INTO customers (id,shop_id,kakao_channel_id,kakao_user_key) VALUES ($1,$2,$3,$4)", [
      customer,
      h.shop.shopId,
      h.shop.channelId,
      newUuid(),
    ]);
    await db.query("INSERT INTO consultations (id,shop_id,customer_id,status) VALUES ($1,$2,$3,'open')", [
      consultation,
      h.shop.shopId,
      customer,
    ]);
    await db.query(
      "INSERT INTO ai_calls (shop_id,consultation_id,trace_id,provider,model,prompt_version,sent_at,cost_krw,result) VALUES ($1,$2,$3,'synthetic','synthetic','synthetic',$4,4000,'failure')",
      [h.shop.shopId, consultation, newUuid(), NOW],
    );
    await h.save({ dailyAiCostLimitKrw: 3000 });
    expect((await h.question("낮춘 한도 질문", h.shop.userKey, true)).headers.get("Siljang-Outcome")).toBe(
      "ai_cost_limit_reached",
    );
    expect(h.jobs).toHaveLength(0);
    expect((await db.query("SELECT reason FROM handoffs WHERE shop_id=$1", [h.shop.shopId])).rows).toEqual([
      { reason: "ai_cost_limit" },
    ]);
    await h.save({ dailyAiCostLimitKrw: 6000 });
    expect((await h.question("다시 올린 한도 질문", h.shop.userKey, true)).headers.get("Siljang-Outcome")).toBe(
      "callback_pending",
    );
    expect(h.jobs).toHaveLength(1);
    await h.save({ dailyAiCostLimitKrw: 0 });
    expect((await h.question("0원 한도 질문", h.shop.userKey, true)).headers.get("Siljang-Outcome")).toBe(
      "ai_cost_limit_reached",
    );
    expect(h.jobs).toHaveLength(1);
    expect((await db.query("SELECT count(*)::int AS n FROM ai_calls WHERE shop_id=$1", [h.shop.shopId])).rows).toEqual([
      { n: 1 },
    ]);
  });
  it("같은 키 재전송은 저장을 반복하지 않고 더 최근의 현재 값을 돌려줌", async () => {
    const h = await fixture(),
      key = newRequestKey(),
      input = { baseRevision: (await h.get()).revision, name: "첫 저장" };
    expect((await h.patch(input, key)).status).toBe(200);
    await h.save({ name: "나중 저장" });
    const replay = await h.patch(input, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(((await replay.json()) as Result).shop.name).toBe("나중 저장");
    await expectProblem(await h.patch({ ...input, name: "다른 본문" }, key), "idempotency_key_reused");
  });
  it("저장 뒤 서명 주소 생성 실패500은 설정도 되돌리고 같은 키로 재시도할 수 있음", async () => {
    const h = await fixture(),
      before = await h.get(),
      key = newRequestKey(),
      input = { baseRevision: before.revision, name: "되돌릴 합성 설정" };
    const failed = await h.patch(input, key, PATH, testEnv());
    await expectProblem(failed, "internal");
    expect((await h.get()).revision).toBe(before.revision);
    expect((await h.get()).name).toBe(before.name);
    expect((await h.patch(input, key)).status).toBe(200);
  });
  it.each([
    null,
    [],
    false,
    "string",
    { baseRevision: "1" },
    { name: "버전 누락" },
    { baseRevision: null, name: "버전 형식" },
  ])("본문/필수/부분 변경 경계 %j는422", async (body) => {
    const h = await fixture(),
      before = await h.get();
    await expectProblem(await h.patch(body), "validation_failed");
    expect((await h.get()).revision).toBe(before.revision);
  });
  it.each(["", "bad-key"])("요청 키 %s는422", async (key) => {
    const h = await fixture(),
      before = await h.get();
    await expectProblem(
      await h.patch({ baseRevision: before.revision, name: "요청 키 오류" }, key),
      "validation_failed",
    );
    expect((await h.get()).revision).toBe(before.revision);
  });
  it("잘못된 JSON/Content-Type은422이며 여러 필드 오류는 함께 보존함", async () => {
    const h = await fixture(),
      before = await h.get();
    const headers = {
      cookie: h.cookie,
      origin: ORIGIN,
      "Idempotency-Key": newRequestKey(),
      "content-type": "application/json",
    };
    const badJson = await h.app.request(`${ORIGIN}${PATH}`, { method: "PATCH", headers, body: "{" }, env);
    expect((await expectProblem(badJson, "validation_failed")).errors).toContainEqual({ field: "/", code: "bad_json" });
    const badType = await h.app.request(
      `${ORIGIN}${PATH}`,
      { method: "PATCH", headers: { ...headers, "content-type": "text/plain" }, body: "{}" },
      env,
    );
    expect((await expectProblem(badType, "validation_failed")).errors).toContainEqual({
      field: "header:Content-Type",
      code: "not_allowed",
    });
    const invalid = await expectProblem(
      await h.change({ ownerWaitMinutes: 5, awaitingPaymentLimit: 11 }),
      "validation_failed",
    );
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        { field: "/ownerWaitMinutes", code: "out_of_range" },
        { field: "/awaitingPaymentLimit", code: "out_of_range" },
      ]),
    );
    expect((await h.get()).revision).toBe(before.revision);
  });
  it("같은 버전의 동시 저장은200/409이며 늦은 저장은 덮어쓰지 않음", async () => {
    const h = await fixture(),
      baseRevision = (await h.get()).revision;
    const responses = await Promise.all([
      h.patch({ baseRevision, name: "기기 하나" }),
      h.patch({ baseRevision, name: "기기 둘" }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    await expectProblem(responses.find((r) => r.status === 409) as Response, "version_conflict");
    expect(["기기 하나", "기기 둘"]).toContain((await h.get()).name);
  });
  it.each([
    ["name", "", "too_short"],
    ["name", "🍰".repeat(41), "too_long"],
    ["contactPhone", "abcdefgh", "bad_format"],
    ["businessAddress", " ", "too_short"],
    ["contactEmail", "no-address", "bad_format"],
    ["pickupAddress", "", "too_short"],
    ["ownerWaitMinutes", 5, "out_of_range"],
    ["ownerWaitMinutes", 1441, "out_of_range"],
    ["idleCloseHours", 0, "out_of_range"],
    ["idleCloseHours", 721, "out_of_range"],
    ["dailyAiCostLimitKrw", -1, "out_of_range"],
    ["dailyAiCostLimitKrw", 1000001, "out_of_range"],
    ["dailyAiCostLimitKrw", 1.5, "bad_format"],
    ["awaitingPaymentLimit", 11, "out_of_range"],
    ["awaitingPaymentLimit", -1, "out_of_range"],
    ["awaitingPaymentLimit", "1", "bad_format"],
    ["completionPhotoEnabled", 1, "bad_format"],
    ["businessName", "여기서 신원 변경 금지", "unknown_field"],
    ["foodLicenseNo", "신고 다시 올리기는API011", "unknown_field"],
    ["shopId", "다른 가게 ID", "unknown_field"],
  ])("%s의 잘못된 값은 필드 오류 %s/%s이고 저장하지 않음", async (field, value, code) => {
    const h = await fixture(),
      before = await h.get(),
      problem = await expectProblem(await h.change({ [field as string]: value }), "validation_failed");
    expect(problem.errors).toContainEqual({ field: `/${field}`, code });
    expect((await h.get()).revision).toBe(before.revision);
  });
  it("없는 사장님 가게는404", async () => {
    const session = await createOwnerSession(
      db,
      { accountId: BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 14)}`).toString(), friend: false },
      NOW,
      false,
    );
    const response = await createApp({ services: { now: () => NOW }, logSink: () => {} }).request(
      `${ORIGIN}${PATH}`,
      {
        method: "PATCH",
        headers: {
          origin: ORIGIN,
          cookie: `${OWNER_COOKIE}=${session.token}`,
          "content-type": "application/json",
          "Idempotency-Key": newRequestKey(),
        },
        body: JSON.stringify({ baseRevision: "1", name: "합성" }),
      },
      env,
    );
    await expectProblem(response, "shop_not_registered");
  });
});

it("인증 없는 가게 설정 변경은401이고 DB를 열지 않음", async () => {
  let calls = 0;
  const fail = async (): Promise<never> => {
    calls++;
    throw new Error("DB를 부르면 안 됨");
  };
  const app = createApp({
    connect: () => ({ query: fail, transaction: fail, abort: async () => {}, close: async () => {} }),
    logSink: () => {},
  });
  const response = await app.request(
    "https://siljang.example/api/owner/shop",
    {
      method: "PATCH",
      headers: {
        origin: "https://siljang.example",
        "content-type": "application/json",
        "Idempotency-Key": newRequestKey(),
      },
      body: JSON.stringify({ baseRevision: "1", name: "합성 설정" }),
    },
    testEnv(),
  );
  await expectProblem(response, "unauthenticated");
  expect(calls).toBe(0);
});
