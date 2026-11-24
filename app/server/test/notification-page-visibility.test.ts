import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop } from "./support/shops";

describeDb("손님 안내 전달 버전 이행(TASK-077)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, notice: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb({ lastMigration: 37 });
    const shop = await createShop(isolated.db, "합성 전달 이행 가게");
    notice = newUuid();
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status) VALUES($1,$2,$3,$4,'owner_reply',$5,'synthetic','합성 답','deferred')",
      [notice, shop.shopId, shop.customerId, shop.consultationId, `notice:${notice}:owner_reply`],
    );
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
  });
  it("기존 본문·시각·상태를 보존하며 전달 성공 시각은 한 번만 남김", async () => {
    const db = isolated.db;
    const before = (await db.query("SELECT id,body,created_at,status,sent_at FROM notifications WHERE id=$1", [notice]))
      .rows;
    await db.query(
      readFileSync(new URL("../../../db/migrations/0038_notification_page_visibility.sql", import.meta.url), "utf8"),
    );
    expect(
      (await db.query("SELECT id,body,created_at,status,sent_at FROM notifications WHERE id=$1", [notice])).rows,
    ).toEqual(before);
    const at = new Date();
    const delivered = (
      await db.query<{ delivery_txid: string }>(
        "UPDATE notifications SET status='delivered_on_reply',sent_at=$2 WHERE id=$1 RETURNING delivery_txid",
        [notice, at],
      )
    ).rows[0];
    expect(delivered).toBeDefined();
    const version = (
      await db.query<{ delivery_txid: string }>(
        "UPDATE notifications SET body='합성 답 고침',delivery_txid=1 WHERE id=$1 RETURNING delivery_txid",
        [notice],
      )
    ).rows[0];
    expect(version?.delivery_txid).toBe(delivered?.delivery_txid);
    await db.query("UPDATE notifications SET sent_at=$2 WHERE id=$1", [notice, at]);
    await expect(
      db.query("UPDATE notifications SET sent_at=$2 WHERE id=$1", [notice, new Date(at.getTime() + 1000)]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("UPDATE notifications SET sent_at=NULL WHERE id=$1", [notice])).rejects.toMatchObject({
      code: "23514",
    });
    expect((await db.query("SELECT sent_at FROM notifications WHERE id=$1", [notice])).rows).toEqual([{ sent_at: at }]);
    const idx = (
      await db.query<{ def: string }>("SELECT pg_get_indexdef('notifications_timeline_page_idx'::regclass) AS def")
    ).rows[0]?.def;
    expect(idx).toContain("created_at, timeline_seq");
    expect(idx).not.toContain("sent_at");
  });
});
