import { afterAll, describe, expect, it } from "vitest";
import { type AppOptions, createApp } from "../src/app";
import { parseChannelInput, parseSkillKeyInput } from "../src/kakao-channel-input";
import { deriveKakaoProofPhrase } from "../src/kakao-skill-auth";
import { createOwnerSession } from "../src/owner-session";
import { ApiError } from "../src/problem";
import { Secret } from "../src/settings";
import { createShopScope } from "../src/shop-scope";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";

const ORIGIN = "https://siljang.example";
const PATH = "/owner/kakao-channel";
const NOW = new Date("2026-11-22T05:00:00Z");
const OWNER = "x-test-owner";
const db = testDb();

interface ChannelResult {
  outcome: string;
  kakaoChannel: {
    connectionId: string;
    botId: string;
    status: string;
    revision: string;
    proofPhrase: string | null;
    failureHints: string[];
    verifiedBlocks: string[];
    eventStatus: string;
    skill: { keyVersion: number; previousKeyValidUntil: string | null };
  };
  skillKey: { headerValue: string; keyVersion: number } | null;
}

async function save(h: Awaited<ReturnType<typeof fixture>>, body: ReturnType<typeof input>, key = newRequestKey()) {
  const response = await h.call("PUT", PATH, body, key);
  expect(response.status, await response.clone().text()).toBe(200);
  const value = (await response.json()) as ChannelResult;
  expectSchema("KakaoChannelResult", value);
  return value;
}
async function read(h: Awaited<ReturnType<typeof fixture>>) {
  const response = await h.call("GET");
  expect(response.status, await response.clone().text()).toBe(200);
  const value = (await response.json()) as ChannelResult["kakaoChannel"];
  expectSchema("KakaoChannel", value);
  return value;
}
async function skill(h: Awaited<ReturnType<typeof fixture>>, botId: string, key: string) {
  return h.app.request(
    `${ORIGIN}/api/kakao/skills/message`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "Siljang-Skill-Key": key },
      body: JSON.stringify({
        bot: { id: botId },
        userRequest: {
          utterance: "안녕하세요",
          block: { id: "conversation" },
          user: { id: "synthetic-user", type: "botUserKey" },
        },
        action: { id: "synthetic-action", params: {} },
      }),
    },
    testEnv(),
  );
}

function input(botId = newUuid().replaceAll("-", "").slice(0, 24), baseRevision: string | null = null) {
  return {
    baseRevision,
    botId,
    channelPublicId: "_synthetic",
    blockIds: {
      card: "card",
      ordererInfo: "orderer",
      allergyAnswer: "allergy",
      depositorName: "depositor",
      review: "review",
    },
  };
}

