import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { OWNER_COOKIE } from "../src/owner-oauth";
import { createOwnerSession } from "../src/owner-session";
import { Secret } from "../src/settings";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { createShop, issueTestBookingLink, linkTestChannel } from "./support/shops";

const db = testDb(),
  NOW = new Date("2026-11-22T05:00:00Z"),
  ORIGIN = "https://siljang.example",
  PATH = "/owner/kakao-channel/check";
interface CheckResult {
  outcome: string;
  skillKey: null;
  kakaoChannel: {
    connectionId: string;
    status: string;
    proofPhrase: string | null;
    checkStartedAt: string | null;
    checkExpiresAt: string | null;
    claimExpiresAt: string | null;
    verifiedBlocks: string[];
    eventStatus: string;
  };
}
interface Button {
  blockId: string;
  extra: { check: string };
}
interface TrialReply {
  template: { outputs: { textCard?: { buttons: Button[] }; simpleText?: { text: string } }[] };
}
async function fixture(complete = true) {
  const shop = await createShop(db, "연결 확인 합성 가게");
  await db.query(
    "UPDATE kakao_channels SET check_started_at=NULL,test_user_key=NULL,verified_blocks='{}',card_block_id='card',orderer_block_id=$2,allergy_block_id=$3,depositor_block_id=$4,review_block_id=$5,claim_expires_at=$6 WHERE shop_id=$1",
    [
      shop.shopId,
      complete ? "orderer" : null,
      complete ? "allergy" : null,
      complete ? "depositor" : null,
      complete ? "review" : null,
      new Date(NOW.getTime() + 30 * 60_000),
    ],
  );
  const owner = (
    await db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [shop.ownerId])
  ).rows[0];
  if (!owner) throw new Error("합성 사장님 없음");
  const session = await createOwnerSession(db, { accountId: owner.kakao_account_id, friend: false }, NOW, false),
    clock = { now: NOW };
  let events = 0;
  const app = createApp({
    services: {
      now: () => clock.now,
      fieldCrypto: singleKeyCrypto().fc,
      kakaoEvents: {
        async requestNotice() {
          events++;
          throw new Error("무료 MVP 실제 발신 금지");
        },
        async checkDelivery() {
          events++;
          throw new Error("무료 MVP 실제 발신 조회 금지");
        },
      },
    },
    logSink: () => {},
  });
  const ownerCall = (method: string, path: string, body?: unknown, key = newRequestKey()) =>
    app.request(
      `${ORIGIN}/api${path}`,
      {
        method,
        headers: {
          origin: ORIGIN,
          cookie: `${OWNER_COOKIE}=${session.token}`,
          "Idempotency-Key": key,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      testEnv(),
    );
  const call = (key = newRequestKey()) => ownerCall("POST", PATH, undefined, key);
  const skillKey = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  const skill = (
    kind: string,
    utterance: string,
    blockId = "conversation",
    extra: Record<string, unknown> = {},
    userId = "synthetic-trial-user",
    botId = shop.botId,
    headerKey = skillKey,
  ) =>
    app.request(
      `${ORIGIN}/api/kakao/skills/${kind}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "Siljang-Skill-Key": headerKey },
        body: JSON.stringify({
          bot: { id: botId },
          userRequest: { utterance, block: { id: blockId }, user: { id: userId, type: "botUserKey" } },
          action: { id: "synthetic-action", params: {}, clientExtra: extra },
        }),
      },
      testEnv(),
    );
  const start = async (key?: string) => {
    const response = await call(key);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = (await response.json()) as CheckResult;
    expectSchema("KakaoChannelResult", result);
    return result;
  };
  return { shop, clock, call, ownerCall, start, skill, eventCalls: () => events };
}

async function firstButton(h: Awaited<ReturnType<typeof fixture>>, userId = "synthetic-trial-user") {
  const result = await h.start(),
    response = await h.skill("message", result.kakaoChannel.proofPhrase as string, "conversation", {}, userId);
  expect(response.headers.get("Siljang-Outcome")).toBe("channel_test_card");
  const value = (await response.json()) as TrialReply,
    button = value.template.outputs[0]?.textCard?.buttons[0];
  if (!button) throw new Error("첫 시험 버튼 없음");
  return button;
}

describeDb("TASK-043 연결 확인 시작과 시험 버튼", () => {
  afterAll(async () => db.close());
  it("블록 다섯이 있으면 본문 없이10분 확인과30분 선점을 시작하며 키는 보이지 않음", async () => {
    const h = await fixture(),
      result = await h.start();
    expect(result).toMatchObject({
      outcome: "done",
      skillKey: null,
      kakaoChannel: { status: "pending", verifiedBlocks: [], eventStatus: "unchecked" },
    });
    expect(result.kakaoChannel.proofPhrase).toMatch(/^연결 [0-9]{6}$/);
    expect(new Date(result.kakaoChannel.checkStartedAt as string)).toEqual(NOW);
    expect(new Date(result.kakaoChannel.checkExpiresAt as string)).toEqual(new Date(NOW.getTime() + 10 * 60_000));
    expect(new Date(result.kakaoChannel.claimExpiresAt as string)).toEqual(new Date(NOW.getTime() + 30 * 60_000));
    expect(h.eventCalls()).toBe(0);
  });
  it("블록이 하나라도 없으면409이고 확인을 시작하지 않음", async () => {
    const h = await fixture(false);
    await expectProblem(await h.call(), "channel_setup_incomplete");
    expect(
      (await db.query("SELECT check_started_at FROM kakao_channels WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ check_started_at: null }]);
  });
  it("설정이 없으면404 not_set", async () => {
    const h = await fixture();
    await db.query("UPDATE kakao_channels SET status='retired',retired_at=$2,claim_expires_at=NULL WHERE shop_id=$1", [
      h.shop.shopId,
      NOW,
    ]);
    await expectProblem(await h.call(), "not_set");
  });
  it("사장님 세션만 있고 가게를 등록하지 않았으면404 shop_not_registered", async () => {
    const session = await createOwnerSession(
      db,
      { accountId: BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 14)}`).toString(), friend: false },
      NOW,
      false,
    );
    const response = await createApp({ services: { now: () => NOW }, logSink: () => {} }).request(
      `${ORIGIN}/api${PATH}`,
      {
        method: "POST",
        headers: { origin: ORIGIN, cookie: `${OWNER_COOKIE}=${session.token}`, "Idempotency-Key": newRequestKey() },
      },
      testEnv(),
    );
    await expectProblem(response, "shop_not_registered");
  });
  it.each(["", "bad-request-key"])("요청 키 누락/형식 %s는422이고 확인하지 않음", async (key) => {
    const h = await fixture();
    await expectProblem(await h.call(key), "validation_failed");
    expect(
      (await db.query("SELECT check_started_at FROM kakao_channels WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ check_started_at: null }]);
  });
  it.each(["unchecked", "checking", "ready", "unavailable"])(
    "이미 연결된 %s는 무료 MVP에서unchanged이며 실제 발신/조회0",
    async (eventStatus) => {
      const h = await fixture();
      await db.query(
        "UPDATE kakao_channels SET status='linked',linked_at=$2::timestamptz,claim_expires_at=NULL,verified_blocks=ARRAY['card','orderer_info','allergy_answer','depositor_name','review'],event_status=$3,event_task_id=CASE WHEN $3='checking' THEN 'synthetic-event-task' ELSE NULL END,event_checked_at=CASE WHEN $3 IN ('ready','unavailable') THEN $2::timestamptz ELSE NULL END,event_fail_reason=CASE WHEN $3='unavailable' THEN 'not_delivered' ELSE NULL END WHERE shop_id=$1",
        [h.shop.shopId, NOW, eventStatus],
      );
      const response = await h.start();
      expect(response.outcome).toBe("unchanged");
      expect(response.kakaoChannel.eventStatus).toBe(eventStatus);
      expect(h.eventCalls()).toBe(0);
    },
  );
  it("지난 선점을 다른 가게가 가져갔으면409이고 자기 설정부터 다시 저장해야 함", async () => {
    const h = await fixture(),
      other = await fixture();
    await db.query("UPDATE kakao_channels SET status='failed',claim_expires_at=NULL WHERE shop_id=$1", [h.shop.shopId]);
    await db.query("UPDATE kakao_channels SET bot_id=$2 WHERE shop_id=$1", [other.shop.shopId, h.shop.botId]);
    await expectProblem(await h.call(), "channel_setup_incomplete");
    expect(
      (await db.query("SELECT status,check_started_at FROM kakao_channels WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ status: "failed", check_started_at: null }]);
    expect((await db.query("SELECT status FROM kakao_channels WHERE shop_id=$1", [other.shop.shopId])).rows).toEqual([
      { status: "pending" },
    ]);
  });
  it("다른 요청 키로 여러 번 눌러도 같은 확인이고 같은 키 재전송도 시작 시각을 바꾸지 않음", async () => {
    const h = await fixture(),
      key = newRequestKey(),
      first = await h.start(key);
    h.clock.now = new Date(NOW.getTime() + 5 * 60_000);
    expect((await h.start()).outcome).toBe("unchanged");
    expect((await h.start(key)).kakaoChannel.checkStartedAt).toBe(first.kakaoChannel.checkStartedAt);
    expect(
      (await db.query("SELECT count(*)::int AS n FROM kakao_channels WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ n: 1 }]);
  });
  it("GET 없이 확인10분이 지나 다시 시작하면 새 시각/빈 시험 상태임", async () => {
    const h = await fixture();
    await h.start();
    h.clock.now = new Date(NOW.getTime() + 10 * 60_000);
    const next = await h.start();
    expect(next.outcome).toBe("done");
    expect(new Date(next.kakaoChannel.checkStartedAt as string)).toEqual(h.clock.now);
    expect(next.kakaoChannel.verifiedBlocks).toEqual([]);
  });
  it("10분 뒤 같은 요청 키 재전송은 실패한 현재 화면만 읽고 새 확인을 시작하지 않음", async () => {
    const h = await fixture(),
      key = newRequestKey();
    const first = await h.start(key);
    h.clock.now = new Date(NOW.getTime() + 10 * 60_000);
    const replay = await h.start(key);
    expect(replay.kakaoChannel.status).toBe("failed");
    expect(replay.kakaoChannel.checkStartedAt).toBe(first.kakaoChannel.checkStartedAt);
    expect((await h.start()).kakaoChannel.status).toBe("pending");
  });
  it("같은 사용자의 다른 시험 버튼이 동시에 오면 확인 집합을 잃지 않고 후기를 만들지 않음", async () => {
    const h = await fixture();
    await firstButton(h);
    const responses = await Promise.all([
      h.skill("card", "시험", "orderer", { check: "orderer_info" }),
      h.skill("review", "시험", "review", { check: "review" }),
    ]);
    expect(responses.map((r) => r.headers.get("Siljang-Outcome"))).toEqual(["block_verified", "block_verified"]);
    expect(
      (await db.query("SELECT verified_blocks FROM kakao_channels WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ verified_blocks: ["orderer_info", "review"] }]);
    expect((await db.query("SELECT count(*)::int AS n FROM reviews WHERE shop_id=$1", [h.shop.shopId])).rows).toEqual([
      { n: 0 },
    ]);
  });
  it("연결 문구 아닌 말은 시험 사용자를 남기지 않고 업무 기록도 만들지 않음", async () => {
    const h = await fixture();
    await h.start();
    expect((await h.skill("message", "안녕하세요")).headers.get("Siljang-Outcome")).toBe("not_accepting");
    expect(
      (await db.query("SELECT test_user_key,verified_blocks FROM kakao_channels WHERE shop_id=$1", [h.shop.shopId]))
        .rows,
    ).toEqual([{ test_user_key: null, verified_blocks: [] }]);
  });
  it("연결 문구를 먼저 보낸 사용자를 다른 사용자/그 문구로 덮어쓰지 못함", async () => {
    const h = await fixture(),
      started = await h.start();
    expect(
      (
        await h.skill("message", started.kakaoChannel.proofPhrase as string, "conversation", {}, "first-user")
      ).headers.get("Siljang-Outcome"),
    ).toBe("channel_test_card");
    expect(
      (
        await h.skill("message", started.kakaoChannel.proofPhrase as string, "conversation", {}, "other-user")
      ).headers.get("Siljang-Outcome"),
    ).toBe("not_accepting");
    expect((await db.query("SELECT test_user_key FROM kakao_channels WHERE shop_id=$1", [h.shop.shopId])).rows).toEqual(
      [{ test_user_key: "first-user" }],
    );
  });
  it.each(["user", "block", "skill", "unknown"])("다른 %s의 시험 버튼은 확인됨을 남기지 않음", async (wrong) => {
    const h = await fixture(),
      button = await firstButton(h);
    const result = await h.skill(
      wrong === "skill" ? "review" : "card",
      "시험",
      wrong === "block" ? "wrong-block" : button.blockId,
      wrong === "unknown" ? { check: "unknown" } : button.extra,
      wrong === "user" ? "other-user" : "synthetic-trial-user",
    );
    expect(result.headers.get("Siljang-Outcome")).toBe("not_accepting");
    expect(
      (await db.query("SELECT verified_blocks FROM kakao_channels WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ verified_blocks: [] }]);
  });
  it("같은 시험 버튼이 다시 와도 확인 블록은 한 번이고 같은 다음 버튼을 줌", async () => {
    const h = await fixture(),
      button = await firstButton(h),
      replies: TrialReply[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await h.skill("card", "시험", button.blockId, button.extra);
      expect(response.headers.get("Siljang-Outcome")).toBe("block_verified");
      replies.push((await response.json()) as TrialReply);
    }
    expect(replies[0]).toEqual(replies[1]);
    expect(
      (await db.query("SELECT verified_blocks FROM kakao_channels WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ verified_blocks: ["card"] }]);
  });
  it("마이크로초 시작의10분 경계를SQL로 보고 만료 뒤에는 키도 거절함", async () => {
    const h = await fixture(),
      started = await h.start();
    await db.query(
      "UPDATE kakao_channels SET check_started_at=$2::timestamptz+interval '123 microseconds' WHERE shop_id=$1",
      [h.shop.shopId, NOW],
    );
    h.clock.now = new Date(NOW.getTime() + 10 * 60_000);
    expect((await h.skill("message", started.kakaoChannel.proofPhrase as string)).headers.get("Siljang-Outcome")).toBe(
      "channel_test_card",
    );
    h.clock.now = new Date(NOW.getTime() + 10 * 60_000 + 1);
    expect((await h.skill("card", "시험", "card", { check: "card" })).headers.get("Siljang-Outcome")).toBe(
      "not_accepting",
    );
    expect(
      (await db.query("SELECT status,claim_expires_at FROM kakao_channels WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ status: "failed", claim_expires_at: null }]);
    await expectProblem(await h.skill("message", started.kakaoChannel.proofPhrase as string), "skill_key_invalid");
  });
  it("동시 두 시작은done/unchanged이며 확인 시각은 하나임", async () => {
    const h = await fixture(),
      responses = await Promise.all([h.call(), h.call()]);
    const results = await Promise.all(
      responses.map(async (r) => {
        expect(r.status).toBe(200);
        return (await r.json()) as CheckResult;
      }),
    );
    expect(results.map((r) => r.outcome).sort()).toEqual(["done", "unchanged"]);
    expect(results[0]?.kakaoChannel.checkStartedAt).toBe(results[1]?.kakaoChannel.checkStartedAt);
  });
  it("새 연결을 끝내면 옛 linked를 그만 받고 새 연결만 남김", async () => {
    const h = await fixture();
    await linkTestChannel(db, h.shop.channelId);
    expect((await h.skill("message", "합성 옛 채널")).status).toBe(200);
    const before = (await (await h.ownerCall("GET", "/owner/kakao-channel")).json()) as { revision: string };
    const botId = newUuid().replaceAll("-", "").slice(0, 24),
      saved = await h.ownerCall("PUT", "/owner/kakao-channel", {
        baseRevision: before.revision,
        botId,
        channelPublicId: "_syntheticnew",
        blockIds: {
          card: "card",
          ordererInfo: "orderer",
          allergyAnswer: "allergy",
          depositorName: "depositor",
          review: "review",
        },
      });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const setup = (await saved.json()) as { kakaoChannel: { connectionId: string }; skillKey: { headerValue: string } },
      started = await h.start();
    let response = await h.skill(
      "message",
      started.kakaoChannel.proofPhrase as string,
      "conversation",
      {},
      "synthetic-trial-user",
      botId,
      setup.skillKey.headerValue,
    );
    for (let i = 0; i < 5; i++) {
      const body = (await response.json()) as TrialReply,
        button = body.template.outputs[0]?.textCard?.buttons[0];
      if (!button) throw new Error("다음 시험 버튼 없음");
      response = await h.skill(
        button.extra.check === "review" ? "review" : "card",
        "시험",
        button.blockId,
        button.extra,
        "synthetic-trial-user",
        botId,
        setup.skillKey.headerValue,
      );
    }
    expect(response.headers.get("Siljang-Outcome")).toBe("channel_linked");
    await expectProblem(await h.skill("message", "합성 옛 채널"), "skill_key_invalid");
    expect(
      (
        await db.query("SELECT id,status FROM kakao_channels WHERE shop_id=$1 ORDER BY configuration_order", [
          h.shop.shopId,
        ])
      ).rows,
    ).toEqual([
      { id: h.shop.channelId, status: "retired" },
      { id: setup.kakaoChannel.connectionId, status: "linked" },
    ]);
    expect(h.eventCalls()).toBe(0);
  });
  it("연결 문구와 시험 버튼 다섯은 상담/주문/후기를 만들지 않고 연결 뒤 메시지는 상담으로 들어감", async () => {
    const h = await fixture(),
      started = await h.start();
    const counts = async () =>
      (
        await db.query<{ messages: number; inbound: number; orders: number; reviews: number }>(
          "SELECT (SELECT count(*) FROM messages WHERE shop_id=$1)::int AS messages,(SELECT count(*) FROM messages WHERE shop_id=$1 AND direction='inbound')::int AS inbound,(SELECT count(*) FROM orders WHERE shop_id=$1)::int AS orders,(SELECT count(*) FROM reviews WHERE shop_id=$1)::int AS reviews",
          [h.shop.shopId],
        )
      ).rows[0];
    const before = await counts(),
      response = await h.skill("message", started.kakaoChannel.proofPhrase as string);
    expect(response.headers.get("Siljang-Outcome")).toBe("channel_test_card");
    let body = (await response.json()) as TrialReply;
    expectSchema("SkillTemplateResponse", body);
    let last: Button | undefined;
    for (let i = 0; i < 5; i++) {
      const button = body.template.outputs[0]?.textCard?.buttons[0];
      if (!button) throw new Error("다음 시험 버튼 없음");
      last = button;
      const result = await h.skill(
        button.extra.check === "review" ? "review" : "card",
        "시험",
        button.blockId,
        button.extra,
      );
      expect(result.headers.get("Siljang-Outcome")).toBe(i === 4 ? "channel_linked" : "block_verified");
      body = (await result.json()) as TrialReply;
      expectSchema("SkillTemplateResponse", body);
    }
    expect(await counts()).toEqual(before);
    expect(h.eventCalls()).toBe(0);
    expect(
      (
        await db.query(
          "SELECT status,claim_expires_at,event_status,verified_blocks FROM kakao_channels WHERE shop_id=$1",
          [h.shop.shopId],
        )
      ).rows,
    ).toEqual([
      {
        status: "linked",
        claim_expires_at: null,
        event_status: "unchecked",
        verified_blocks: ["card", "orderer_info", "allergy_answer", "depositor_name", "review"],
      },
    ]);
    if (!last) throw new Error("후기 시험 버튼 없음");
    expect((await h.skill("review", "시험", last.blockId, last.extra)).headers.get("Siljang-Outcome")).toBe(
      "channel_linked",
    );
    expect(await counts()).toEqual(before);
    await issueTestBookingLink(db, h.shop);
    const normal = await h.skill("message", "합성 상담을 시작할게요");
    expect(normal.headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    expect((await counts())?.inbound).toBe((before?.inbound as number) + 1);
    expect(h.eventCalls()).toBe(0);
  });
});

it("인증 없는 연결 확인 시작은401이고DB를 읽거나 쓰지 않음", async () => {
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
    "https://siljang.example/api/owner/kakao-channel/check",
    { method: "POST", headers: { origin: "https://siljang.example", "Idempotency-Key": newRequestKey() } },
    testEnv(),
  );
  await expectProblem(response, "unauthenticated");
  expect(calls).toBe(0);
});
it("연결 확인 경로는POST만 받고 GET은405와Allow를 돌려줌", async () => {
  const app = createApp({ logSink: () => {} }),
    response = await app.request("https://siljang.example/api/owner/kakao-channel/check", {}, testEnv());
  await expectProblem(response, "method_not_allowed");
  expect(response.headers.get("allow")).toBe("POST");
});
