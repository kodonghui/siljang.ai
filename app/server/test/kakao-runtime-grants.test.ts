import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createAiModel } from "../src/ai-model";
import { createApp } from "../src/app";
import { pgConnector, type RequestDb } from "../src/db";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { createCustomOrderTask, ownerProductionOrder, writeOrderLedgerData } from "../src/order-output";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { anthropicStream, sseResponse } from "./support/ai-mock";
import { collectLogs, describeDb, newUuid, TEST_DATABASE_URL, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const grants = readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8");

describeDb("스테이징 권한 파일로 제한한 카카오 실패 처리(TASK-028)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  let db: RequestDb;
  let shop: ShopFixture;
  let databaseUrl: string;
  const role = `task028_${newUuid().replaceAll("-", "")}`;

  beforeAll(async () => {
    isolated = await isolatedTestDb();
    db = isolated.db;
    await db.query(`CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await db.query(grants.replaceAll(':"runtime_role"', `"${role}"`));
    const { rows } = await db.query<{ name: string }>("SELECT current_database() AS name");
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${rows[0]?.name}`;
    url.username = role;
    url.password = "";
    databaseUrl = url.toString();
    shop = await createShop(db, "제한 역할의 실패 안내 시험 가게");
    await issueTestBookingLink(db, shop);
    await linkTestChannel(db, shop.channelId);
  }, 30_000);

  afterAll(async () => {
    await isolated?.close();
    const admin = testDb();
    try {
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.close();
    }
  });

  it("제한 역할에서도 요약·장부는 알레르기를 빼고 사장님 제작 자료만 포함한다", async () => {
    const target = await createShop(db, "제한 역할 출력 가게");
    await issueTestBookingLink(db, target);
    await db.query("UPDATE orders SET kind='custom',status='requested' WHERE id=$1", [target.orderId]);
    await db.query(
      "UPDATE order_details SET allergy_consent='agreed',allergy_consent_version='allergy-v1',allergy_answer='땅콩' WHERE order_id=$1",
      [target.orderId],
    );
    const runtime = pgConnector(new Secret(databaseUrl));
    try {
      const scoped = shopRequestDb(createShopScope(target.shopId, { kind: "owner", ownerId: target.ownerId }), runtime);
      const task = await createCustomOrderTask(scoped, target.orderId, new Date("2026-11-24T00:00:00Z"));
      const write = vi.fn(async (_row: Readonly<Record<string, unknown>>) => {});
      await writeOrderLedgerData(scoped, target.orderId, write);
      expect(write).toHaveBeenCalledOnce();
      expect(JSON.stringify(write.mock.calls)).not.toContain("땅콩");
      expect(await ownerProductionOrder(scoped, target.orderId)).toMatchObject({ allergyAnswer: "땅콩" });
      const rows = (await db.query("SELECT detail FROM owner_tasks WHERE id=$1", [task.id])).rows;
      expect(JSON.stringify(rows)).not.toContain("땅콩");
    } finally {
      await runtime.close();
    }
  });

  it.each([false, true])("제한 역할에서 모델/초안과 서버 검증 거절(%s)까지 실행", async (reject) => {
    const at = new Date("2026-11-22T08:00:00Z");
    const target = await createShop(db, "제한 역할 모델 시험");
    await issueTestBookingLink(db, target);
    await linkTestChannel(db, target.channelId);
    const jobs: KakaoCallbackJob[] = [];
    const env = testEnv({ DATABASE_URL: databaseUrl, FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), target.channelId, 1);
    const response = await createApp({
      services: {
        now: () => at,
        kakaoCallbackQueue: {
          send: async (job) => {
            jobs.push(job);
          },
        },
      },
      logSink: () => {},
    }).request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: target.botId },
          userRequest: {
            utterance: "문구를 정해 주세요",
            callbackUrl: "https://bot-api.kakao.com/v1/callback/fake_role_callback",
            block: { id: "permissions" },
            user: { id: newUuid(), type: "botUserKey" },
          },
          action: { id: "permissions", params: {} },
        }),
      },
      env,
    );
    expect(response.headers.get("Siljang-Outcome")).toBe("callback_pending");
    const job = jobs[0];
    if (job === undefined) throw new Error("큐 작업 없음");
    const source = await db.query<{ consultation_id: string }>("SELECT consultation_id FROM messages WHERE id=$1", [
      job.messageId,
    ]);
    const consultationId = source.rows[0]?.consultation_id;
    await db.query("UPDATE consultations SET ai_disclosed_at=$2, ai_disclosed_policy_version=1 WHERE id=$1", [
      consultationId,
      at,
    ]);
    const output = {
      reply: reject ? "총 50,000원이에요." : "문구를 기록했어요.",
      draft_patch: { lettering: "제한 역할 문구" },
    };
    const vendor = vi.fn<typeof fetch>(async () =>
      sseResponse(
        anthropicStream("claude-haiku-5-5", JSON.stringify(output), {
          input: 1000,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
        }),
      ),
    );
    const model = createAiModel(
      "development",
      {
        provider: "anthropic",
        model: "claude-haiku-5-5",
        effort: null,
        fx: { rate: "1450.00", date: "2026-11-14" },
        apiKey: new Secret("fake-provider-key"),
      },
      { fetch: vendor, now: () => at },
    );
    const options = {
      now: () => new Date(at.getTime() + 5000),
      fetch: async () => Response.json({ status: "SUCCESS" }),
      services: { aiModel: model },
      logSink: () => {},
    };
    expect(await consumeKakaoCallback(job, env, options)).toBe("done");
    expect(await consumeKakaoCallback(job, env, options)).toBe("done");
    expect(vendor).toHaveBeenCalledTimes(1);
    expect(
      (await db.query("SELECT result, fallback_reason FROM ai_calls WHERE consultation_id=$1", [consultationId])).rows,
    ).toEqual([{ result: "success", fallback_reason: reject ? "schema_invalid" : null }]);
    const drafts = await db.query("SELECT lettering, revision FROM order_drafts WHERE consultation_id=$1", [
      consultationId,
    ]);
    expect(drafts.rows).toEqual(reject ? [] : [{ lettering: "제한 역할 문구", revision: 1 }]);
  });

  it("제한 역할의 API-072도 같은 후기 세 번을 한 버전만 저장하고 본문 수정/삭제는 못 함", async () => {
    const target = await createShop(db, "제한 역할의 후기 시험");
    await issueTestBookingLink(db, target);
    await linkTestChannel(db, target.channelId);
    const now = new Date("2026-11-22T03:00:00Z");
    const payment = newUuid();
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='paid', arrived_amount=amount, arrived_at=$2, paid_at=$2 WHERE id=$1",
        [target.paymentRequestId, now],
      );
      await tx.query(
        "INSERT INTO payments (id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES ($1,$2,$3,$4,35000,$5)",
        [payment, target.shopId, target.orderId, target.paymentRequestId, now],
      );
      await tx.query(
        "UPDATE orders SET status='received',confirmed_at=$2,confirmed_payment_id=$3,finished_at=$2 WHERE id=$1",
        [target.orderId, now, payment],
      );
      await tx.query(
        "INSERT INTO productions (shop_id,order_id,completed_at,handed_over_at,handover_kind) VALUES ($1,$2,$3,$3,'pickup')",
        [target.shopId, target.orderId, now],
      );
    });
    const order = (await db.query<{ order_no: string }>("SELECT order_no FROM orders WHERE id=$1", [target.orderId]))
      .rows[0];
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), target.channelId, 1);
    const app = createApp({ services: { now: () => now }, logSink: () => {} });
    const send = () =>
      app.request(
        "/api/kakao/skills/review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: target.botId },
            userRequest: {
              utterance: "후기 남기기",
              block: { id: "review" },
              user: { id: target.userKey, type: "botUserKey" },
            },
            action: {
              id: "review",
              params: { review_text: "합성 제한 역할 후기" },
              clientExtra: { orderNo: order?.order_no },
            },
          }),
        },
        testEnv({ DATABASE_URL: databaseUrl }),
      );
    const responses = await Promise.all([send(), send(), send()]);
    expect(responses.map((r) => r.headers.get("Siljang-Outcome")).sort()).toEqual([
      "duplicate",
      "duplicate",
      "review_saved",
    ]);
    expect((await db.query("SELECT body,version FROM reviews WHERE order_id=$1", [target.orderId])).rows).toEqual([
      { body: "합성 제한 역할 후기", version: 1 },
    ]);
    expect(
      (
        await db.query(
          `SELECT
      has_column_privilege($1,'public.orders','id','SELECT') AS order_id_read,
      has_column_privilege($1,'public.orders','amount','SELECT') AS order_amount_read,
      has_column_privilege($1,'public.orders','status','UPDATE') AS order_status_update,
      has_column_privilege($1,'public.reviews','body','INSERT') AS review_body_insert,
      has_column_privilege($1,'public.reviews','body','SELECT') AS review_body_read,
      has_column_privilege($1,'public.reviews','body','UPDATE') AS review_body_update,
      has_table_privilege($1,'public.reviews','DELETE') AS review_delete`,
          [role],
        )
      ).rows,
    ).toEqual([
      {
        order_id_read: true,
        // 같은 앱 역할의 사장님 요약·장부 출력에 금액 읽기가 필요하다(TASK-066).
        order_amount_read: true,
        order_status_update: false,
        review_body_insert: true,
        review_body_read: false,
        review_body_update: false,
        review_delete: false,
      },
    ]);
  });

  it("별도 권한을 더하지 않고 실제 API가 질문/할 일/대기 알림을 기록함", async () => {
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    const logs = collectLogs();
    const response = await createApp({ logSink: logs.sink }).request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: {
            utterance: "합성 제한 역할 질문",
            block: { id: "permissions" },
            user: { id: newUuid(), type: "botUserKey" },
          },
          action: { id: "permissions", params: {} },
        }),
      },
      testEnv({ DATABASE_URL: databaseUrl }),
    );
    expect(response.status).toBe(200);
    expect(
      logs.lines
        .map((line) => JSON.parse(line) as { dbCode?: string })
        .flatMap((row) => (row.dbCode ? [row.dbCode] : [])),
    ).toEqual([]);
    expect(response.headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    expect(
      (
        await db.query(
          `SELECT t.id FROM owner_tasks t JOIN handoffs h ON h.id = t.handoff_id
      JOIN owner_alerts a ON a.owner_task_id = t.id WHERE t.shop_id = $1 AND a.status = 'pending'`,
          [shop.shopId],
        )
      ).rowCount,
    ).toBe(1);
    expect(logs.lines.join("\n")).not.toContain("42501");
    expect(logs.lines.join("\n")).not.toContain("합성 제한 역할 질문");
  });

  it("일반 안내는 조회와 전달 상태/시각만 바꾸는 제한 역할로 다음 응답에 전함", async () => {
    const target = await createShop(db, "제한 역할 일반 안내");
    await issueTestBookingLink(db, target);
    await linkTestChannel(db, target.channelId);
    const id = newUuid();
    await db.query(
      `INSERT INTO notifications (id, shop_id, customer_id, consultation_id, kind, event_key, template_key, body, status)
       VALUES ($1, $2, $3, $4, 'owner_reply', $5, 'owner_reply', '합성 사장님 답', 'deferred')`,
      [id, target.shopId, target.customerId, target.consultationId, `notice:${id}:owner_reply`],
    );
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), target.channelId, 1);
    const logs = collectLogs();
    const at = new Date("2026-11-22T12:00:00+09:00");
    const response = await createApp({ services: { now: () => at }, logSink: logs.sink }).request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: target.botId },
          userRequest: {
            utterance: "합성 사장님 답 뒤 질문",
            block: { id: "permissions" },
            user: { id: target.userKey, type: "botUserKey" },
          },
          action: { id: "permissions", params: {} },
        }),
      },
      testEnv({ DATABASE_URL: databaseUrl }),
    );
    expect(response.headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    const body = (await response.json()) as { template: { outputs: unknown[] } };
    expect(body.template.outputs[0]).toEqual({ simpleText: { text: "합성 사장님 답" } });
    expect((await db.query("SELECT status, sent_at FROM notifications WHERE id = $1", [id])).rows).toEqual([
      { status: "delivered_on_reply", sent_at: at },
    ]);
    expect(
      (
        await db.query(
          `SELECT has_table_privilege($1, 'notifications', 'SELECT') AS can_read,
        has_column_privilege($1, 'notifications', 'status', 'UPDATE') AS can_status,
        has_column_privilege($1, 'notifications', 'sent_at', 'UPDATE') AS can_sent,
        has_column_privilege($1, 'notifications', 'body', 'UPDATE') AS can_body,
        has_table_privilege($1, 'notifications', 'INSERT') AS can_insert,
        has_table_privilege($1, 'notifications', 'DELETE') AS can_delete`,
          [role],
        )
      ).rows,
    ).toEqual([
      { can_read: true, can_status: true, can_sent: true, can_body: false, can_insert: false, can_delete: false },
    ]);
    expect(logs.lines.join("\n")).not.toContain("42501");
  });

  it("같은 제한 역할로 새 질문을 덧붙이고 중복 요청의 추가 쓰기를 막음", async () => {
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    const user = newUuid();
    const logs = collectLogs();
    const app = createApp({ services: { now: () => new Date("2026-11-22T10:00:00+09:00") }, logSink: logs.sink });
    const send = (utterance: string) =>
      app.request(
        "/api/kakao/skills/message",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance,
              block: { id: "permissions" },
              user: { id: user, type: "botUserKey" },
            },
            action: { id: "permissions", params: {} },
          }),
        },
        testEnv({ DATABASE_URL: databaseUrl }),
      );
    expect((await send("첫 합성 질문")).headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    expect((await send("다음 합성 질문")).headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    const duplicate = await send("다음 합성 질문");
    expect(duplicate.headers.get("Siljang-Outcome")).toBe("duplicate");
    expect(await duplicate.json()).toEqual({ version: "2.0", template: { outputs: [] } });
    const { rows } = await db.query(
      `SELECT h.id, count(q.id)::int AS questions FROM handoffs h
      JOIN consultations c ON c.id = h.consultation_id JOIN customers u ON u.id = c.customer_id
      LEFT JOIN handoff_questions q ON q.handoff_id = h.id
      WHERE h.shop_id = $1 AND u.kakao_user_key = $2 GROUP BY h.id`,
      [shop.shopId, user],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ questions: 1 });
    expect(logs.lines.join("\n")).not.toContain("42501");
  });

  it("비용 조회만 허용한 같은 제한 역할의 실제 API가 상담 비용 한도를 지킴", async () => {
    const target = await createShop(db, "제한 역할 비용 한도");
    await issueTestBookingLink(db, target);
    await linkTestChannel(db, target.channelId);
    await db.query(
      `INSERT INTO ai_calls (shop_id, consultation_id, trace_id, provider, model, prompt_version, sent_at, cost_krw, result)
      VALUES ($1, $2, $3, 'synthetic', 'synthetic', 'synthetic', $4, 1000, 'failure')`,
      [target.shopId, target.consultationId, newUuid(), new Date("2026-11-22T10:00:00+09:00")],
    );
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), target.channelId, 1);
    const response = await createApp({
      services: { now: () => new Date("2026-11-22T10:00:00+09:00") },
      logSink: () => {},
    }).request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: target.botId },
          userRequest: {
            utterance: "합성 제한 역할 비용 질문",
            block: { id: "cost" },
            user: { id: target.userKey, type: "botUserKey" },
          },
          action: { id: "cost", params: {} },
        }),
      },
      testEnv({ DATABASE_URL: databaseUrl }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe("ai_cost_limit_reached");
    expect((await db.query("SELECT reason FROM handoffs WHERE shop_id = $1", [target.shopId])).rows).toEqual([
      { reason: "ai_cost_limit" },
    ]);
  });

  it("같은 제한 역할로 전화번호를 가리고 원본 최소 정보만 남김", async () => {
    const target = await createShop(db, "제한 역할 본문 마스킹");
    await issueTestBookingLink(db, target);
    await linkTestChannel(db, target.channelId);
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), target.channelId, 1);
    const response = await createApp({
      services: { now: () => new Date("2026-11-22T10:00:00+09:00") },
      logSink: () => {},
    }).request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: target.botId },
          userRequest: {
            utterance: "연락 010-1234-5678",
            block: { id: "masking" },
            user: { id: target.userKey, type: "botUserKey" },
          },
          action: { id: "masking", params: {} },
        }),
      },
      testEnv({ DATABASE_URL: databaseUrl, FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    expect(
      (
        await db.query("SELECT body_masked FROM messages WHERE shop_id = $1 AND direction = 'inbound' AND id <> $2", [
          target.shopId,
          target.messageId,
        ])
      ).rows,
    ).toEqual([{ body_masked: "연락 [전화번호1]" }]);
    const values = (
      await db.query("SELECT kind, original_enc, last4 FROM masked_values WHERE shop_id = $1", [target.shopId])
    ).rows;
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ kind: "phone", last4: "5678" });
    expect(values[0]?.original_enc).toMatch(/^v1:/);
  });

  it("캘린더 설정 수정만 허용하고 불필요한 수정/삭제·운영 기록/접속기록 권한은 막음", async () => {
    const { rows } = await db.query(
      `SELECT
      has_any_column_privilege($1, 'public.handoffs', 'UPDATE') AS handoff_update,
      has_table_privilege($1, 'public.handoffs', 'DELETE') AS handoff_delete,
      has_any_column_privilege($1, 'public.handoff_questions', 'UPDATE') AS question_update,
      has_table_privilege($1, 'public.handoff_questions', 'DELETE') AS question_delete,
      has_any_column_privilege($1, 'public.owner_tasks', 'UPDATE') AS task_update,
      has_table_privilege($1, 'public.owner_tasks', 'DELETE') AS task_delete,
      has_any_column_privilege($1, 'public.owner_alerts', 'UPDATE') AS alert_update,
      has_table_privilege($1, 'public.owner_alerts', 'DELETE') AS alert_delete,
      has_any_column_privilege($1, 'public.business_calendars', 'UPDATE') AS calendar_update,
      has_table_privilege($1, 'public.business_calendars', 'DELETE') AS calendar_delete,
      has_table_privilege($1, 'public.ai_calls', 'SELECT') AS ai_cost_read,
      has_table_privilege($1, 'public.ai_calls', 'INSERT') AS ai_call_insert,
      has_any_column_privilege($1, 'public.ai_calls', 'UPDATE') AS ai_call_update,
      has_column_privilege($1, 'public.ai_calls', 'fallback_reason', 'UPDATE') AS ai_reason_update,
      has_column_privilege($1, 'public.ai_calls', 'cost_krw', 'UPDATE') AS ai_cost_update,
      has_table_privilege($1, 'public.ai_calls', 'DELETE') AS ai_call_delete,
      has_column_privilege($1, 'public.order_drafts', 'lettering', 'INSERT') AS draft_text_insert,
      has_column_privilege($1, 'public.order_drafts', 'lettering', 'UPDATE') AS draft_text_update,
      has_column_privilege($1, 'public.order_drafts', 'customer_phone', 'UPDATE') AS draft_phone_update,
      has_column_privilege($1, 'public.order_drafts', 'allergy_answer', 'SELECT') AS draft_allergy_read,
      has_any_column_privilege($1, 'public.masked_values', 'UPDATE') AS masked_update,
      has_table_privilege($1, 'public.masked_values', 'DELETE') AS masked_delete,
      has_any_column_privilege($1, 'public.ops_events', 'UPDATE') AS ops_update,
      has_table_privilege($1, 'public.ops_events', 'DELETE') AS ops_delete,
      has_table_privilege($1, 'public.access_logs', 'SELECT') AS access_full_select,
      has_any_column_privilege($1, 'public.access_logs', 'UPDATE') AS access_update,
      has_table_privilege($1, 'public.operators', 'INSERT') AS operator_insert`,
      [role],
    );
    expect(rows).toEqual([
      {
        handoff_update: false,
        handoff_delete: false,
        question_update: false,
        question_delete: false,
        task_update: false,
        task_delete: false,
        alert_update: false,
        alert_delete: false,
        calendar_update: true, // TASK-041 API-027은 설정을 수정한다. 삭제는 계속 금지한다.
        calendar_delete: false,
        ai_cost_read: true,
        ai_call_insert: true,
        ai_call_update: true,
        ai_reason_update: true,
        ai_cost_update: false,
        ai_call_delete: false,
        draft_text_insert: true,
        draft_text_update: true,
        draft_phone_update: false,
        draft_allergy_read: false,
        masked_update: false,
        masked_delete: false,
        ops_update: false,
        ops_delete: false,
        access_full_select: false,
        access_update: false,
        operator_insert: false,
      },
    ]);
  });
});
