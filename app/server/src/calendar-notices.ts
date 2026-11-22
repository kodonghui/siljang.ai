/** 캘린더 시각 변경에 따른 미발송 안내 재계산(REQ-243). */
import { shiftDate } from "./calendar-input";
import type { ShopDb } from "./shop-scope";
import { shopLocalToUtc, toShopLocal } from "./time";

interface ScheduledNotice {
  id: string;
  kind: "day_before" | "review_request";
  attempts: number;
  scheduled_for: Date;
  next_attempt_at: Date | null;
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
  if (before?.dayBefore === after.dayBefore && before.review === after.review) return;
  const rows = await db.run<ScheduledNotice>(`SELECT n.id, n.kind, n.attempts, n.scheduled_for, n.next_attempt_at,
    o.pickup_day::text, p.handed_over_at FROM notifications n
    LEFT JOIN orders o ON o.shop_id = $1 AND o.id = n.order_id
    LEFT JOIN productions p ON p.shop_id = $1 AND p.order_id = n.order_id
    WHERE n.shop_id = $1 AND n.kind IN ('day_before', 'review_request')
      AND n.status IN ('pending', 'retrying') AND n.sent_at IS NULL AND n.scheduled_for IS NOT NULL
    ORDER BY n.id FOR UPDATE OF n`);
  for (const row of rows.rows) {
    const key = row.kind === "day_before" ? "dayBefore" : "review";
    if (before?.[key] === after[key]) continue;
    const date =
      row.kind === "day_before" && row.pickup_day
        ? shiftDate(row.pickup_day, -1)
        : row.kind === "review_request" && row.handed_over_at
          ? shiftDate(toShopLocal(row.handed_over_at, zone).date, 1)
          : toShopLocal(row.scheduled_for, zone).date;
    const scheduled = shopLocalToUtc(date, after[key], zone);
    if (scheduled.getTime() === row.scheduled_for.getTime()) continue;
    // attempts=0은 아직 시작하지 않은 안내다. 발송 중/재시도의 next_attempt_at은 임대 표일 수 있다.
    await db.run(
      `UPDATE notifications SET scheduled_for = $3,
      next_attempt_at = CASE WHEN attempts = 0 THEN $3::timestamptz ELSE next_attempt_at END
      WHERE shop_id = $1 AND id = $2 AND status IN ('pending', 'retrying') AND sent_at IS NULL`,
      [row.id, scheduled],
    );
  }
}
