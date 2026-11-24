/** SPEC-067: 같은 종류를 1분 창으로 묶고 외부 통신은 임대 트랜잭션 밖에서 한다. */
import type { ActOutcome, DueItem, LeaseContext, LeasedHandler } from "./job-runner";
import {
  type KakaoEventPlan,
  type KakaoOwnerEvents,
  planKakaoDeliveryCheck,
  planKakaoEventRequest,
} from "./kakao-event";
import { type OwnerAlertContent, ownerAlertContent } from "./owner-alert-content";
import { nextDeliveryCheckAt } from "./retry";
import type { ShopDb } from "./shop-scope";

interface AlertRow {
  id: string;
  kind: string;
  event_key: string;
  status: string;
  owner_task_id: string | null;
  task_kind: string | null;
  task_closed_at: Date | null;
  attempts: number;
  next_attempt_at: Date | null;
  created_at: Date;
  kakao_task_id: string | null;
  requested_at: Date | null;
  delivery_checked_at: Date | null;
  owner_id: string;
  app_user_id: string;
  alert_channel_friend: boolean;
  time_zone: string;
}
interface Prepared {
  mode: "send" | "check";
  row: AlertRow;
  attempts: number;
  leaseUntil: Date;
  content: OwnerAlertContent | null;
}
interface Observed {
  plan: KakaoEventPlan;
  at: Date;
}
export interface OwnerAlertOptions {
  readonly enabled: boolean;
  readonly botId?: string;
  readonly origin?: string;
  readonly development?: boolean;
  readonly events: () => KakaoOwnerEvents;
  readonly now?: () => Date;
}
const TASK_ALERTS = new Set(["new_task", "task_realert", "handoff_appended"]);
async function stop(db: ShopDb, id: string, code: "not_friend" | "cannot_send" | "unknown") {
  await db.run("UPDATE owner_alerts SET status=$3,fail_code=$4,next_attempt_at=NULL WHERE shop_id=$1 AND id=$2", [
    id,
    code === "not_friend" ? "not_friend" : "failed",
    code,
  ]);
}

