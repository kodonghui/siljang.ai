import { eventKeys, insertOnce } from "./event-keys";
import { ownerWaitDue } from "./owner-wait";
import type { ShopDb } from "./shop-scope";

/** 새 확인 건의 기다림·할 일·최초 알림을 같은 트랜잭션에 남긴다. */
export async function createHandoffTask(
  db: ShopDb,
  handoffId: string,
  now: Date,
  detail: Readonly<Record<string, unknown>> | null = null,
): Promise<string> {
  const task = await insertOnce(
    db,
    "owner_tasks",
    `INSERT INTO owner_tasks (shop_id, event_key, handoff_id, kind, wait_status, wait_due_at, opened_at, detail)
     VALUES ($1, $2, $3, 'handoff', 'waiting', $4, $5, $6::jsonb)
     ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
    [
      eventKeys.task("handoff", handoffId),
      handoffId,
      await ownerWaitDue(db, now),
      now,
      detail === null ? null : JSON.stringify(detail),
    ],
  );
  await insertOnce(
    db,
    "owner_alerts",
    `INSERT INTO owner_alerts (shop_id, event_key, owner_task_id, kind, next_attempt_at, created_at)
     VALUES ($1, $2, $3, 'new_task', $4, $4) ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
    [eventKeys.alert("new_task", task.id), task.id, now],
  );
  return task.id;
}