async function fixture(options: AppOptions = {}) {
  const ownerId = newUuid(),
    shopId = newUuid();
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO owners(id,kakao_account_id) VALUES($1,$2)", [
      ownerId,
      BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 13)}`).toString(),
    ]);
    await tx.query(
      `INSERT INTO shops (id,owner_id,name,contact_phone,contact_email,business_address,business_name,representative_name,business_reg_no,mail_order_exemption,food_license_no,food_business_type,license_photo_key,entrustment_terms_version,entrustment_consented_at)
      VALUES ($1,$2,'채널 합성 가게','010-0000-0000','channel@example.com','서울 합성로1','합성 제과','시험사장','1234567890','합성 면제','2026-0001','bakery','license/synthetic.jpg','test-v1',$3)`,
      [shopId, ownerId, NOW],
    );
  });
  const clock = { now: NOW };
  const app = createApp({
    scopes: {
      owner: async (c) => {
        if (c.req.header(OWNER) !== ownerId) throw new ApiError("unauthenticated");
        return createShopScope(shopId, { kind: "owner", ownerId });
      },
    },
    services: { now: () => clock.now },
    logSink: () => {},
    ...options,
  });
  const call = (method: string, path = PATH, body?: unknown, key = newRequestKey(), authenticated = true) =>
    app.request(
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
  return { ownerId, shopId, clock, app, call };
}

describeDb("TASK-042 채널 설정과 스킬 키 API-030/031/079", () => {
  afterAll(async () => db.close());

  it("새 가게의 연결은404 not_set임", async () => {
    const h = await fixture();
    await expectProblem(await h.call("GET"), "not_set");
  });

  it.each([
    ["GET", PATH],
    ["PUT", PATH],
    ["POST", `${PATH}/skill-key`],
  ])("인증 없는 %s %s는401임", async (method, path) => {
    const h = await fixture();
    await expectProblem(
      await h.call(method, path, method === "GET" ? undefined : input(), newRequestKey(), false),
      "unauthenticated",
    );
  });

  it("새 연결의 키는 생성/같은 키 재전송에만 보이고 조회에는 버전만 있음", async () => {
    const h = await fixture();
    const body = input(),
      key = newRequestKey();
    const response = await h.call("PUT", PATH, body, key);
    expect(response.status, await response.clone().text()).toBe(200);
    const value = (await response.json()) as {
      kakaoChannel: { connectionId: string; revision: string };
      skillKey: { headerValue: string; keyVersion: number };
    };
    expectSchema("KakaoChannelResult", value);
    expect(value).toMatchObject({
      outcome: "created",
      kakaoChannel: {
        botId: body.botId,
        status: "pending",
        proofPhrase: null,
        claimExpiresAt: "2026-11-22T14:30:00+09:00",
      },
      skillKey: { headerName: "Siljang-Skill-Key", keyVersion: 1 },
    });
    const stored = await db.query("SELECT row_to_json(c) AS row FROM kakao_channels c WHERE c.shop_id=$1", [h.shopId]);
    expect(JSON.stringify(stored.rows)).not.toContain(value.skillKey.headerValue);
    const read = await h.call("GET");
    expect(read.status).toBe(200);
    const readBody = await read.json();
    expectSchema("KakaoChannel", readBody);
    expect(JSON.stringify(readBody)).not.toContain(value.skillKey.headerValue);
    const replay = await h.call("PUT", PATH, body, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(value);
  });

  it("키를 바꾸면23시간 뒤 옛 키는 받고24시간 경계/25시간 뒤는 거절하며 바로 끊기도 됨", async () => {
    const h = await fixture(),
      body = input(),
      created = await save(h, body);
    const old = created.skillKey?.headerValue ?? "";
    expect((await skill(h, body.botId, old)).headers.get("Siljang-Outcome")).toBe("not_accepting");
    h.clock.now = new Date(NOW.getTime() + 1000);
    const at = h.clock.now,
      key = newRequestKey();
    const rotation = { baseRevision: created.kakaoChannel.revision, previousKey: "keep_24h" };
    const response = await h.call("POST", `${PATH}/skill-key`, rotation, key);
    expect(response.status, await response.clone().text()).toBe(200);
    const rotated = (await response.json()) as ChannelResult;
    expectSchema("KakaoChannelResult", rotated);
    expect(rotated).toMatchObject({
      outcome: "done",
      skillKey: { keyVersion: 2 },
      kakaoChannel: { skill: { keyVersion: 2, previousKeyValidUntil: "2026-11-23T14:00:01+09:00" } },
    });
    const current = rotated.skillKey?.headerValue ?? "";
    expect(current).not.toBe(old);
    h.clock.now = new Date(at.getTime() + 23 * 3_600_000);
    expect((await skill(h, body.botId, old)).headers.get("Siljang-Outcome")).toBe("not_accepting");
    for (const hours of [24, 25]) {
      h.clock.now = new Date(at.getTime() + hours * 3_600_000);
      await expectProblem(await skill(h, body.botId, old), "skill_key_invalid");
      expect((await skill(h, body.botId, current)).headers.get("Siljang-Outcome")).toBe("not_accepting");
    }
    const before = await read(h);
    const revoked = await h.call("POST", `${PATH}/skill-key`, {
      baseRevision: before.revision,
      previousKey: "revoke_now",
    });
    expect(revoked.status).toBe(200);
    const latest = (await revoked.json()) as ChannelResult;
    expect(latest).toMatchObject({
      skillKey: { keyVersion: 3 },
      kakaoChannel: { skill: { previousKeyValidUntil: null } },
    });
    await expectProblem(await skill(h, body.botId, current), "skill_key_invalid");
    expect((await skill(h, body.botId, latest.skillKey?.headerValue ?? "")).headers.get("Siljang-Outcome")).toBe(
      "not_accepting",
    );
    const replay = await h.call("POST", `${PATH}/skill-key`, rotation, key);
    expect(await replay.json()).toMatchObject({ skillKey: null, kakaoChannel: { skill: { keyVersion: 3 } } });
    const stored = await db.query("SELECT row_to_json(c) AS row FROM kakao_channels c WHERE c.shop_id=$1", [h.shopId]);
    for (const value of [old, current, latest.skillKey?.headerValue ?? ""])
      expect(JSON.stringify(stored.rows)).not.toContain(value);
  });

  it("같은 봇의 블록 변경은 연결/키를 재생성하지 않고 시험/먼저 보내기를 비움", async () => {
    const h = await fixture(),
      body = input(),
      created = await save(h, body);
    await db.query(
      "UPDATE kakao_channels SET status='linked',claim_expires_at=NULL,linked_at=$2,check_started_at=$2,test_user_key='synthetic-tester',verified_blocks=ARRAY['card','orderer_info','allergy_answer','depositor_name','review'],event_status='ready',event_checked_at=$2 WHERE shop_id=$1",
      [h.shopId, NOW],
    );
    const current = await read(h);
    const value = await save(h, {
      ...body,
      baseRevision: current.revision,
      blockIds: { ...body.blockIds, review: "new-review" },
    });
    expect(value).toMatchObject({
      outcome: "done",
      skillKey: null,
      kakaoChannel: {
        connectionId: created.kakaoChannel.connectionId,
        status: "pending",
        verifiedBlocks: [],
        eventStatus: "unchecked",
        proofPhrase: null,
        skill: { keyVersion: 1 },
      },
    });
    expect((await db.query("SELECT id FROM kakao_channels WHERE shop_id=$1", [h.shopId])).rowCount).toBe(1);
    expect((await skill(h, body.botId, created.skillKey?.headerValue ?? "")).headers.get("Siljang-Outcome")).toBe(
      "not_accepting",
    );
  });

  it("30분 전에는 다른 가게의 선점을 거절하고 경계부터 같은 트랜잭션에서 풂", async () => {
    const a = await fixture(),
      b = await fixture(),
      body = input(),
      first = await save(a, body),
      blockedKey = newRequestKey();
    b.clock.now = new Date(NOW.getTime() + 29 * 60_000);
    await expectProblem(await b.call("PUT", PATH, body, blockedKey), "channel_linked_elsewhere");
    const repeated = await b.call("PUT", PATH, body, blockedKey);
    expect(repeated.headers.get("Idempotency-Replayed")).toBe("true");
    expect(
      (await db.query("SELECT id FROM ops_events WHERE shop_id=$1 AND kind='channel_already_linked'", [b.shopId]))
        .rowCount,
    ).toBe(1);
    b.clock.now = new Date(NOW.getTime() + 30 * 60_000);
    const next = await save(b, body);
    expect(next.kakaoChannel.connectionId).not.toBe(first.kakaoChannel.connectionId);
    expect((await read(a)).status).toBe("failed");
    expect(
      (await db.query("SELECT status,claim_expires_at FROM kakao_channels WHERE shop_id=$1", [a.shopId])).rows,
    ).toEqual([{ status: "failed", claim_expires_at: null }]);
    await expectProblem(await skill(a, body.botId, first.skillKey?.headerValue ?? ""), "skill_key_invalid");
  });

  it("동시 다른 가게의 같은 봇 선점은200/409이고 활성 연결은 하나임", async () => {
    const a = await fixture(),
      b = await fixture(),
      body = input();
    const responses = await Promise.all([a.call("PUT", PATH, body), b.call("PUT", PATH, body)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await db.query("SELECT id FROM kakao_channels WHERE bot_id=$1 AND status IN ('pending','linked')", [body.botId]))
        .rowCount,
    ).toBe(1);
  });

  it("같은 생성 시각의 새 설정은 옛 연결을 보존하고 이전 대기 설정만 그만 씀", async () => {
    const h = await fixture(),
      firstBody = input(),
      firstKey = newRequestKey(),
      a = await save(h, firstBody, firstKey);
    await db.query(
      "UPDATE kakao_channels SET status='linked',claim_expires_at=NULL,linked_at=$2,verified_blocks=ARRAY['card','orderer_info','allergy_answer','depositor_name','review'] WHERE shop_id=$1",
      [h.shopId, NOW],
    );
    const old = await read(h),
      secondBody = input(undefined, old.revision),
      b = await save(h, secondBody);
    expect((await read(h)).connectionId).toBe(b.kakaoChannel.connectionId);
    const third = await save(h, input(undefined, b.kakaoChannel.revision));
    expect((await read(h)).connectionId).toBe(third.kakaoChannel.connectionId);
    const states = await db.query<{ id: string; status: string }>(
      "SELECT id,status FROM kakao_channels WHERE shop_id=$1 ORDER BY configuration_order",
      [h.shopId],
    );
    expect(states.rows).toEqual([
      { id: a.kakaoChannel.connectionId, status: "linked" },
      { id: b.kakaoChannel.connectionId, status: "retired" },
      { id: third.kakaoChannel.connectionId, status: "pending" },
    ]);
    const replay = await h.call("PUT", PATH, firstBody, firstKey);
    expect(await replay.json()).toMatchObject({
      skillKey: null,
      kakaoChannel: { connectionId: third.kakaoChannel.connectionId },
    });
  });

  it("연결 문구는 확인 시작에만 보이고10분 경계부터 실패 사유/키 거절로 바뀜", async () => {
    const h = await fixture(),
      body = input(),
      created = await save(h, body);
    await db.query("UPDATE kakao_channels SET check_started_at=$2 WHERE shop_id=$1", [h.shopId, NOW]);
    h.clock.now = new Date(NOW.getTime() + 10 * 60_000 - 1);
    const checking = await read(h);
    expect(checking.proofPhrase).toMatch(/^연결 [0-9]{6}$/);
    expect(checking.proofPhrase).toBe(
      await deriveKakaoProofPhrase(new Secret(TEST_HASH_KEY), created.kakaoChannel.connectionId, NOW),
    );
    expect(
      JSON.stringify(
        (await db.query("SELECT row_to_json(c) FROM kakao_channels c WHERE c.shop_id=$1", [h.shopId])).rows,
      ),
    ).not.toContain(checking.proofPhrase);
    h.clock.now = new Date(NOW.getTime() + 10 * 60_000);
    const expired = await read(h);
    expect(expired.status).toBe("failed");
    expect(expired.proofPhrase).toBeNull();
    expect(expired.failureHints).toHaveLength(9);
    await expectProblem(await skill(h, body.botId, created.skillKey?.headerValue ?? ""), "skill_key_invalid");
  });

  it("지난 선점 해제 뒤 자기 revision이 틀리면 다른 가게 상태도 되돌림", async () => {
    const a = await fixture(),
      b = await fixture(),
      body = input();
    await save(a, body);
    await save(b, input());
    b.clock.now = new Date(NOW.getTime() + 31 * 60_000);
    await expectProblem(await b.call("PUT", PATH, { ...body, baseRevision: "stale" }), "version_conflict");
    expect((await db.query("SELECT status FROM kakao_channels WHERE shop_id=$1", [a.shopId])).rows).toEqual([
      { status: "pending" },
    ]);
    const own = await read(b);
    await save(b, { ...body, baseRevision: own.revision });
    expect((await read(a)).status).toBe("failed");
  });

  it("키 교체의 동시 저장은200/409이고 두 번 올리지 않음", async () => {
    const h = await fixture(),
      created = await save(h, input());
    const body = { baseRevision: created.kakaoChannel.revision, previousKey: "keep_24h" };
    const responses = await Promise.all([
      h.call("POST", `${PATH}/skill-key`, body),
      h.call("POST", `${PATH}/skill-key`, body),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await read(h)).skill.keyVersion).toBe(2);
  });

  it("없는 연결의 키 교체는404이고 키 버전 상한/옛 revision은 값을 바꾸지 않음", async () => {
    const h = await fixture();
    await expectProblem(
      await h.call("POST", `${PATH}/skill-key`, { baseRevision: "revision", previousKey: "keep_24h" }),
      "not_set",
    );
    const created = await save(h, input());
    await expectProblem(
      await h.call("POST", `${PATH}/skill-key`, { baseRevision: "stale", previousKey: "keep_24h" }),
      "version_conflict",
    );
    await db.query("UPDATE kakao_channels SET skill_key_version=10000 WHERE shop_id=$1", [h.shopId]);
    const current = await read(h);
    await expectProblem(
      await h.call("POST", `${PATH}/skill-key`, { baseRevision: current.revision, previousKey: "keep_24h" }),
      "validation_failed",
    );
    expect((await read(h)).skill.keyVersion).toBe(10000);
    expect(created.kakaoChannel.skill.keyVersion).toBe(1);
  });

  it.each([
    ["GET", PATH],
    ["PUT", PATH],
    ["POST", `${PATH}/skill-key`],
  ])("가게 없는 실제 세션의 %s %s는404임", async (method, path) => {
    const session = await createOwnerSession(
      db,
      { accountId: BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 13)}`).toString(), friend: false },
      NOW,
      false,
    );
    const app = createApp({ services: { now: () => NOW }, logSink: () => {} });
    const response = await app.request(
      `${ORIGIN}/api${path}`,
      {
        method,
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "Idempotency-Key": newRequestKey(),
          cookie: `siljang_owner=${session.token}`,
        },
        ...(method === "GET" ? {} : { body: JSON.stringify(input()) }),
      },
      testEnv(),
    );
    await expectProblem(response, "shop_not_registered");
  });

  it.each([
    ["GET", PATH],
    ["PUT", PATH],
    ["POST", `${PATH}/skill-key`],
  ])("DB 장애의 %s %s는500이고 내부 값은 보이지 않음", async (method, path) => {
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
    const body =
      method === "GET" ? undefined : method === "PUT" ? input() : { baseRevision: "revision", previousKey: "keep_24h" };
    const problem = await expectProblem(await h.call(method, path, body), "internal");
    expect(JSON.stringify(problem)).not.toContain("synthetic private");
  });

  it("없는 블록 묶음은 required임", async () => {
    const h = await fixture();
    const missing = await expectProblem(
      await h.call("PUT", PATH, { ...input(), blockIds: undefined }),
      "validation_failed",
    );
    expect(missing).toMatchObject({ errors: expect.arrayContaining([{ field: "/blockIds", code: "required" }]) });
  });
  it("잘못된 블록 묶음이 있어도 다른 입력 오류를 함께 보여 줌", async () => {
    const h = await fixture();
    const multiple = await expectProblem(
      await h.call("PUT", PATH, { ...input(), botId: "", blockIds: null }),
      "validation_failed",
    );
    expect(multiple).toMatchObject({
      errors: expect.arrayContaining([
        { field: "/botId", code: "too_short" },
        { field: "/blockIds", code: "bad_format" },
      ]),
    });
    expect((await db.query("SELECT id FROM kakao_channels WHERE shop_id=$1", [h.shopId])).rowCount).toBe(0);
  });
});

