/** SPEC-066: 짧은 선점/기록과 트랜잭션 밖의 발신·조회를 분리한다. */
import { shiftDate } from "./calendar-input";
import { recordPaymentNoticeDelivery } from "./customer-notice-store";
import { eventKeys, insertOnce } from "./event-keys";
import type { ActOutcome, DueItem, LeaseContext, LeasedHandler } from "./job-runner";
import {
  type KakaoEventFailure,
  type KakaoEventPlan,
  type KakaoEvents,
  planKakaoDeliveryCheck,
  planKakaoEventRequest,
} from "./kakao-event";
import { nextDeliveryCheckAt } from "./retry";
import type { ShopDb } from "./shop-scope";
import { shopLocalToUtc, toShopLocal } from "./time";

export interface CustomerNoticeOptions {
  readonly enabled?: boolean;
  readonly development?: boolean;
  readonly events: () => KakaoEvents;
  readonly now?: () => Date;
  /** 기록 트랜잭션 안의 ID/사유 알림. 네트워크를 호출하지 않는다. */
  readonly attention?: (event: {
    readonly target: "owner" | "operator";
    readonly code: KakaoEventFailure["code"];
    readonly shopId: string;
    readonly noticeId: string;
  }) => void;
}
interface NoticeRow {
  id: string;
  customer_id: string;
  kind: string;
  status: string;
  attempts: number;
  next_attempt_at: Date | null;
  scheduled_for: Date | null;
  kakao_task_id: string | null;
  requested_at: Date | null;
  delivery_checked_at: Date | null;
  channel_id: string;
  bot_id: string;
  user_key: string;
  channel_friend: boolean;
  channel_status: string;
  event_status: string;
  event_checked_at: Date | null;
  time_zone: string;
  consultation_status: string;
  order_id: string | null;
  order_status: string | null;
  order_customer_id: string | null;
  personal_data_purged_at: Date | null;
  payment_status: string | null;
  payment_cap: Date | null;
  pickup_at: Date | null;
  pickup_day: string | null;
  remake_of_order_id: string | null;
  had_issue: boolean;
}
interface Prepared {
  mode: "send" | "check";
  row: NoticeRow;
  attempts: number;
  leaseUntil: Date;
  startedAt: Date;
}
interface Observed {
  plan: KakaoEventPlan;
  at: Date;
}
async function defer(db: ShopDb, id: string, code: KakaoEventFailure["code"] | null, checkedAt?: Date) {
  if (checkedAt === undefined)
    await db.run(
      "UPDATE notifications SET status='deferred',next_attempt_at=NULL,fail_code=$3 WHERE shop_id=$1 AND id=$2",
      [id, code],
    );
  else
    await db.run(
      "UPDATE notifications SET status='deferred',next_attempt_at=NULL,fail_code=$3,delivery_checked_at=$4 WHERE shop_id=$1 AND id=$2",
      [id, code, checkedAt],
    );
}
function meaningless(row: NoticeRow, now: Date) {
  return (
    row.consultation_status === "deleted" ||
    row.personal_data_purged_at !== null ||
    (row.order_id !== null && (row.order_customer_id !== row.customer_id || row.order_status === null)) ||
    (row.kind === "order_confirmed" && !["confirmed", "received", "no_pickup"].includes(row.order_status ?? "")) ||
    (row.kind === "payment_request" &&
      (row.payment_status !== "open" || row.payment_cap === null || row.payment_cap <= now)) ||
    (row.kind === "day_before" &&
      (row.order_status !== "confirmed" ||
        row.scheduled_for === null ||
        row.pickup_at === null ||
        row.pickup_at <= now ||
        row.pickup_day !== shiftDate(toShopLocal(row.scheduled_for, row.time_zone).date, 1))) ||
    (row.kind === "review_request" &&
      (row.order_status !== "received" ||
        row.scheduled_for === null ||
        row.remake_of_order_id !== null ||
        row.had_issue))
  );
}
export function createCustomerNoticeHandler(options: CustomerNoticeOptions): LeasedHandler<Prepared, Observed> {
  const at = (ctx: LeaseContext) => new Date(Math.max(ctx.now.getTime(), (options.now?.() ?? new Date()).getTime()));
  return {
    mode: "leased",
    async lease(db: ShopDb, item: DueItem, ctx: LeaseContext) {
      const row = (
        await db.run<NoticeRow>(
          `SELECT n.id,n.customer_id,n.kind,n.status,n.attempts,n.next_attempt_at,n.scheduled_for,n.kakao_task_id,n.requested_at,n.delivery_checked_at,
          ch.id AS channel_id,ch.bot_id,u.kakao_user_key AS user_key,u.channel_friend,ch.status AS channel_status,ch.event_status,ch.event_checked_at,
          s.time_zone,c.status AS consultation_status,n.order_id,o.status AS order_status,o.customer_id AS order_customer_id,o.personal_data_purged_at,
          p.status AS payment_status,p.due_cap_at AS payment_cap,o.pickup_at,o.pickup_day::text,o.remake_of_order_id,
          EXISTS(SELECT 1 FROM issue_reports reported WHERE reported.shop_id=$1 AND reported.order_id=o.id) AS had_issue
          FROM notifications n JOIN customers u ON u.shop_id=$1 AND u.id=n.customer_id
          JOIN consultations c ON c.shop_id=$1 AND c.id=n.consultation_id AND c.customer_id=u.id
          JOIN kakao_channels ch ON ch.shop_id=$1 AND ch.id=u.kakao_channel_id JOIN shops s ON s.id=$1
          LEFT JOIN orders o ON o.shop_id=$1 AND o.id=n.order_id
          LEFT JOIN payment_requests p ON p.shop_id=$1 AND p.order_id=o.id AND n.event_key='notice:'||p.id::text||':payment_request'
          WHERE n.shop_id=$1 AND n.id=$2`,
          [item.id],
        )
      ).rows[0];
      if (!row) return null;
      const now = at(ctx);
      const mode = item.source === "notification_send" ? "send" : item.source === "notification_check" ? "check" : null;
      if (
        mode === null ||
        (mode === "send" ? !["pending", "retrying"].includes(row.status) : row.status !== "confirming")
      )
        return null;
      if (meaningless(row, now)) {
        await db.run("UPDATE notifications SET status='dropped',next_attempt_at=NULL WHERE shop_id=$1 AND id=$2", [
          row.id,
        ]);
        return null;
      }
      if (options.enabled !== true) {
        await defer(db, row.id, mode === "check" ? "unknown" : null);
        return null;
      }
      if (mode === "send") {
        if (
          row.next_attempt_at === null ||
          row.next_attempt_at > now ||
          (row.scheduled_for !== null && row.scheduled_for > now)
        )
          return null;
        if (!row.channel_friend) {
          await defer(db, row.id, "not_friend");
          return null;
        }
        if (row.channel_status !== "linked" || row.event_status !== "ready") {
          await defer(db, row.id, "cannot_send");
          return null;
        }
        if (row.attempts >= 4) {
          await defer(db, row.id, "unknown");
          return null;
        }
        if (row.scheduled_for !== null) {
          const local = toShopLocal(now, row.time_zone);
          if (local.time < "08:00" || local.time > "20:50") {
            const next = shopLocalToUtc(
              local.time < "08:00" ? local.date : shiftDate(local.date, 1),
              "08:00",
              row.time_zone,
            );
            await db.run("UPDATE notifications SET next_attempt_at=$3 WHERE shop_id=$1 AND id=$2", [row.id, next]);
            return null;
          }
        }
      } else if (
        row.requested_at === null ||
        row.kakao_task_id === null ||
        (row.delivery_checked_at !== null && row.delivery_checked_at > now) ||
        nextDeliveryCheckAt(row.requested_at, row.delivery_checked_at) > now
      )
        return null;
      const leaseUntil = new Date(Math.max(ctx.leaseUntil.getTime(), now.getTime() + 120000));
      await db.run(
        mode === "send"
          ? "UPDATE notifications SET attempts=attempts+1,next_attempt_at=$3 WHERE shop_id=$1 AND id=$2"
          : "UPDATE notifications SET delivery_checked_at=$3 WHERE shop_id=$1 AND id=$2",
        [row.id, leaseUntil],
      );
      return { mode, row, attempts: row.attempts + (mode === "send" ? 1 : 0), leaseUntil, startedAt: now };
    },
    async act(prepared: Prepared, ctx: LeaseContext) {
      const now = () => new Date(Math.max(at(ctx).getTime(), prepared.startedAt.getTime()));
      const client = options.events();
      if (prepared.mode === "send") {
        const result = await client.requestNotice(
          {
            botId: prepared.row.bot_id,
            development: options.development ?? false,
            userKey: prepared.row.user_key,
            noticeKey: prepared.row.id,
            isFriend: prepared.row.channel_friend,
            eventAvailable: true,
            status: prepared.row.status as "pending" | "retrying",
            attemptsDone: prepared.attempts - 1,
            nextAttemptAt: prepared.row.next_attempt_at,
            scheduledFor: prepared.row.scheduled_for,
            timeZone: prepared.row.time_zone,
          },
          now(),
        );
        const observed = now();
        return { plan: planKakaoEventRequest(prepared.attempts, observed, result), at: observed };
      }
      if (prepared.row.requested_at === null || prepared.row.kakao_task_id === null)
        throw new Error("missing customer notice task");
      const result = await client.checkDelivery(prepared.row.kakao_task_id, {
          type: "botUserKey",
          id: prepared.row.user_key,
        }),
        observed = now();
      return {
        plan: planKakaoDeliveryCheck(prepared.row.requested_at, observed, prepared.attempts, result),
        at: observed,
      };
    },
    async record(db: ShopDb, item: DueItem, prepared: Prepared, outcome: ActOutcome<Observed>, ctx: LeaseContext) {
      // 다음 대화와 같은 손님→안내 잠금 순서를 사용한다. 외부 호출은 이미 끝났다.
      if (
        (await db.run("SELECT id FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE", [prepared.row.customer_id]))
          .rowCount === 0
      )
        return;
      const owned = await db.run(
        prepared.mode === "send"
          ? "SELECT id FROM notifications WHERE shop_id=$1 AND id=$2 AND status IN ('pending','retrying') AND next_attempt_at=$3 AND attempts=$4 FOR UPDATE"
          : "SELECT id FROM notifications WHERE shop_id=$1 AND id=$2 AND status='confirming' AND delivery_checked_at=$3 AND attempts=$4 FOR UPDATE",
        [item.id, prepared.leaseUntil, prepared.attempts],
      );
      if (owned.rowCount === 0) return;
      const observed = outcome.ok ? outcome.value.at : at(ctx);
      const failure: KakaoEventFailure = {
        kind: "failed",
        code: "kakao_error",
        retryable: true,
        disableChannel: false,
        attention: null,
      };
      const plan = outcome.ok
        ? outcome.value.plan
        : prepared.mode === "check" && prepared.row.requested_at !== null
          ? planKakaoDeliveryCheck(prepared.row.requested_at, observed, prepared.attempts, { kind: "pending" })
          : planKakaoEventRequest(prepared.attempts, observed, failure);
      if (plan.status === "confirming") {
        await db.run(
          "UPDATE notifications SET status='confirming',next_attempt_at=NULL,kakao_task_id=$3,requested_at=$4,delivery_checked_at=$5,fail_code=NULL WHERE shop_id=$1 AND id=$2",
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
          "UPDATE notifications SET status='sent',sent_at=$3,next_attempt_at=NULL,delivery_checked_at=$3,fail_code=NULL WHERE shop_id=$1 AND id=$2",
          [item.id, plan.sentAt],
        );
        await recordPaymentNoticeDelivery(db, item.id, prepared.row.customer_id, plan.sentAt);
        return;
      }
      if (plan.status === "retrying") {
        await db.run(
          "UPDATE notifications SET status='retrying',next_attempt_at=$3,kakao_task_id=NULL,requested_at=NULL,delivery_checked_at=NULL,fail_code=$4 WHERE shop_id=$1 AND id=$2",
          [item.id, plan.nextAttemptAt, plan.failure.code],
        );
        return;
      }
      const stopped =
        plan.status === "deferred" ? plan.failure : { ...failure, code: "unknown" as const, retryable: false };
      await defer(db, item.id, stopped.code, prepared.mode === "check" ? observed : undefined);
      const cutoff = prepared.row.requested_at ?? prepared.startedAt;
      if (stopped.code === "not_friend")
        await db.run(
          "UPDATE customers SET channel_friend=false,friend_checked_at=$3 WHERE shop_id=$1 AND id=$2 AND (friend_checked_at IS NULL OR friend_checked_at<=$4)",
          [prepared.row.customer_id, observed, cutoff],
        );
      let channelDisabled = false;
      if (stopped.disableChannel)
        channelDisabled =
          (
            await db.run(
              "UPDATE kakao_channels SET event_status='unavailable',event_fail_reason=$3,event_checked_at=$4 WHERE shop_id=$1 AND id=$2 AND status='linked' AND event_status='ready' AND (event_checked_at IS NULL OR event_checked_at<=$5)",
              [prepared.row.channel_id, stopped.code === "wallet" ? "wallet_missing" : "kakao_error", observed, cutoff],
            )
          ).rowCount === 1;
      if (channelDisabled)
        await insertOnce(
          db,
          "owner_alerts",
          `INSERT INTO owner_alerts (shop_id, event_key, kind, next_attempt_at, created_at)
          VALUES ($1, $2, 'channel_event_unavailable', $3, $3) ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
          [eventKeys.alert("channel_event_unavailable", item.id), observed],
        );
      if (stopped.attention !== null && (stopped.attention !== "owner" || !stopped.disableChannel || channelDisabled))
        options.attention?.({
          target: stopped.attention,
          code: stopped.code,
          shopId: db.scope.shopId,
          noticeId: item.id,
        });
    },
  };
}
