import { afterAll, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { type DbConnector, pgConnector, type RequestDb } from "../src/db";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob } from "../src/kakao-callback-store";
import { replyWithDeferredKakaoMessages } from "../src/kakao-deferred";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-21T12:00:00Z");
const OLD_TEXT = "앞서 전하지 못한 합성 안내";

async function template(response: Response) {
  const body = await response.json();
  expectSchema("SkillTemplateResponse", body);
  return body as { template: { outputs: { simpleText?: { text: string } }[] } };
}

describeDb("카카오 콜백에서 전하지 못한 답의 다음 대화 전달(TASK-028, G4)", () => {
  const db = testDb();
  afterAll(async () => {
    await db.close();
  });

  async function setup() {
    const shop = await createShop(db, "미전달 답 시험 가게");
    await issueTestBookingLink(db, shop);
    await linkTestChannel(db, shop.channelId);
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    const logs = collectLogs();
    const clock = { now: NOW };
    const jobs: KakaoCallbackJob[] = [];
    const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
    const app = createApp({
      services: {
        now: () => clock.now,
        kakaoCallbackQueue: {
          send: async (job) => {
            jobs.push(job);
          },
        },
      },
      logSink: logs.sink,
    });
    const call = (utterance: string, callbackUrl?: string, userId = shop.userKey) =>
      app.request(
        "/api/kakao/skills/message",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance,
              ...(callbackUrl === undefined ? {} : { callbackUrl }),
              block: { id: "conversation" },
              user: { id: userId, type: "botUserKey" },
            },
            action: { id: "synthetic-action", params: {} },
          }),
        },
        env,
      );
    return { shop, call, logs, clock, jobs, env };
  }

  async function defer(shop: ShopFixture, text = OLD_TEXT, at = new Date(NOW.getTime() - 60_000)) {
    const id = newUuid();
    await db.query(
      `INSERT INTO messages (id, shop_id, consultation_id, direction, author, kind, body_masked, delivery, created_at)
      VALUES ($1, $2, $3, 'outbound', 'system', 'text', $4, 'deferred', $5)`,
      [id, shop.shopId, shop.consultationId, text, at],
    );
    return id;
  }

  async function notice(
    shop: ShopFixture,
    body = OLD_TEXT,
    options: { kind?: string; status?: string; at?: Date } = {},
  ) {
    const id = newUuid();
    await db.query(
      `INSERT INTO notifications (id, shop_id, customer_id, consultation_id, kind, event_key, template_key, body, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $5, $7, $8, $9)`,
      [
        id,
        shop.shopId,
        shop.customerId,
        shop.consultationId,
        options.kind ?? "owner_reply",
        `notice:${id}:${options.kind ?? "owner_reply"}`,
        body,
        options.status ?? "deferred",
        options.at ?? new Date(NOW.getTime() - 60_000),
      ],
    );
    return id;
  }

  async function noticeState(id: string) {
    return (
      await db.query<{ status: string; sent_at: Date | null }>(
        "SELECT status, sent_at FROM notifications WHERE id = $1",
        [id],
      )
    ).rows[0];
  }

  it("미전달 일반 안내를 같은 손님의 다음 응답에서 먼저 전하고 한 번만 표시함", async () => {
    const h = await setup();
    const other = await setup();
    const id = await notice(h.shop);
    const otherId = await notice(other.shop, "다른 가게 비공개 안내");
    const response = await template(await h.call("일반 안내 뒤 질문"));
    expect(response.template.outputs[0]).toEqual({ simpleText: { text: OLD_TEXT } });
    expect(JSON.stringify(response)).not.toContain("다른 가게 비공개 안내");
    expect(await noticeState(id)).toEqual({ status: "delivered_on_reply", sent_at: NOW });
    expect(await noticeState(otherId)).toEqual({ status: "deferred", sent_at: null });
    const next = await template(await h.call("다른 일반 안내 질문"));
    expect(JSON.stringify(next)).not.toContain(OLD_TEXT);
  });

  it("같은 가게라도 다른 손님의 미전달 안내는 읽거나 바꾸지 않음", async () => {
    const h = await setup();
    const id = await notice(h.shop);
    const response = await template(await h.call("다른 손님 질문", undefined, newUuid()));
    expect(JSON.stringify(response)).not.toContain(OLD_TEXT);
    expect(await noticeState(id)).toEqual({ status: "deferred", sent_at: null });
  });

  it.each(["owner_reply", "delay_notice", "custom_rejected", "no_answer_closed"])(
    "정해진 일반 글 %s를 전함",
    async (kind) => {
      const h = await setup();
      const id = await notice(h.shop, `합성 ${kind} 안내`, { kind });
      expect((await template(await h.call(`합성 ${kind} 질문`))).template.outputs[0]).toEqual({
        simpleText: { text: `합성 ${kind} 안내` },
      });
      expect((await noticeState(id))?.status).toBe("delivered_on_reply");
    },
  );

  it("버튼/계좌가 필요한 안내와 미전달이 아닌 행은 업무 렌더러에 남김", async () => {
    const h = await setup();
    const ids = await Promise.all([
      notice(h.shop, "미전달 결제 안내", { kind: "payment_request" }),
      notice(h.shop, "미전달 후기 안내", { kind: "review_request" }),
      notice(h.shop, "대기 중인 일반 안내", { status: "pending" }),
      notice(h.shop, "버린 일반 안내", { status: "dropped" }),
    ]);
    const response = await template(await h.call("업무 안내 구분 질문"));
    for (const word of ["미전달 결제", "미전달 후기", "대기 중인 일반", "버린 일반"])
      expect(JSON.stringify(response)).not.toContain(word);
    expect(await Promise.all(ids.map(noticeState))).toEqual([
      { status: "deferred", sent_at: null },
      { status: "deferred", sent_at: null },
      { status: "pending", sent_at: null },
      { status: "dropped", sent_at: null },
    ]);
  });

  it("긴 일반 안내를 유니코드 글자 기준 두 출력으로 전부 전하고 현재 답 자리를 남김", async () => {
    const h = await setup();
    const text = `${"가".repeat(999)}🎂${"나".repeat(1000)}`;
    const id = await notice(h.shop, text);
    const response = await template(await h.call("긴 안내 질문"));
    const texts = response.template.outputs.map((o) => o.simpleText?.text ?? "");
    expect(texts).toHaveLength(3);
    expect([...(texts[0] ?? "")]).toHaveLength(1000);
    expect([...(texts[1] ?? "")]).toHaveLength(1000);
    expect(texts.slice(0, 2).join("")).toBe(text);
    expect((await noticeState(id))?.status).toBe("delivered_on_reply");
  });

  it("이전 콜백 답과 일반 안내를 만든 순서로 합치고 자리가 모자란 긴 안내는 다음에 전함", async () => {
    const h = await setup();
    await defer(h.shop, "먼저 만든 콜백 답", new Date(NOW.getTime() - 120_000));
    const id = await notice(h.shop, "나".repeat(1500));
    const first = await template(await h.call("혼합 첫 질문"));
    expect(first.template.outputs[0]).toEqual({ simpleText: { text: "먼저 만든 콜백 답" } });
    expect(JSON.stringify(first)).not.toContain("나".repeat(100));
    expect((await noticeState(id))?.status).toBe("deferred");
    const second = await template(await h.call("혼합 둘째 질문"));
    expect(
      second.template.outputs
        .slice(0, 2)
        .map((o) => o.simpleText?.text)
        .join(""),
    ).toBe("나".repeat(1500));
    expect((await noticeState(id))?.status).toBe("delivered_on_reply");
  });

  it("일반 안내의 같은 손님 동시 요청에서도 한 번만 전함", async () => {
    const h = await setup();
    const id = await notice(h.shop);
    const responses = await Promise.all([h.call("안내 동시 가"), h.call("안내 동시 나")]);
    const bodies = await Promise.all(responses.map(template));
    expect(bodies.flatMap((b) => b.template.outputs).filter((o) => o.simpleText?.text === OLD_TEXT)).toHaveLength(1);
    expect((await noticeState(id))?.status).toBe("delivered_on_reply");
  });

  it("일반 안내가 있는 중복 수신은 빈 응답으로 다음 안내를 소비하지 않음", async () => {
    const h = await setup();
    await h.call("안내 중복 질문");
    const id = await notice(h.shop);
    const duplicate = await h.call("안내 중복 질문");
    expect(duplicate.headers.get("Siljang-Outcome")).toBe("duplicate");
    expect(await duplicate.json()).toEqual({ version: "2.0", template: { outputs: [] } });
    expect((await noticeState(id))?.status).toBe("deferred");
  });

  it("일반 안내의 콜백이 실패하면 전달 표시 없이 다음 대화까지 보존함", async () => {
    const h = await setup();
    const id = await notice(h.shop);
    await h.call("일반 안내 콜백 실패", "https://bot-api.kakao.com/v1/callback/synthetic_notice_failure");
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    expect(
      await consumeKakaoCallback(h.jobs[0], h.env, { now: () => new Date(NOW.getTime() + 5000), fetch: send }),
    ).toBe("done");
    expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body)).template.outputs[0]).toEqual({
      simpleText: { text: OLD_TEXT },
    });
    expect(await noticeState(id)).toEqual({ status: "deferred", sent_at: null });
    h.clock.now = new Date(NOW.getTime() + 10_000);
    expect((await template(await h.call("일반 안내 실패 뒤 질문"))).template.outputs[0]).toEqual({
      simpleText: { text: OLD_TEXT },
    });
    expect((await noticeState(id))?.status).toBe("delivered_on_reply");
  });

  it("일반 안내 응답 생성이 실패하면 전달 표시는 되돌림", async () => {
    const h = await setup();
    const id = await notice(h.shop);
    const scoped = shopRequestDb(createShopScope(h.shop.shopId, { kind: "job", job: "kakao_callback" }), db);
    await expect(
      replyWithDeferredKakaoMessages(scoped, h.shop.customerId, NOW, () => {
        throw new Error("synthetic notice render failure");
      }),
    ).rejects.toThrow("synthetic notice render failure");
    expect(await noticeState(id)).toEqual({ status: "deferred", sent_at: null });
  });

  it("전하지 못한 자기 답을 새 응답보다 먼저 보이고 전달 시각을 한 번 남김", async () => {
    const h = await setup();
    const other = await setup();
    const id = await defer(h.shop);
    const otherId = await defer(other.shop, "다른 가게의 합성 안내");
    const response = await h.call("다음 질문");
    expect(response.status).toBe(200);
    const body = await template(response);
    expect(body.template.outputs[0]).toEqual({ simpleText: { text: OLD_TEXT } });
    expect(JSON.stringify(body)).not.toContain("다른 가게의 합성 안내");
    const saved = await db.query<{ delivery: string; sent_at: Date | null }>(
      "SELECT delivery, sent_at FROM messages WHERE id=$1",
      [id],
    );
    expect(saved.rows).toEqual([{ delivery: "delivered_later", sent_at: NOW }]);
    const untouched = await db.query<{ delivery: string }>("SELECT delivery FROM messages WHERE id=$1", [otherId]);
    expect(untouched.rows).toEqual([{ delivery: "deferred" }]);
    expect(h.logs.lines.join("\n")).not.toContain(OLD_TEXT);
  });

  it("다음 답이 콜백이면 이전 미전달 답부터 보내고 성공 뒤에만 전달 표시함", async () => {
    const h = await setup();
    const id = await defer(h.shop);
    const ack = await h.call("콜백으로 다음 질문", "https://bot-api.kakao.com/v1/callback/synthetic_next");
    expect(ack.headers.get("Siljang-Outcome")).toBe("callback_pending");
    expectSchema("SkillCallbackAck", await ack.json());
    const send = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
    const now = new Date(NOW.getTime() + 5000);
    expect(await consumeKakaoCallback(h.jobs[0], h.env, { now: () => now, fetch: send })).toBe("done");
    const request = send.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs[0]).toEqual({ simpleText: { text: OLD_TEXT } });
    const saved = await db.query<{ delivery: string; sent_at: Date | null }>(
      "SELECT delivery, sent_at FROM messages WHERE id=$1",
      [id],
    );
    expect(saved.rows).toEqual([{ delivery: "delivered_later", sent_at: now }]);
  });

  it("같은 손님의 다른 콜백도 진행 중인 전달을 기다려 이전 답을 중복 발신하지 않음", async () => {
    const h = await setup();
    await defer(h.shop);
    await h.call("첫 콜백 질문", "https://bot-api.kakao.com/v1/callback/synthetic_first");
    await h.call("다음 콜백 질문", "https://bot-api.kakao.com/v1/callback/synthetic_second");
    let entered: () => void = () => {};
    let release: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("synthetic_first")) {
        entered();
        await blocked;
      }
      return Response.json({ status: "SUCCESS" });
    });
    const options = { now: () => new Date(NOW.getTime() + 5000), fetch: send };
    const first = consumeKakaoCallback(h.jobs[0], h.env, options);
    try {
      await Promise.race([started, first]);
      expect(send).toHaveBeenCalledTimes(1);
      expect(await consumeKakaoCallback(h.jobs[1], h.env, options)).toBe("retry");
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await first;
    }
    expect(await consumeKakaoCallback(h.jobs[1], h.env, options)).toBe("done");
    const texts = send.mock.calls.flatMap(([, init]) => {
      const body = JSON.parse(String(init?.body));
      return body.template.outputs.map((o: { simpleText: { text: string } }) => o.simpleText.text);
    });
    expect(texts.filter((text) => text === OLD_TEXT)).toHaveLength(1);
  });

  it("같은 손님의 서로 다른 동시 요청에서도 이전 답은 한 번만 전함", async () => {
    const h = await setup();
    await defer(h.shop);
    const responses = await Promise.all([h.call("다음 질문 가"), h.call("다음 질문 나")]);
    const bodies = await Promise.all(responses.map(template));
    expect(bodies.flatMap((b) => b.template.outputs).filter((o) => o.simpleText?.text === OLD_TEXT)).toHaveLength(1);
  });
  it("콜백 발신이 두 번 실패해도 이전 답을 보존하고 다음 즉시 응답에서 먼저 전함", async () => {
    const h = await setup();
    const id = await defer(h.shop);
    await h.call("콜백 실패 질문", "https://bot-api.kakao.com/v1/callback/synthetic_failure");
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    expect(
      await consumeKakaoCallback(h.jobs[0], h.env, {
        now: () => new Date(NOW.getTime() + 5000),
        fetch: send,
      }),
    ).toBe("done");
    expect(send).toHaveBeenCalledTimes(2);
    const before = await db.query<{ delivery: string; sent_at: null }>(
      "SELECT delivery, sent_at FROM messages WHERE id=$1",
      [id],
    );
    expect(before.rows).toEqual([{ delivery: "deferred", sent_at: null }]);
    h.clock.now = new Date(NOW.getTime() + 10_000);
    const reply = await template(await h.call("실패 뒤 다음 질문"));
    expect(reply.template.outputs[0]).toEqual({ simpleText: { text: OLD_TEXT } });
    const after = await db.query<{ delivery: string }>("SELECT delivery FROM messages WHERE id=$1", [id]);
    expect(after.rows).toEqual([{ delivery: "delivered_later" }]);
  });

  it("같은 가게의 다른 손님 콜백은 진행 중인 손님을 기다리지 않음", async () => {
    const h = await setup();
    await defer(h.shop);
    await h.call("먼저 답하는 손님", "https://bot-api.kakao.com/v1/callback/synthetic_blocked");
    await h.call("다른 손님", "https://bot-api.kakao.com/v1/callback/synthetic_independent", newUuid());
    let entered: () => void = () => {};
    let release: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("synthetic_blocked")) {
        entered();
        await blocked;
      }
      return Response.json({ status: "SUCCESS" });
    });
    const options = { now: () => new Date(NOW.getTime() + 5000), fetch: send };
    const first = consumeKakaoCallback(h.jobs[0], h.env, options);
    try {
      await Promise.race([started, first]);
      expect(await consumeKakaoCallback(h.jobs[1], h.env, options)).toBe("done");
      expect(send).toHaveBeenCalledTimes(2);
      const secondBody = JSON.parse(String(send.mock.calls[1]?.[1]?.body));
      expect(JSON.stringify(secondBody)).not.toContain(OLD_TEXT);
    } finally {
      release();
      await first;
    }
  });

  it("이전 답 조회 예외 뒤 선점을 해제해 같은 큐 메시지가 기한 안에 다시 처리됨", async () => {
    const h = await setup();
    await defer(h.shop);
    await h.call("조회 실패 질문", "https://bot-api.kakao.com/v1/callback/synthetic_retry");
    let fail = true;
    const connect: DbConnector = (url) => {
      const conn = pgConnector(url);
      const query: RequestDb["query"] = async <R>(sql: string, params?: readonly unknown[]) => {
        if (fail && sql.includes("SELECT m.id, m.body_masked")) {
          fail = false;
          throw new Error("synthetic deferred read failure");
        }
        return conn.query<R>(sql, params);
      };
      const transaction: RequestDb["transaction"] = (fn) => conn.transaction(fn);
      return { query, transaction, abort: () => conn.abort(), close: () => conn.close() };
    };
    const send = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
    await expect(
      consumeKakaoCallback(h.jobs[0], h.env, {
        connect,
        now: () => new Date(NOW.getTime() + 5000),
        fetch: send,
      }),
    ).rejects.toThrow("synthetic deferred read failure");
    expect(send).not.toHaveBeenCalled();
    const saved = await db.query<{ kakao_callback_claim_until: Date | null }>(
      "SELECT kakao_callback_claim_until FROM messages WHERE id=$1",
      [h.jobs[0]?.messageId],
    );
    expect(saved.rows).toEqual([{ kakao_callback_claim_until: null }]);
    expect(
      await consumeKakaoCallback(h.jobs[0], h.env, {
        now: () => new Date(NOW.getTime() + 6000),
        fetch: send,
      }),
    ).toBe("done");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("콜백이 이전 답을 전하는 동안 즉시 응답이 그 답을 먼저 소비하지 않음", async () => {
    const h = await setup();
    const id = await defer(h.shop);
    await h.call("진행 중인 질문", "https://bot-api.kakao.com/v1/callback/synthetic_active");
    let entered: () => void = () => {};
    let release: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn<typeof fetch>(async () => {
      entered();
      await blocked;
      return Response.json({ status: "SUCCESS" });
    });
    const first = consumeKakaoCallback(h.jobs[0], h.env, {
      now: () => new Date(NOW.getTime() + 5000),
      fetch: send,
    });
    try {
      await Promise.race([started, first]);
      const reply = await template(await h.call("기다리는 중 새 메시지"));
      expect(JSON.stringify(reply)).not.toContain(OLD_TEXT);
      expect((await db.query<{ delivery: string }>("SELECT delivery FROM messages WHERE id=$1", [id])).rows).toEqual([
        { delivery: "deferred" },
      ]);
    } finally {
      release();
      await first;
    }
    expect((await db.query<{ delivery: string }>("SELECT delivery FROM messages WHERE id=$1", [id])).rows).toEqual([
      { delivery: "delivered_later" },
    ]);
  });

  it("이전 답 두 개만 먼저 보내고 남은 답과 중복 요청의 빈 응답을 보존함", async () => {
    const h = await setup();
    for (let i = 0; i < 3; i++) await defer(h.shop, `이전 안내 ${i}`, new Date(NOW.getTime() - 60_000 + i * 1000));
    const first = await template(await h.call("첫 새 질문"));
    expect(first.template.outputs).toHaveLength(3);
    expect(first.template.outputs.slice(0, 2)).toEqual([
      { simpleText: { text: "이전 안내 0" } },
      { simpleText: { text: "이전 안내 1" } },
    ]);
    const duplicate = await h.call("첫 새 질문");
    expect(duplicate.headers.get("Siljang-Outcome")).toBe("duplicate");
    const duplicateBody = (await duplicate.json()) as { template: { outputs: unknown[] } };
    expectSchema("SkillNoOutput", duplicateBody);
    expect(duplicateBody.template.outputs).toEqual([]);
    expect(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::integer count FROM messages WHERE shop_id=$1 AND delivery='deferred'",
          [h.shop.shopId],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
    const next = await template(await h.call("다른 새 질문"));
    expect(next.template.outputs[0]).toEqual({ simpleText: { text: "이전 안내 2" } });
  });

  it("지난 상담의 이전 답도 같은 손님에게만 전하고 끝난 상담은 다시 열지 않음", async () => {
    const h = await setup();
    const oldId = newUuid();
    await db.query(
      `INSERT INTO consultations (id, shop_id, customer_id, status, opened_at, ended_at)
      VALUES ($1, $2, $3, 'ended', $4, $5)`,
      [oldId, h.shop.shopId, h.shop.customerId, new Date(NOW.getTime() - 86400000), new Date(NOW.getTime() - 120_000)],
    );
    await defer({ ...h.shop, consultationId: oldId });
    expect((await template(await h.call("지난 상담 뒤 질문"))).template.outputs[0]).toEqual({
      simpleText: { text: OLD_TEXT },
    });
    expect((await db.query<{ status: string }>("SELECT status FROM consultations WHERE id=$1", [oldId])).rows).toEqual([
      { status: "ended" },
    ]);
  });

  it("응답 생성이 실패하면 이전 답을 전달했다고 기록하지 않음", async () => {
    const h = await setup();
    const id = await defer(h.shop);
    const scoped = shopRequestDb(createShopScope(h.shop.shopId, { kind: "job", job: "kakao_callback" }), db);
    await expect(
      replyWithDeferredKakaoMessages(scoped, h.shop.customerId, NOW, () => {
        throw new Error("synthetic response construction failure");
      }),
    ).rejects.toThrow("synthetic response construction failure");
    expect(
      (
        await db.query<{ delivery: string; sent_at: Date | null }>(
          "SELECT delivery, sent_at FROM messages WHERE id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ delivery: "deferred", sent_at: null }]);
  });
});
