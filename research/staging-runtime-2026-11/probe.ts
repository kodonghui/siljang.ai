/** TASK-173: 별도 시험 Worker. 식별자·개수만 로그로 남기고 업무 행은 만들지 않는다. */
import type { Bindings } from "../../app/server/src/app";
import { pgConnector, type RequestDb, sqlStateOf } from "../../app/server/src/db";
import { createKakaoCallbackHandler } from "../../app/server/src/kakao-callback-queue";
import { runScheduled } from "../../app/server/src/scheduled";
import { readSettings } from "../../app/server/src/settings";
import { isUuid } from "../../app/server/src/shop-scope";

interface Env {
  readonly HYPERDRIVE: { readonly connectionString: string };
  readonly APP_ENV: "staging";
  readonly PROBE_TOKEN?: string;
  readonly PROBE_ID: string;
  readonly PROBE_SHOP: string;
  readonly PROBE_MESSAGE: string;
  readonly KAKAO_CALLBACK_QUEUE: { send(body: { shopId: string; messageId: string }): Promise<void> };
}
interface QueueMessage {
  readonly body: unknown;
  ack(): void;
  retry(options?: { readonly delaySeconds: number }): void;
}
function emit(env: Env, flags: Record<string, number>): void {
  console.log(JSON.stringify({ event: "task173_runtime_probe", runId: env.PROBE_ID, ...flags }));
}
function validIds(env: Env): boolean {
  return [env.PROBE_ID, env.PROBE_SHOP, env.PROBE_MESSAGE].every(isUuid);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.PROBE_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.PROBE_TOKEN}`) {
      return Response.json({ code: "unauthenticated" }, { status: 401 });
    }
    if (!validIds(env)) return Response.json({ code: "probe_config_invalid" }, { status: 503 });
    const path = new URL(request.url).pathname;
    if (path === "/queue" && request.method === "POST") {
      await env.KAKAO_CALLBACK_QUEUE.send({ shopId: env.PROBE_SHOP, messageId: env.PROBE_MESSAGE });
      return Response.json({ sent: 1 });
    }
    if (path !== "/schema" || request.method !== "GET") return Response.json({ code: "not_found" }, { status: 404 });
    const db = pgConnector(readSettings(env as unknown as Record<string, unknown>).secrets.DATABASE_URL);
    try {
      const metadata = await db.query(`SELECT to_regclass('public.owner_sessions') IS NOT NULL AS owner_sessions,
        (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'messages'
          AND column_name IN ('kakao_callback_enc','kakao_callback_deadline_at','kakao_callback_claim_until')) AS callback_columns,
        has_table_privilege(current_user, 'public.messages', 'SELECT') AS message_select,
        has_table_privilege(current_user, 'public.messages', 'INSERT') AS message_insert,
        has_table_privilege(current_user, 'public.messages', 'UPDATE') AS message_update,
        has_table_privilege(current_user, 'public.access_logs', 'SELECT') AS access_log_full_select`);
      return Response.json(metadata.rows[0]);
    } catch (error) {
      return Response.json({ code: "probe_failed", dbCode: sqlStateOf(error) ?? null }, { status: 500 });
    } finally {
      await db.close();
    }
  },
  async queue(batch: { readonly messages: readonly QueueMessage[] }, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const body = message.body as { shopId?: string; messageId?: string } | null;
      if (
        !validIds(env) ||
        typeof body !== "object" ||
        body === null ||
        body.shopId !== env.PROBE_SHOP ||
        body.messageId !== env.PROBE_MESSAGE
      ) {
        message.retry();
        continue;
      }
      // 앱과 같은 기본 처리기가 실제 Hyperdrive에 연결하고 ack·retry까지 실행한다.
      await createKakaoCallbackHandler()(
        {
          messages: [
            {
              body,
              ack() {
                message.ack();
                emit(env, { queue_done: 1 });
              },
              retry(options) {
                message.retry(options);
                emit(env, { queue_retry: 1 });
              },
            },
          ],
        },
        env as unknown as Bindings,
      );
    }
  },
  async scheduled(event: { readonly scheduledTime: number; readonly cron: string }, env: Env): Promise<void> {
    if (!validIds(env)) return;
    let queries = 0;
    const summary = await runScheduled(event, env as unknown as Record<string, unknown>, {
      connect: (url) => {
        const original = pgConnector(url);
        return {
          query: async (sql, params) => {
            if (sql.includes("FROM owner_tasks t")) queries++;
            return original.query(sql, params);
          },
          transaction: original.transaction.bind(original),
          abort: original.abort.bind(original),
          close: original.close.bind(original),
        } as RequestDb;
      },
      // 실제 실행기와 작업 표 조회를 사용하되 업무 행의 시각을 바꾸거나 처리하지 않는다.
      jobs: [
        {
          name: "task173_probe",
          every: "minute",
          sources: ["owner_task_wait"],
          cutoff: () => new Date("0001-01-01T00:00:00.000Z"),
          handler: {
            mode: "transaction",
            async run() {
              throw new Error("probe_no_row_mutation");
            },
          },
        },
      ],
      logSink: () => {},
      limits: { batch: 1, rounds: 1, budgetMs: 5000 },
    });
    emit(env, {
      cron_queries: queries,
      cron_done: summary !== null && summary.jobs.task173_probe?.failed === 0 ? 1 : 0,
    });
  },
};
