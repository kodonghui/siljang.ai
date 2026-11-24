import type { ShopDb } from "./shop-scope";
import { addWithinReplyHours } from "./time";

/** 기다리는 시간은 가게가 답하는 시간 안에서만 센다. */
export async function ownerWaitDue(db: ShopDb, now: Date): Promise<Date> {
  const config = await db.found<{
    time_zone: string;
    owner_wait_minutes: number;
    reply_start: string;
    reply_end: string;
  }>(
    `SELECT s.time_zone, s.owner_wait_minutes,
      to_char(b.reply_start, 'HH24:MI') AS reply_start, to_char(b.reply_end, 'HH24:MI') AS reply_end
     FROM shops s JOIN business_calendars b ON b.shop_id = $1 WHERE s.id = $1`,
  );
  return addWithinReplyHours(now, config.owner_wait_minutes, {
    timeZone: config.time_zone,
    start: config.reply_start,
    end: config.reply_end,
  });
}
