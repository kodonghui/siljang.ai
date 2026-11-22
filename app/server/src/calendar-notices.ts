/** 캘린더 시각 변경에 따른 미발송 안내 재계산(REQ-243). */
import { shiftDate } from "./calendar-input";
import type { ShopDb } from "./shop-scope";
import { shopLocalToUtc, toShopLocal } from "./time";

interface ScheduledNotice {
  id: string;
  kind: "day_before" | "review_request";
  scheduled_for: Date;
  pickup_day: string | null;
  handed_over_at: Date | null;
}

/** 발송 전 작업은 scheduled_for도 확인해야 한다. 이미 시작한 시도의 임대/재시도 표는 덮어쓰지 않는다(G4). */
export async function rescheduleCalendarNotices(
  db: ShopDb,
  zone: string,
  before: { dayBefore: string; review: string } | undefined,
  after: { dayBefore: string; review: string },
): Promise<void> {
  const kinds: ScheduledNotice["kind"][] = [];
  if (before?.dayBefore !== after.dayBefore) kinds.push("day_before");
  if (before?.review !== after.review) kinds.push("review_request");
  if (!kinds.length) return;
  const rows = await db.run<ScheduledNotice>(
    `SELECT n.id, n.kind, n.scheduled_for,
    o.pickup_day::text, p.handed_over_at FROM notifications n
    LEFT JOIN orders o ON o.shop_id = $1 AND o.id = n.order_id
    LEFT JOIN productions p ON p.shop_id = $1 AND p.order_id = n.order_id
    WHERE n.shop_id = $1 AND n.kind = ANY($2::text[])
      AND n.status IN ('pending', 'retrying') AND n.sent_at IS NULL AND n.scheduled_for IS NOT NULL
    ORDER BY n.id FOR UPDATE OF n`,
    [kinds],
  );
  const ids: string[] = [],
    times: Date[] = [];
  for (const row of rows.rows) {
    const key = row.kind === "day_before" ? "dayBefore" : "review";
    const date =
      row.kind === "day_before" && row.pickup_day
        ? shiftDate(row.pickup_day, -1)
        : row.kind === "review_request" && row.handed_over_at
          ? shiftDate(toShopLocal(row.handed_over_at, zone).date, 1)
          : toShopLocal(row.scheduled_for, zone).date;
    const scheduled = shopLocalToUtc(date, after[key], zone);
    if (scheduled.getTime() === row.scheduled_for.getTime()) continue;
    ids.push(row.id);
    times.push(scheduled);
  }
  // 아직 시작하지 않은 안내만 재시도 시각도 옮긴다. 시작한 시도의 임대 표는 보존한다.
  if (ids.length)
    await db.run(
      `UPDATE notifications n SET scheduled_for = planned.scheduled_for,
    next_attempt_at = CASE WHEN n.attempts = 0 THEN planned.scheduled_for ELSE n.next_attempt_at END
    FROM unnest($2::uuid[], $3::timestamptz[]) AS planned(id,scheduled_for)
    WHERE n.shop_id = $1 AND n.id = planned.id AND n.status IN ('pending', 'retrying') AND n.sent_at IS NULL`,
      [ids, times],
    );
}
