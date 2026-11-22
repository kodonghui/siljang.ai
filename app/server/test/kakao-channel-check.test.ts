import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { OWNER_COOKIE } from "../src/owner-oauth";
import { createOwnerSession } from "../src/owner-session";
import { Secret } from "../src/settings";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { createShop, issueTestBookingLink } from "./support/shops";

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
  const call = (key = newRequestKey()) =>
    app.request(
      `${ORIGIN}/api${PATH}`,
      {
        method: "POST",
        headers: { origin: ORIGIN, cookie: `${OWNER_COOKIE}=${session.token}`, "Idempotency-Key": key },
      },
      testEnv(),
    );
  const skillKey = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  const skill = (
    kind: string,
    utterance: string,
    blockId = "conversation",
    extra: Record<string, unknown> = {},
    userId = "synthetic-trial-user",
  ) =>
    app.request(
      `${ORIGIN}/api/kakao/skills/${kind}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "Siljang-Skill-Key": skillKey },
        body: JSON.stringify({
          bot: { id: shop.botId },
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
  return { shop, clock, call, start, skill, eventCalls: () => events };
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