describe("채널과 키 교체 입력 경계", () => {
  it.each([
    ["baseRevision", "bad:revision"],
    ["baseRevision", "x".repeat(65)],
    ["botId", ""],
    ["botId", "x".repeat(65)],
    ["botId", "with space"],
    ["botId", true],
    ["channelPublicId", "_"],
    ["channelPublicId", "http://other.example"],
    ["channelPublicId", `_${"x".repeat(40)}`],
    ["blockIds", { card: "x" }],
    ["blockIds", null],
    ["blockIds", { ...input().blockIds, review: "x".repeat(101) }],
    ["blockIds", { ...input().blockIds, review: "with space" }],
    ["blockIds", { ...input().blockIds, unknown: "x" }],
    ["shopId", newUuid()],
  ])("%s의 잘못된 경계를 거절함", (name, value) => {
    expect(() => parseChannelInput({ ...input(), [name]: value })).toThrowError(ApiError);
  });
  it("블록100자/봇64자/채널40자/nullable 필드와 기본 봇의 느낌표를 처리함", () => {
    const valid = {
      ...input("f".repeat(64), "r".repeat(64)),
      channelPublicId: `_${"x".repeat(39)}`,
      blockIds: { card: "x".repeat(100), ordererInfo: null, allergyAnswer: null, depositorName: null, review: null },
    };
    expect(parseChannelInput(valid)).toEqual(valid);
    expect(parseChannelInput(input(`${"A".repeat(24)}!`)).botId).toBe("a".repeat(24));
  });
  it.each([
    null,
    {},
    [],
    { baseRevision: null, previousKey: "keep_24h" },
    { baseRevision: "x", previousKey: "unknown" },
    { baseRevision: "x", previousKey: "keep_24h", skillKey: "forbidden" },
  ])("키 교체의 필수/추가 입력을 거절함", (body) => {
    expect(() => parseSkillKeyInput(body)).toThrowError(ApiError);
  });
});
