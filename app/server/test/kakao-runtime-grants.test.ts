import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { RequestDb } from "../src/db";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { collectLogs, describeDb, newUuid, TEST_DATABASE_URL, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
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

  it("업무에 필요하지 않은 수정/삭제와 운영 기록/접속기록 권한을 늘리지 않음", async () => {
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
        calendar_update: false,
        calendar_delete: false,
        ops_update: false,
        ops_delete: false,
        access_full_select: false,
        access_update: false,
        operator_insert: false,
      },
    ]);
  });
});
