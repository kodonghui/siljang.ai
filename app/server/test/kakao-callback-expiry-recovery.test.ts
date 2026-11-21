import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { RequestDb } from "../src/db";
import { SKILL_CALLBACK_MS } from "../src/kakao-callback";
import type { KakaoCallbackJob, KakaoCallbackQueue } from "../src/kakao-callback-store";
import { KAKAO_HANDOFF_TEXT } from "../src/kakao-reply";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { runScheduled } from "../src/scheduled";
import { Secret } from "../src/settings";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel } from "./support/shops";

const NOW = new Date("2026-11-22T10:00:00+09:00");
const EXPIRED = new Date(NOW.getTime() + SKILL_CALLBACK_MS + 3000);
const PRIVATE_FAILURE = "합성 내부 알림 저장 상세";

describeDb("유실된 카카오 큐 작업의 자동 만료 복구(TASK-028)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });

  beforeEach(async () => {
    isolated = await isolatedTestDb();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await isolated?.close();
  });

  function connection(failShop?: string): RequestDb {
    const conn = isolated.connect();
    return {
      query: conn.query.bind(conn),
      abort: conn.abort.bind(conn),
      close: conn.close.bind(conn),
      transaction: (work) =>
        conn.transaction((tx) =>
          work({
            query: (sql, params) => {
              if (failShop !== undefined && /INSERT INTO owner_alerts/.test(sql) && params?.[0] === failShop)
                throw new Error(PRIVATE_FAILURE);
              return tx.query(sql, params);
            },
          }),
        ),
    };
  }

  async function pending(label = "만료 복구 시험 가게", receivedAt = NOW) {
    const shop = await createShop(isolated.db, label);
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    const jobs: KakaoCallbackJob[] = [];
    const queue: KakaoCallbackQueue = {
      send: async (job) => {
        jobs.push(job);
        throw new Error("합성 큐 유실");
      },
    };
    const app = createApp({
      connect: () => connection(shop.shopId),
      logSink: () => {},
      services: { now: () => receivedAt, kakaoCallbackQueue: queue },
    });
    const response = await app.request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: {
            utterance: "합성 만료 질문",
            callbackUrl: "https://bot-api.kakao.com/v1/callback/synthetic_expiry_recovery",
            block: { id: "expiry" },
            user: { id: newUuid(), type: "botUserKey" },
          },
          action: { id: "expiry", params: {} },
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe("server_error");
    const job = jobs[0];
    if (job === undefined) throw new Error("시험 큐 작업 없음");
    const source = (
      await isolated.db.query<{ consultation_id: string; kakao_callback_enc: string | null }>(
        "SELECT consultation_id, kakao_callback_enc FROM messages WHERE shop_id = $1 AND id = $2",
        [job.shopId, job.messageId],
      )
    ).rows[0];
    if (source === undefined || source.kakao_callback_enc === null) throw new Error("시험 봉투 보존 실패");
    return { shop, job, consultationId: source.consultation_id };
  }

  async function cron(failShop?: string) {
    const logs = collectLogs();
    const result = await runScheduled({ scheduledTime: EXPIRED.getTime(), cron: "* * * * *" }, env, {
      connect: () => connection(failShop),
      jobs: [],
      logSink: logs.sink,
    });
    return { result, logs };
  }

  async function envelope(job: KakaoCallbackJob) {
    return (
      await isolated.db.query<{ kakao_callback_enc: string | null }>(
        "SELECT kakao_callback_enc FROM messages WHERE shop_id = $1 AND id = $2",
        [job.shopId, job.messageId],
      )
    ).rows[0]?.kakao_callback_enc;
  }

  async function records(job: KakaoCallbackJob) {
    return (
      await isolated.db.query(
        `SELECT h.reason, c.status, t.wait_status, a.status AS alert_status, a.sent_at,
      o.delivery, o.body_masked FROM messages i JOIN consultations c ON c.id = i.consultation_id
      JOIN handoffs h ON h.source_message_id = i.id JOIN owner_tasks t ON t.handoff_id = h.id
      JOIN owner_alerts a ON a.owner_task_id = t.id
      JOIN messages o ON o.consultation_id = c.id AND o.direction = 'outbound'
      WHERE i.shop_id = $1 AND i.id = $2`,
        [job.shopId, job.messageId],
      )
    ).rows;
  }

  it("큐가 도착하지 않아도 1분 실행이 질문/할 일/대기 알림/미전달 답을 한 번 복구함", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("복구에서 외부 호출 금지"));
    const target = await pending();
    const first = await cron();
    expect(first.result).toEqual({ jobs: {}, stoppedByBudget: false, dailyStarted: [] });
    expect(await envelope(target.job)).toBeNull();
    expect(await records(target.job)).toEqual([
      {
        reason: "callback_timeout",
        status: "awaiting_owner",
        wait_status: "waiting",
        alert_status: "pending",
        sent_at: null,
        delivery: "deferred",
        body_masked: KAKAO_HANDOFF_TEXT,
      },
    ]);
    await cron();
    expect(await records(target.job)).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("한 가게 저장 실패는 봉투를 보존하고 다른 가게 복구를 막지 않음", async () => {
    const blocked = await pending("먼저 실패하는 가게");
    const other = await pending("다음에 복구할 가게", new Date(NOW.getTime() + 1000));
    const first = await cron(blocked.shop.shopId);
    expect(await envelope(blocked.job)).not.toBeNull();
    expect(await envelope(other.job)).toBeNull();
    expect(await records(blocked.job)).toEqual([]);
    expect(await records(other.job)).toHaveLength(1);
    expect(first.logs.lines.join("\n")).not.toContain(PRIVATE_FAILURE);
    expect(first.logs.lines.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: "job_run_failed", job: "kakao_callback_recovery" })]),
    );
    await cron();
    expect(await records(blocked.job)).toHaveLength(1);
    expect(await records(other.job)).toHaveLength(1);
  });

  it("끝난 상담은 만료 봉투만 지우고 질문/답을 만들거나 상담을 다시 열지 않음", async () => {
    const target = await pending();
    await isolated.db.query("UPDATE consultations SET status = 'ended', ended_at = $3 WHERE shop_id = $1 AND id = $2", [
      target.job.shopId,
      target.consultationId,
      NOW,
    ]);
    await cron();
    expect(await envelope(target.job)).toBeNull();
    expect(await records(target.job)).toEqual([]);
    expect(
      (
        await isolated.db.query("SELECT status FROM consultations WHERE shop_id = $1 AND id = $2", [
          target.job.shopId,
          target.consultationId,
        ])
      ).rows,
    ).toEqual([{ status: "ended" }]);
    expect(
      (
        await isolated.db.query(
          "SELECT id FROM messages WHERE shop_id = $1 AND consultation_id = $2 AND direction = 'outbound'",
          [target.job.shopId, target.consultationId],
        )
      ).rowCount,
    ).toBe(0);
  });
});
