import type { ShopDb } from "./shop-scope";

/** 금액은 PostgreSQL numeric으로 비교한다. 하루는 가게 시간대의 자정부터 다음 자정까지다. */
export async function kakaoAiCostLimit(
  db: ShopDb,
  consultationId: string,
  now: Date,
): Promise<"ok" | "consultation" | "shop"> {
  const consultation = await db.found<{ reached: boolean }>(
    "SELECT coalesce(sum(cost_krw), 0) >= 1000 AS reached FROM ai_calls WHERE shop_id = $1 AND consultation_id = $2",
    [consultationId],
  );
  if (consultation.reached) return "consultation";
  const settings = await db.found<{ time_zone: string; daily_ai_cost_limit_krw: number }>(
    "SELECT time_zone, daily_ai_cost_limit_krw FROM shops WHERE id = $1",
  );
  const day = await db.found<{ reached: boolean }>(
    `SELECT coalesce(sum(cost_krw), 0) >= $2::numeric AS reached FROM ai_calls
      WHERE shop_id = $1
        AND sent_at >= (date_trunc('day', $3::timestamptz AT TIME ZONE $4) AT TIME ZONE $4)
        AND sent_at < ((date_trunc('day', $3::timestamptz AT TIME ZONE $4) + interval '1 day') AT TIME ZONE $4)`,
    [settings.daily_ai_cost_limit_krw, now, settings.time_zone],
  );
  return day.reached ? "shop" : "ok";
}