export function createOwnerAlertHandler(options: OwnerAlertOptions): LeasedHandler<Prepared, Observed> {
  if (options.enabled && !/^[0-9a-f]{24}$/i.test(options.botId ?? "")) throw new TypeError("invalid owner alert bot");
  const origin = options.origin ? new URL(options.origin) : null;
  if (
    options.enabled &&
    (origin === null ||
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash)
  )
    throw new TypeError("invalid owner alert origin");
  const at = (ctx: LeaseContext) => new Date(Math.max(ctx.now.getTime(), (options.now?.() ?? new Date()).getTime()));
  return {
    mode: "leased",
    async lease(db: ShopDb, item: DueItem, ctx: LeaseContext) {
      const row = (
        await db.run<AlertRow>(
          `SELECT a.id,a.kind,a.event_key,a.status,a.owner_task_id,t.kind AS task_kind,t.closed_at AS task_closed_at,
         a.attempts,a.next_attempt_at,a.created_at,a.kakao_task_id,a.requested_at,a.delivery_checked_at,
         o.id AS owner_id,o.kakao_account_id::text AS app_user_id,o.alert_channel_friend,s.time_zone
         FROM owner_alerts a JOIN shops s ON s.id=$1 JOIN owners o ON o.id=s.owner_id
         LEFT JOIN owner_tasks t ON t.shop_id=$1 AND t.id=a.owner_task_id WHERE a.shop_id=$1 AND a.id=$2`,
          [item.id],
        )
      ).rows[0];
      if (!row) return null;
      if (!options.enabled) {
        await stop(db, row.id, "cannot_send");
        return null;
      }
      if (!row.alert_channel_friend) {
        await stop(db, row.id, "not_friend");
        return null;
      }
      if (item.source === "owner_alert_send") {
        if (row.status !== "pending" || row.next_attempt_at === null || row.next_attempt_at > ctx.now) return null;
        if (TASK_ALERTS.has(row.kind) && (row.owner_task_id === null || row.task_closed_at !== null)) {
          await stop(db, row.id, "cannot_send");
          return null;
        }
        if (row.attempts >= 4) {
          await stop(db, row.id, "unknown");
          return null;
        }
        if (row.attempts === 0) {
          const ready = new Date(row.created_at.getTime() + 60000);
          if (ctx.now < ready) {
            await db.run("UPDATE owner_alerts SET next_attempt_at=$3 WHERE shop_id=$1 AND id=$2", [row.id, ready]);
            return null;
          }
          // 다른 실행기가 같은 가게 묶음을 처리하면 자기 행 잠금을 바로 풀고 다음 번에 본다.
          if ((await db.run("SELECT id FROM shops WHERE id=$1 FOR UPDATE SKIP LOCKED")).rowCount === 0) return null;
          const peers = (
            await db.run<{ id: string }>(
              `SELECT a.id FROM owner_alerts a LEFT JOIN owner_tasks t ON t.shop_id=$1 AND t.id=a.owner_task_id
             WHERE a.shop_id=$1 AND a.id<>$2 AND a.status='pending' AND a.attempts=0 AND a.kind=$3
             AND t.kind IS NOT DISTINCT FROM $4::text AND t.closed_at IS NULL
             AND a.created_at>=$5 AND a.created_at<$6 ORDER BY a.id FOR UPDATE OF a`,
              [row.id, row.kind, row.task_kind, row.created_at, ready],
            )
          ).rows;
          if (peers.length)
            await db.run(
              "UPDATE owner_alerts SET status='batched',batched_into_id=$2,next_attempt_at=NULL WHERE shop_id=$1 AND id=ANY($3::uuid[])",
              [row.id, peers.map((peer) => peer.id)],
            );
        }
        const content = origin === null ? null : await ownerAlertContent(db, row, origin);
        if (content === null) {
          await stop(db, row.id, "cannot_send");
          return null;
        }
        await db.run("UPDATE owner_alerts SET attempts=attempts+1,next_attempt_at=$3 WHERE shop_id=$1 AND id=$2", [
          row.id,
          ctx.leaseUntil,
        ]);
        return { mode: "send", row, attempts: row.attempts + 1, leaseUntil: ctx.leaseUntil, content };
      }
      if (
        item.source !== "owner_alert_check" ||
        row.status !== "confirming" ||
        row.requested_at === null ||
        row.kakao_task_id === null
      )
        return null;
      if (row.delivery_checked_at !== null && row.delivery_checked_at > ctx.now) return null;
      if (nextDeliveryCheckAt(row.requested_at, row.delivery_checked_at) > ctx.now) return null;
      await db.run("UPDATE owner_alerts SET delivery_checked_at=$3 WHERE shop_id=$1 AND id=$2", [
        row.id,
        ctx.leaseUntil,
      ]);
      return { mode: "check", row, attempts: row.attempts, leaseUntil: ctx.leaseUntil, content: null };
    },
    async act(prepared: Prepared, ctx: LeaseContext) {
      const client = options.events();
      if (prepared.mode === "send") {
        if (prepared.content === null) throw new Error("owner alert content unavailable");
        const result = await client.requestAlert(
          {
            botId: options.botId ?? "",
            development: options.development ?? false,
            appUserId: prepared.row.app_user_id,
            alertKey: prepared.row.id,
            ...prepared.content,
            isFriend: prepared.row.alert_channel_friend,
            eventAvailable: options.enabled,
            status: "pending",
            attemptsDone: prepared.attempts - 1,
            nextAttemptAt: prepared.row.next_attempt_at,
            timeZone: prepared.row.time_zone,
          },
          at(ctx),
        );
        const observed = at(ctx);
        return { plan: planKakaoEventRequest(prepared.attempts, observed, result), at: observed };
      }
      const result = await client.checkDelivery(prepared.row.kakao_task_id ?? "", prepared.row.app_user_id),
        observed = at(ctx);
      if (prepared.row.requested_at === null) throw new Error("owner alert request time unavailable");
      return {
        plan: planKakaoDeliveryCheck(prepared.row.requested_at, observed, prepared.attempts, result),
        at: observed,
      };
    },
    async record(db: ShopDb, item: DueItem, prepared: Prepared, outcome: ActOutcome<Observed>, ctx: LeaseContext) {
      const owned = await db.run(
        prepared.mode === "send"
          ? "SELECT id FROM owner_alerts WHERE shop_id=$1 AND id=$2 AND status='pending' AND next_attempt_at=$3 AND attempts=$4 FOR UPDATE"
          : "SELECT id FROM owner_alerts WHERE shop_id=$1 AND id=$2 AND status='confirming' AND delivery_checked_at=$3 AND attempts=$4 FOR UPDATE",
        [item.id, prepared.leaseUntil, prepared.attempts],
      );
      if (owned.rowCount === 0) return;
      const observed = outcome.ok ? outcome.value.at : at(ctx);
      const plan = outcome.ok
        ? outcome.value.plan
        : prepared.mode === "check" && prepared.row.requested_at !== null
          ? planKakaoDeliveryCheck(prepared.row.requested_at, observed, prepared.attempts, { kind: "pending" })
          : planKakaoEventRequest(prepared.attempts, observed, {
              kind: "failed",
              code: "kakao_error",
              retryable: true,
              disableChannel: false,
              attention: null,
            });
      if (plan.status === "confirming") {
        await db.run(
          "UPDATE owner_alerts SET status='confirming',next_attempt_at=NULL,kakao_task_id=$3,requested_at=$4,delivery_checked_at=$5,fail_code=NULL WHERE shop_id=$1 AND id=$2",
          [
            item.id,
            plan.taskId ?? prepared.row.kakao_task_id,
            plan.requestedAt ?? prepared.row.requested_at,
            prepared.mode === "send" ? null : observed,
          ],
        );
        return;
      }
      if (plan.status === "sent") {
        await db.run(
          "UPDATE owner_alerts SET status='sent',sent_at=$3,next_attempt_at=NULL,delivery_checked_at=$4,fail_code=NULL WHERE shop_id=$1 AND id=$2",
          [item.id, plan.sentAt, observed],
        );
        return;
      }
      if (plan.status === "retrying") {
        await db.run(
          "UPDATE owner_alerts SET status='pending',next_attempt_at=$3,kakao_task_id=NULL,requested_at=NULL,delivery_checked_at=NULL,fail_code=$4 WHERE shop_id=$1 AND id=$2",
          [item.id, plan.nextAttemptAt, plan.failure.code],
        );
        return;
      }
      const code = plan.status === "deferred" ? plan.failure.code : "unknown";
      await db.run(
        "UPDATE owner_alerts SET status=$3,fail_code=$4,next_attempt_at=NULL,delivery_checked_at=$5 WHERE shop_id=$1 AND id=$2",
        [item.id, code === "not_friend" ? "not_friend" : "failed", code, prepared.mode === "check" ? observed : null],
      );
      if (code === "not_friend")
        await db.run(
          "UPDATE owners o SET alert_channel_friend=false,alert_friend_checked_at=$3 FROM shops s WHERE s.id=$1 AND s.owner_id=o.id AND o.id=$2 AND (o.alert_friend_checked_at IS NULL OR o.alert_friend_checked_at<=$4)",
          [prepared.row.owner_id, observed, ctx.now],
        );
    },
  };
}
