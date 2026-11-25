import { DatabaseError } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { recordAiCall } from "../src/ai-calls";
import type { AiModel } from "../src/ai-model";
import { createApp } from "../src/app";
import { closeIdleConsultation } from "../src/consultation-idle";
import { createOrderConfirmedNotice } from "../src/customer-notice-store";
import { FieldCryptoError, fieldCrypto } from "../src/field-crypto";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob, KakaoCallbackQueue } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import * as policyCurrent from "../src/privacy-policy-current";
import { readSettings, Secret } from "../src/settings";
import { createShopScope, shopDb } from "../src/shop-scope";
import * as trace from "../src/trace";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const ORIGIN = "https://siljang.example";
const POLICY = {
  transfers: ["anthropic", "supabase", "cloudflare"].map((recipient) => ({
    recipient: `${recipient} 합성 회사`,
    country: "합성 국가",
    personalData: "개인정보를 가린 상담 대화",
    whenAndHow: "상담 때 암호화 전송",
    purposeAndRetention: "합성 상담 목적과 기간",
    howToRefuse: "가게에 거부를 알리면 온라인 상담을 쓰지 않아요",
  })),
};
const NOW = new Date("2026-11-23T10:00:00+09:00");
describeDb("첫 AI 고지의 전달과 처리방침 버전(TASK-064)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string;
  let now = NOW;
  const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
  const jobs: KakaoCallbackJob[] = [];
  const policyLogs = collectLogs();
  const enqueue = vi.fn<KakaoCallbackQueue["send"]>(async (job) => {
    jobs.push(job);
  });
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    now = NOW;
    jobs.length = 0;
    policyLogs.lines.length = 0;
    enqueue.mockClear();
    shop = await createShop(isolated.db, "합성 수신 가게");
    await issueTestBookingLink(isolated.db, shop);
    await isolated.db.query("UPDATE privacy_policies SET published_at=$2 WHERE shop_id=$1", [shop.shopId, NOW]);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 수신 시험에서 실제 외부 호출 금지"));
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await isolated?.close();
  });

  async function send(user: string, utterance: string, friend?: boolean, target = shop, suppliedKey = key) {
    return createApp({
      connect: () => isolated.connect(),
      services: {
        now: () => now,
        kakaoCallbackQueue: { send: enqueue },
        aiModel: model(),
        privacyPolicy: POLICY,
        publicAppOrigin: ORIGIN,
      },
      logSink: () => {},
    }).request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": suppliedKey },
        body: JSON.stringify({
          bot: { id: target.botId },
          userRequest: {
            utterance,
            callbackUrl: "https://bot-api.kakao.com/v1/callback/synthetic_input",
            block: { id: "input" },
            user: {
              id: user,
              type: "botUserKey",
              ...(friend === undefined ? {} : { properties: { isFriend: friend } }),
            },
          },
          action: { id: "input", params: {} },
        }),
      },
      env,
    );
  }
  function model(reply: () => string = () => "합성 질문을 확인했어요.") {
    const call = vi.fn<AiModel["call"]>(async (input) => {
      const aiCallId = await recordAiCall(input.db, {
        consultationId: input.consultationId,
        traceId: input.traceId,
        attempt: input.attempt,
        provider: "anthropic",
        model: "claude-haiku-5-5",
        promptVersion: input.promptVersion,
        reasoning: {},
        sentAt: now,
        firstTokenMs: 0,
        totalMs: 1,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        cost: { usd: "0.00", krw: "0.00", basis: "synthetic" },
        result: "success",
        stopReason: null,
        errorKind: null,
        fallbackReason: null,
      });
      return { ok: true, aiCallId, output: { reply: reply() } };
    });
    return { provider: "anthropic" as const, model: "claude-haiku-5-5", call };
  }
  function required<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw new Error("필요한 합성 시험 자료가 없어요");
    return value;
  }
  async function consume(
    job: KakaoCallbackJob,
    aiModel: ReturnType<typeof model>,
    success = true,
    policy = POLICY,
    onSend: () => void = () => {},
  ) {
    const callback = vi.fn<typeof fetch>(async () => {
      onSend();
      return Response.json({ status: success ? "SUCCESS" : "FAIL" });
    });
    expect(
      await consumeKakaoCallback(job, env, {
        connect: () => isolated.connect(),
        now: () => new Date(now.getTime() + 1000),
        fetch: callback,
        services: { aiModel, privacyPolicy: policy, publicAppOrigin: ORIGIN },
        logSink: () => {},
      }),
    ).toBe("done");
    return callback;
  }
  const texts = (callback: ReturnType<typeof vi.fn<typeof fetch>>) =>
    callback.mock.calls.flatMap(([, init]) =>
      (JSON.parse(String(init?.body)).template.outputs as { simpleText: { text: string } }[]).map(
        (x) => x.simpleText.text,
      ),
    );
  async function record(user: string) {
    return (
      await isolated.db.query<{ id: string; ai_disclosed_at: Date | null; ai_disclosed_policy_version: number | null }>(
        `SELECT c.id,c.ai_disclosed_at,c.ai_disclosed_policy_version FROM consultations c JOIN customers u ON u.shop_id=c.shop_id AND u.id=c.customer_id
       WHERE c.shop_id=$1 AND u.kakao_user_key=$2 ORDER BY c.opened_at,c.id`,
        [shop.shopId, user],
      )
    ).rows;
  }
  async function immediate(user: string, utterance: string, enabled = true, fields?: ReturnType<typeof fieldCrypto>) {
    return createApp({
      connect: () => isolated.connect(),
      services: {
        now: () => now,
        privacyPolicy: POLICY,
        publicAppOrigin: ORIGIN,
        ...(enabled ? { aiModel: model() } : {}),
        ...(fields ? { fieldCrypto: fields } : {}),
      },
      logSink: policyLogs.sink,
    }).request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: { utterance, user: { id: user, type: "botUserKey" } },
          action: { id: "input", params: {} },
        }),
      },
      env,
    );
  }
  it("콜백 실패 뒤 문의 끊김이 되면 고지 전 AI를 빼고 뒤 사장님 안내를 전한다", async () => {
    const user = newUuid();
    await send(user, "문의 끊김 전 합성 질문");
    await consume(required(jobs[0]), model(), false);
    const consultation = required((await record(user))[0]);
    const closedAt = new Date(NOW.getTime() + 24 * 3600000);
    await isolated.db.transaction((tx) =>
      closeIdleConsultation(
        shopDb(createShopScope(shop.shopId, { kind: "job", job: "consultation_idle" }), tx),
        consultation.id,
        closedAt,
      ),
    );
    const noticeId = newUuid();
    await isolated.db.query(
      `INSERT INTO notifications (id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status,created_at)
       SELECT $2,shop_id,customer_id,id,'owner_reply',$3,'owner_reply','문의 끊김 뒤 합성 사장님 안내','deferred',$4
       FROM consultations WHERE id=$1`,
      [consultation.id, noticeId, `notice:${noticeId}`, new Date(closedAt.getTime() + 2000)],
    );
    now = new Date(closedAt.getTime() + 4000);
    const response = await immediate(user, "");
    expect(await response.text()).toContain("문의 끊김 뒤 합성 사장님 안내");
    expect((await record(user))[0]?.ai_disclosed_at).toBeNull();
    expect(
      (
        await isolated.db.query("SELECT delivery FROM messages WHERE consultation_id=$1 AND author='ai'", [
          consultation.id,
        ])
      ).rows,
    ).toEqual([{ delivery: "failed" }]);
  });
  it("발신 직전 넘김으로 바꾼 AI 답은 실패 표시하고 다음 답에 다시 보내지 않는다", async () => {
    const user = newUuid(),
      ai = model(),
      invoke = required(ai.call.getMockImplementation());
    const previous = required(
      (await isolated.db.query("SELECT booking_slug,booking_issued_at FROM shops WHERE id=$1", [shop.shopId])).rows[0],
    );
    ai.call.mockImplementationOnce(async (input) => {
      const answer = await invoke(input);
      await isolated.db.query("UPDATE shops SET booking_slug=NULL,booking_issued_at=NULL WHERE id=$1", [shop.shopId]);
      return { ...answer, output: { reply: "넘김으로 폐기할 합성 AI 답" } };
    });
    await send(user, "넘김 전 합성 질문");
    await consume(required(jobs[0]), ai);
    expect(
      (
        await isolated.db.query(
          "SELECT delivery,sent_at FROM messages WHERE shop_id=$1 AND body_masked='넘김으로 폐기할 합성 AI 답'",
          [shop.shopId],
        )
      ).rows,
    ).toEqual([{ delivery: "failed", sent_at: null }]);
    await isolated.db.query("UPDATE shops SET booking_slug=$2,booking_issued_at=$3 WHERE id=$1", [
      shop.shopId,
      previous.booking_slug,
      previous.booking_issued_at,
    ]);
    now = new Date(NOW.getTime() + 4000);
    await send(user, "다음 합성 질문");
    expect(texts(await consume(required(jobs[1]), ai))).not.toContain("넘김으로 폐기할 합성 AI 답");
  });
  it.each(["키 없는 합성 첫 질문", ""])("AI 설정 없는 첫 응답에는 고지와 완료 기록이 없다(%s)", async (utterance) => {
    const user = newUuid(),
      response = await immediate(user, utterance, false);
    expect(await response.text()).not.toContain("AI가 상담합니다");
    expect(required((await record(user))[0]).ai_disclosed_at).toBeNull();
  });
  it.each(["inline", "callback"])("AI가 나중에 켜지면 첫 활성 응답부터 고지를 한다(%s)", async (mode) => {
    const user = newUuid();
    expect(await (await immediate(user, "AI 설정 전 합성 질문", false)).text()).not.toContain("AI가 상담합니다");
    expect(required((await record(user))[0]).ai_disclosed_at).toBeNull();
    now = new Date(NOW.getTime() + 4000);
    if (mode === "inline")
      expect(await (await immediate(user, "AI 설정 뒤 합성 질문")).text()).toContain("AI가 상담합니다");
    else {
      await send(user, "AI 설정 뒤 합성 질문");
      expect(texts(await consume(required(jobs[0]), model()))[0]).toContain("AI가 상담합니다");
    }
    expect(required((await record(user))[0]).ai_disclosed_at).not.toBeNull();
  });
  it("고지가 끝난 상담의 스티커는 정책을 다시 잠그거나 읽지 않는다", async () => {
    const user = newUuid();
    await send(user, "고지를 끝낼 합성 질문");
    await consume(required(jobs[0]), model());
    const policy = vi.spyOn(policyCurrent, "currentPrivacyPolicy").mockRejectedValue(new Error("합성 정책 읽기 실패"));
    now = new Date(NOW.getTime() + 4000);
    const response = await immediate(user, "");
    expect(response.headers.get("Siljang-Outcome")).not.toBe("server_error");
    expect(policy).not.toHaveBeenCalled();
  });
  it("고지 전이라도 중복 요청은 정책 읽기 트랜잭션을 만들지 않는다", async () => {
    const user = newUuid();
    await send(user, "중복 합성 질문");
    const policy = vi.spyOn(policyCurrent, "currentPrivacyPolicy").mockRejectedValue(new Error("합성 정책 읽기 실패"));
    const response = await send(user, "중복 합성 질문");
    expect(response.headers.get("Siljang-Outcome")).not.toBe("server_error");
    expect(policy).not.toHaveBeenCalled();
  });
  it.each([
    {
      label: "PostgreSQL",
      error: Object.assign(new DatabaseError("합성 정책 읽기 실패"), { code: "40001", name: "error" }),
      errorName: "DatabaseError",
      dbCode: "40001",
    },
    { label: "일반 오류", error: new RangeError("합성 정책 읽기 실패"), errorName: "RangeError", dbCode: undefined },
    { label: "오류 객체 외", error: "합성 정책 읽기 실패", errorName: "Error", dbCode: undefined },
  ])("정책 읽기 실패 경고에 표준 오류 이름과 요청 ID만 남긴다($label)", async ({ error, errorName, dbCode }) => {
    const requestTrace = "a".repeat(32);
    vi.spyOn(trace, "newTraceId").mockReturnValue("b".repeat(32)).mockReturnValueOnce(requestTrace);
    vi.spyOn(policyCurrent, "currentPrivacyPolicy").mockRejectedValue(error);
    const response = await immediate(newUuid(), "");
    expect(response.headers.get("Siljang-Outcome")).not.toBe("server_error");
    expect(await response.text()).not.toContain("AI가 상담합니다");
    expect(policyLogs.lines.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "kakao_disclosure_policy_failed",
          code: "policy_unavailable",
          errorName,
          traceId: requestTrace,
          ...(dbCode === undefined ? {} : { dbCode }),
        }),
      ]),
    );
    const warning = policyLogs.lines
      .map((line) => JSON.parse(line))
      .find((line) => line.event === "kakao_disclosure_policy_failed");
    expect(warning?.dbCode).toBe(dbCode);
    expect(trace.newTraceId).toHaveBeenCalledOnce();
    expect(policyLogs.lines.join("\n")).not.toContain("합성 정책 읽기 실패");
  });
  it("AI 설정이 있으면 마스킹 실패의 첫 넘김 안내에도 고지를 붙인다", async () => {
    const user = newUuid(),
      fields = fieldCrypto(required(readSettings(env).fieldKeys));
    vi.spyOn(fields, "seal").mockRejectedValue(new FieldCryptoError("합성 암호화 실패"));
    const response = await immediate(user, "합성 연락처 010-1234-5678", true, fields);
    expect(await response.text()).toContain("AI가 상담합니다");
    expect(required((await record(user))[0]).ai_disclosed_at).not.toBeNull();
    expect(
      (
        await isolated.db.query("SELECT reason FROM handoffs WHERE consultation_id=$1", [
          required((await record(user))[0]).id,
        ])
      ).rows,
    ).toEqual([{ reason: "masking_failed" }]);
  });
  it("고지 전이어도 수신 한도를 넘은 요청은 정책을 다시 잠그지 않는다", async () => {
    const user = newUuid();
    for (let i = 0; i < 20; i++) await send(user, `수신 한도 합성 질문 ${i}`);
    const policy = vi.spyOn(policyCurrent, "currentPrivacyPolicy").mockRejectedValue(new Error("합성 정책 읽기 실패"));
    const response = await send(user, "수신 한도 뒤 합성 질문");
    expect(response.headers.get("Siljang-Outcome")).not.toBe("server_error");
    expect(policy).not.toHaveBeenCalled();
  });
  it("두 번째 고지 준비의 일시 DB 오류는 답을 폐기하거나 넘기지 않고 재시도한다", async () => {
    const user = newUuid(),
      ai = model(),
      invoke = required(ai.call.getMockImplementation());
    ai.call.mockImplementationOnce(async (input) => {
      const result = await invoke(input);
      vi.spyOn(policyCurrent, "currentPrivacyPolicy").mockRejectedValueOnce(
        Object.assign(new DatabaseError("합성 직렬화 실패"), { code: "40001", name: "error" }),
      );
      return result;
    });
    await send(user, "일시 DB 오류 합성 질문");
    const job = required(jobs[0]),
      callback = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
    await expect(
      consumeKakaoCallback(job, env, {
        connect: () => isolated.connect(),
        now: () => new Date(now.getTime() + 1000),
        fetch: callback,
        services: { aiModel: ai, privacyPolicy: POLICY, publicAppOrigin: ORIGIN },
        logSink: () => {},
      }),
    ).rejects.toMatchObject({ code: "40001" });
    expect(callback).not.toHaveBeenCalled();
    expect(
      (
        await isolated.db.query("SELECT id FROM handoffs WHERE consultation_id=$1", [
          required((await record(user))[0]).id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await isolated.db.query("SELECT delivery,sent_at FROM messages WHERE consultation_id=$1 AND author='ai'", [
          required((await record(user))[0]).id,
        ])
      ).rows,
    ).toEqual([{ delivery: "deferred", sent_at: null }]);
    expect(texts(await consume(job, ai))[0]).toContain("AI가 상담합니다");
    expect(ai.call).toHaveBeenCalledOnce();
  });
  it("글19개와 후기 카드1개 뒤20번째 글도 첫 고지를 전한다", async () => {
    const user = newUuid();
    for (let i = 0; i < 19; i++) await send(user, `후기 카드 전 합성 질문 ${i}`);
    const consultation = required((await record(user))[0]),
      id = newUuid();
    await isolated.db.query(
      "INSERT INTO messages (id,shop_id,consultation_id,direction,author,kind,kakao_message_id,body_masked,created_at) VALUES ($1,$2,$3,'inbound','customer','card',$4,'합성 후기',$5)",
      [id, shop.shopId, consultation.id, `synthetic-review:${id}`, NOW],
    );
    const policy = vi.spyOn(policyCurrent, "currentPrivacyPolicy");
    const response = await immediate(user, "후기 카드 뒤20번째 합성 글");
    expect(await response.text()).toContain("AI가 상담합니다");
    expect(policy).toHaveBeenCalledOnce();
  });
  it("새 손님의 첫 답은 고지·처리방침 링크·AI 답 순서이며 성공 뒤 게시 버전을 남긴다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "합성 첫 질문");
    const job = required(jobs[0]);
    const callback = await consume(job, ai);
    expect(ai.call).toHaveBeenCalledOnce();
    expect(texts(callback)).toHaveLength(2);
    expect(texts(callback)[0]).toContain("AI가 상담합니다");
    const slug = required(
      (await isolated.db.query("SELECT booking_slug FROM shops WHERE id=$1", [shop.shopId])).rows[0],
    ).booking_slug;
    expect(texts(callback)[0]).toContain(`${ORIGIN}/s/${slug}/privacy`);
    expect(texts(callback)[1]).toBe("합성 질문을 확인했어요.");
    const row = required((await record(user))[0]);
    const latest = required(
      (
        await isolated.db.query(
          "SELECT max(version)::int AS version FROM privacy_policies WHERE shop_id=$1 AND published_at <= $2",
          [shop.shopId, new Date(now.getTime() + 1000)],
        )
      ).rows[0],
    ).version;
    expect(row.ai_disclosed_at).toEqual(new Date(now.getTime() + 1000));
    expect(row.ai_disclosed_policy_version).toBe(latest);
    const repeated = await consume(job, ai);
    expect(repeated).not.toHaveBeenCalled();
    expect(ai.call).toHaveBeenCalledOnce();
  });
  it("이어가는 상담에는 고지를 반복하지 않고 끝난 상담 뒤 새 상담에는 다시 고지한다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "합성 첫 질문");
    expect(texts(await consume(required(jobs[0]), ai))[0]).toContain("AI가 상담합니다");
    const first = required((await record(user))[0]);
    now = new Date(NOW.getTime() + 4000);
    await send(user, "합성 이어지는 질문");
    expect(texts(await consume(required(jobs[1]), ai))).toEqual(["합성 질문을 확인했어요."]);
    expect((await record(user))[0]).toEqual(first);
    await isolated.db.query("UPDATE consultations SET status='ended',ended_at=$2 WHERE id=$1", [first.id, now]);
    now = new Date(NOW.getTime() + 8000);
    await send(user, "새 합성 상담");
    expect(texts(await consume(required(jobs[2]), ai))[0]).toContain("AI가 상담합니다");
    expect(await record(user)).toHaveLength(2);
    expect((await record(user)).find((x) => x.id === first.id)).toEqual(first);
  });
  it("카카오 실패 때 고지 완료를 남기지 않고 다음 응답에도 고지를 먼저 붙인다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "발신이 실패할 합성 질문");
    const failed = await consume(required(jobs[0]), ai, false);
    expect(texts(failed)[0]).toContain("AI가 상담합니다");
    expect((await record(user))[0]).toMatchObject({ ai_disclosed_at: null, ai_disclosed_policy_version: null });
    now = new Date(NOW.getTime() + 4000);
    await send(user, "다음 합성 질문");
    const recovered = texts(await consume(required(jobs[1]), ai));
    expect(recovered[0]).toContain("AI가 상담합니다");
    expect(recovered.slice(1)).toContain("합성 질문을 확인했어요.");
    expect((await record(user))[0]?.ai_disclosed_at).not.toBeNull();
  });

  it("발신 전에 바뀐 설정은 새 게시 버전을 쓰고 지난 상담 버전은 보존한다", async () => {
    const user = newUuid(),
      ai = model(),
      policy = structuredClone(POLICY);
    const invoke = required(ai.call.getMockImplementation());
    ai.call.mockImplementationOnce(async (input) => {
      const answer = await invoke(input);
      required(policy.transfers[0]).recipient = "바뀐 합성 모델 회사";
      return answer;
    });
    await send(user, "배포 설정이 바뀌는 동안의 합성 질문");
    expect(texts(await consume(required(jobs[0]), ai, true, policy))[0]).toContain("AI가 상담합니다");
    const version = (await record(user))[0]?.ai_disclosed_policy_version;
    const rows = (
      await isolated.db.query("SELECT version,body FROM privacy_policies WHERE shop_id=$1 ORDER BY version", [
        shop.shopId,
      ])
    ).rows;
    expect(version).toBe(rows.at(-1)?.version);
    expect(rows.at(-1)?.body).toContain("바뀐 합성 모델 회사");
    expect(rows[0]?.version).toBe(1);
    expect(
      (
        await isolated.db.query("SELECT ai_disclosed_policy_version FROM consultations WHERE id=$1", [
          shop.consultationId,
        ])
      ).rows[0]?.ai_disclosed_policy_version,
    ).toBe(1);
  });
  it("같은 가게의 두 첫 상담이 겹쳐도 동일한 새 정책 버전을 쓴다", async () => {
    const ai = model(),
      users = [newUuid(), newUuid()];
    for (const user of users) await send(user, "동시에 고지할 합성 질문");
    const callbacks = await Promise.all(jobs.map((job) => consume(job, ai)));
    for (const callback of callbacks) expect(texts(callback)[0]).toContain("AI가 상담합니다");
    const versions = await Promise.all(users.map(async (user) => (await record(user))[0]?.ai_disclosed_policy_version));
    expect(versions[0]).toBe(versions[1]);
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM privacy_policies WHERE shop_id=$1", [shop.shopId]))
        .rows[0]?.n,
    ).toBe(2);
  });

  it.each([false, true])(
    "끝난 상담의 확정 안내와 규정은 새 고지 뒤 AI 답보다 먼저 한 번 전한다(규정 두 출력 %s)",
    async (twoParts) => {
      const paid = newUuid();
      await isolated.db.transaction(async (tx) => {
        await tx.query(
          "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_amount=amount,arrived_at=$2 WHERE id=$1",
          [shop.paymentRequestId, now],
        );
        await tx.query(
          "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
          [paid, shop.shopId, shop.orderId, shop.paymentRequestId, now],
        );
        await tx.query("UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1", [
          shop.orderId,
          now,
          paid,
        ]);
        await tx.query("UPDATE consultations SET status='ended',ended_at=$2 WHERE id=$1", [shop.consultationId, now]);
        await tx.query(
          "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',1,'합성 규정','합성 조건',$3) ON CONFLICT(operating_rules_id,position) DO UPDATE SET effect_text=EXCLUDED.effect_text",
          [shop.shopId, shop.operatingRulesId, `합성 원래 규정${twoParts ? "가".repeat(700) : ""}`],
        );
        if (twoParts)
          await tx.query(
            "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',2,'합성 추가 규정','합성 조건',$3)",
            [shop.shopId, shop.operatingRulesId, `합성 두번째 규정${"나".repeat(700)}`],
          );
      });
      const notice = required(
        await isolated.db.transaction((tx) =>
          createOrderConfirmedNotice(
            shopDb(createShopScope(shop.shopId, { kind: "job", job: "customer_notice" }), tx),
            shop.orderId,
            now,
          ),
        ),
      );
      const body = required(
        (await isolated.db.query<{ body: string }>("SELECT body FROM notifications WHERE id=$1", [notice.id])).rows[0],
      ).body;
      const replies = ["합성 첫 답이에요.", "합성 둘째 답이에요.", "합성 셋째 답이에요.", "합성 넷째 답이에요."];
      let answered = 0;
      const ai = model(() => required(replies[answered++]));
      const pending = async () =>
        required(
          (
            await isolated.db.query<{ n: number }>(
              "SELECT count(*)::int AS n FROM messages m JOIN consultations c ON c.shop_id=m.shop_id AND c.id=m.consultation_id WHERE m.shop_id=$1 AND c.customer_id=$2 AND m.author='ai' AND m.direction='outbound' AND m.delivery='deferred'",
              [shop.shopId, shop.customerId],
            )
          ).rows[0],
        ).n;
      now = new Date(now.getTime() + 4000);
      await send(shop.userKey, "끝난 상담 뒤의 합성 첫 질문");
      const first = texts(await consume(required(jobs[0]), ai));
      expect(first[0]).toContain("AI가 상담합니다");
      if (twoParts) expect(first).toHaveLength(1);
      else {
        expect(first).toHaveLength(3);
        expect(first[1]).toBe(body);
        expect(first[2]).toContain("합성 원래 규정");
      }
      expect(await pending()).toBe(1);
      expect(
        (await isolated.db.query("SELECT status FROM consultations WHERE id=$1", [shop.consultationId])).rows,
      ).toEqual([{ status: "ended" }]);
      expect((await isolated.db.query("SELECT status FROM notifications WHERE id=$1", [notice.id])).rows).toEqual([
        { status: twoParts ? "deferred" : "delivered_on_reply" },
      ]);
      now = new Date(now.getTime() + 4000);
      await send(shop.userKey, "합성 둘째 질문");
      const second = texts(await consume(required(jobs[1]), ai));
      if (twoParts) {
        expect(second).toHaveLength(3);
        expect(second[0]).toBe(body);
        expect(second[1]).toContain("합성 원래 규정");
        expect(second[2]).toContain("합성 두번째 규정");
        expect(await pending()).toBe(2);
      } else {
        expect(second).toEqual(replies.slice(0, 2));
        expect(await pending()).toBe(0);
      }
      expect((await isolated.db.query("SELECT status FROM notifications WHERE id=$1", [notice.id])).rows).toEqual([
        { status: "delivered_on_reply" },
      ]);
      now = new Date(now.getTime() + 4000);
      await send(shop.userKey, "합성 셋째 질문");
      expect(texts(await consume(required(jobs[2]), ai))).toEqual(twoParts ? replies.slice(0, 3) : [replies[2]]);
      expect(await pending()).toBe(0);
      if (twoParts) {
        now = new Date(now.getTime() + 4000);
        await send(shop.userKey, "합성 넷째 질문");
        expect(texts(await consume(required(jobs[3]), ai))).toEqual([replies[3]]);
      }
      expect(ai.call).toHaveBeenCalledTimes(twoParts ? 4 : 3);
    },
  );
  it("실제 문의 끊김 뒤 재개는 고지 기록을 유지하고 이전 안내를 AI 답 전에 한 번 전한다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "고지를 받을 합성 질문");
    await consume(required(jobs[0]), ai);
    const first = required((await record(user))[0]);
    now = new Date(NOW.getTime() + 24 * 3600000);
    await isolated.db.transaction((tx) =>
      closeIdleConsultation(
        shopDb(createShopScope(shop.shopId, { kind: "job", job: "consultation_idle" }), tx),
        first.id,
        now,
      ),
    );
    const noticeId = newUuid();
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status,created_at) SELECT $2,shop_id,customer_id,id,'no_answer_closed',$3,'no_answer_closed','합성 이전 닫힘 안내','deferred',$4 FROM consultations WHERE id=$1",
      [first.id, noticeId, `notice:${noticeId}`, new Date(now.getTime() + 1000)],
    );
    now = new Date(now.getTime() + 4000);
    await send(user, "문의 끊김 뒤 다시 온 합성 질문");
    const callback = await consume(required(jobs[1]), ai);
    expect(texts(callback)).toEqual(["합성 이전 닫힘 안내", "합성 질문을 확인했어요."]);
    expect((await record(user))[0]).toEqual(first);
    expect(ai.call).toHaveBeenCalledTimes(2);
    now = new Date(now.getTime() + 4000);
    await send(user, "합성 재개 뒤 다음 질문");
    expect(texts(await consume(required(jobs[2]), ai))).toEqual(["합성 질문을 확인했어요."]);
    expect(ai.call).toHaveBeenCalledTimes(3);
  });
  it("고지 실패로 남은 AI 답은 고지 없는 즉시 안내에서 전하지 않는다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "카카오 실패로 남을 합성 질문");
    await consume(required(jobs[0]), ai, false);
    now = new Date(NOW.getTime() + 4000);
    const noCallback = createApp({
      connect: () => isolated.connect(),
      services: { now: () => now },
      logSink: () => {},
    });
    const response = await noCallback.request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: { utterance: "콜백 주소 없는 합성 질문", user: { id: user, type: "botUserKey" } },
          action: { id: "input", params: {} },
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("합성 질문을 확인했어요.");
    expect((await record(user))[0]).toMatchObject({ ai_disclosed_at: null, ai_disclosed_policy_version: null });
  });
  it("고지와 이전 안내 두 개가 출력 한도를 채우면 AI 답은 다음 대화에 남긴다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "이전 안내도 있는 합성 질문");
    const row = required(
      (
        await isolated.db.query(
          "SELECT id,customer_id FROM consultations WHERE id=(SELECT consultation_id FROM messages WHERE id=$1)",
          [required(jobs[0]).messageId],
        )
      ).rows[0],
    );
    for (const [i, text] of ["먼저 전할 합성 안내 하나", "먼저 전할 합성 안내 둘"].entries()) {
      const id = newUuid();
      await isolated.db.query(
        `INSERT INTO notifications (id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status,created_at) VALUES ($1,$2,$3,$4,'owner_reply',$5,'owner_reply',$6,'deferred',$7)`,
        [id, shop.shopId, row.customer_id, row.id, `notice:${id}`, text, new Date(NOW.getTime() + i)],
      );
    }
    const first = texts(await consume(required(jobs[0]), ai));
    expect(first).toHaveLength(3);
    expect(first[0]).toContain("AI가 상담합니다");
    expect(first.slice(1)).toEqual(["먼저 전할 합성 안내 하나", "먼저 전할 합성 안내 둘"]);
    expect(
      (
        await isolated.db.query("SELECT delivery,sent_at FROM messages WHERE consultation_id=$1 AND author='ai'", [
          row.id,
        ])
      ).rows,
    ).toEqual([{ delivery: "deferred", sent_at: null }]);
    now = new Date(NOW.getTime() + 4000);
    await send(user, "미전달 AI 답을 받을 합성 질문");
    const next = texts(await consume(required(jobs[1]), ai));
    expect(next).toEqual(["합성 질문을 확인했어요.", "합성 질문을 확인했어요."]);
  });

  it("고지 실패 뒤 스티커 응답도 고지·미전달 AI·뒤 안내 순서로 즉시 전한다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "스티커 전에 실패할 합성 질문");
    const firstJob = required(jobs[0]);
    await consume(firstJob, ai, false);
    const row = required(
      (
        await isolated.db.query(
          "SELECT id,customer_id FROM consultations WHERE id=(SELECT consultation_id FROM messages WHERE id=$1)",
          [firstJob.messageId],
        )
      ).rows[0],
    );
    const id = newUuid();
    await isolated.db.query(
      `INSERT INTO notifications (id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status,created_at) VALUES ($1,$2,$3,$4,'owner_reply',$5,'owner_reply','뒤에 온 합성 사장님 답','deferred',$6)`,
      [id, shop.shopId, row.customer_id, row.id, `notice:${id}`, new Date(NOW.getTime() + 2000)],
    );
    now = new Date(NOW.getTime() + 4000);
    const app = createApp({
      connect: () => isolated.connect(),
      services: { now: () => now, aiModel: model(), privacyPolicy: POLICY, publicAppOrigin: ORIGIN },
      logSink: () => {},
    });
    const response = await app.request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: { utterance: "", user: { id: user, type: "botUserKey" } },
          action: { id: "input", params: {} },
        }),
      },
      env,
    );
    const body = (await response.json()) as { template: { outputs: { simpleText: { text: string } }[] } };
    const out = body.template.outputs.map((x) => x.simpleText.text);
    expect(out[0]).toContain("AI가 상담합니다");
    expect(out.slice(1)).toEqual(["합성 질문을 확인했어요.", "뒤에 온 합성 사장님 답"]);
    expect((await record(user))[0]?.ai_disclosed_at).toEqual(now);
    now = new Date(NOW.getTime() + 8000);
    await send(user, "스티커 뒤 합성 질문");
    const next = texts(await consume(required(jobs[1]), ai));
    expect(next).not.toContain("뒤에 온 합성 사장님 답");
    expect(next.join(" ")).not.toContain("AI가 상담합니다");
  });
  it("게시된 정책이 없으면 모델 없이 바로 사장님 안내를 보낸다", async () => {
    await isolated.db.query("UPDATE privacy_policies SET published_at=$2 WHERE shop_id=$1", [
      shop.shopId,
      new Date(NOW.getTime() + 60000),
    ]);
    const ai = model();
    await send(newUuid(), "정책이 미래에 게시된 합성 질문");
    const callback = await consume(required(jobs[0]), ai);
    expect(ai.call).not.toHaveBeenCalled();
    expect(texts(callback)).toEqual(["사장님 확인 뒤 답드릴게요."]);
  });
  it("고지 완료는 실제 발신 성공 시각이고 고지 기록은 AI 생성보다 먼저 놓인다", async () => {
    const user = newUuid(),
      ai = model(),
      invoke = required(ai.call.getMockImplementation());
    ai.call.mockImplementationOnce(async (input) => {
      const answer = await invoke(input);
      now = new Date(NOW.getTime() + 5000);
      return answer;
    });
    await send(user, "시각을 확인할 합성 질문");
    await consume(required(jobs[0]), ai, true, POLICY, () => {
      now = new Date(NOW.getTime() + 10000);
    });
    expect((await record(user))[0]?.ai_disclosed_at).toEqual(new Date(NOW.getTime() + 11000));
    const rows = (
      await isolated.db.query<{ author: string; created_at: Date }>(
        "SELECT author,created_at FROM messages WHERE consultation_id=$1 AND direction='outbound' ORDER BY created_at,id",
        [required((await record(user))[0]).id],
      )
    ).rows;
    expect(rows[0]?.author).toBe("system");
    expect(required(rows[0]).created_at.getTime()).toBeLessThan(
      required(rows.find((x) => x.author === "ai")).created_at.getTime(),
    );
  });
  it("새 상담의 고지로 끝난 다른 상담의 고지 전 AI 답을 풀지 않는다", async () => {
    const user = newUuid(),
      ai = model(),
      invoke = required(ai.call.getMockImplementation());
    ai.call.mockImplementationOnce(async (input) => {
      const result = await invoke(input);
      if (!result.ok) throw new Error("합성 실패");
      return { ...result, output: { reply: "옛 상담에 남아야 할 합성 답" } };
    });
    await send(user, "이전 합성 상담");
    await consume(required(jobs[0]), ai, false);
    const first = required((await record(user))[0]);
    await isolated.db.query("UPDATE consultations SET status='ended',ended_at=$2 WHERE id=$1", [first.id, NOW]);
    now = new Date(NOW.getTime() + 4000);
    await send(user, "새 합성 상담");
    expect(texts(await consume(required(jobs[1]), ai))).not.toContain("옛 상담에 남아야 할 합성 답");
    expect((await record(user)).find((x) => x.id === first.id)?.ai_disclosed_at).toBeNull();
  });
  it("모델 대기 중 예약 링크가 사라지면 재시도 없이 즉시 사장님에게 넘긴다", async () => {
    const ai = model(),
      invoke = required(ai.call.getMockImplementation());
    ai.call.mockImplementationOnce(async (input) => {
      const answer = await invoke(input);
      await isolated.db.query("UPDATE shops SET booking_slug=NULL,booking_issued_at=NULL WHERE id=$1", [shop.shopId]);
      return answer;
    });
    await send(newUuid(), "링크가 사라질 합성 질문");
    expect(texts(await consume(required(jobs[0]), ai))).toEqual(["사장님 확인 뒤 답드릴게요."]);
  });

  it.each(["no_callback", "cost_limit", "queue_failure"])(
    "즉시 넘김 %s도 고지·이전 답 순서를 지키고 생략한 새 안내는 미전달로 남긴다",
    async (mode) => {
      const user = newUuid(),
        ai = model();
      await send(user, "즉시 넘김 전에 실패할 합성 질문");
      const job = required(jobs[0]);
      await consume(job, ai, false);
      const row = required(
        (
          await isolated.db.query(
            "SELECT id,customer_id FROM consultations WHERE id=(SELECT consultation_id FROM messages WHERE id=$1)",
            [job.messageId],
          )
        ).rows[0],
      );
      const id = newUuid();
      await isolated.db.query(
        `INSERT INTO notifications (id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status,created_at) VALUES ($1,$2,$3,$4,'owner_reply',$5,'owner_reply','뒤에 온 합성 안내','deferred',$6)`,
        [id, shop.shopId, row.customer_id, row.id, `notice:${id}`, new Date(NOW.getTime() + 2000)],
      );
      if (mode === "cost_limit")
        await isolated.db.query("UPDATE ai_calls SET cost_krw=1000 WHERE shop_id=$1 AND consultation_id=$2", [
          shop.shopId,
          row.id,
        ]);
      now = new Date(NOW.getTime() + 4000);
      const app = createApp({
        connect: () => isolated.connect(),
        services: {
          now: () => now,
          aiModel: model(),
          privacyPolicy: POLICY,
          publicAppOrigin: ORIGIN,
          ...(mode === "queue_failure"
            ? {
                kakaoCallbackQueue: {
                  send: async () => {
                    throw new Error("합성 큐 실패");
                  },
                },
              }
            : {}),
        },
        logSink: () => {},
      });
      const response = await app.request(
        "/api/kakao/skills/message",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: "즉시 넘김 합성 질문",
              ...(mode === "no_callback"
                ? {}
                : { callbackUrl: "https://bot-api.kakao.com/v1/callback/synthetic_inline" }),
              user: { id: user, type: "botUserKey" },
            },
            action: { id: "input", params: {} },
          }),
        },
        env,
      );
      const body = (await response.json()) as { template: { outputs: { simpleText: { text: string } }[] } };
      const out = body.template.outputs.map((x) => x.simpleText.text);
      expect(out[0]).toContain("AI가 상담합니다");
      expect(out.slice(1)).toEqual(["합성 질문을 확인했어요.", "뒤에 온 합성 안내"]);
      expect(
        (
          await isolated.db.query(
            "SELECT delivery,sent_at FROM messages WHERE consultation_id=$1 AND body_masked='사장님 확인 뒤 답드릴게요.'",
            [row.id],
          )
        ).rows,
      ).toEqual([{ delivery: "deferred", sent_at: null }]);
    },
  );
});
