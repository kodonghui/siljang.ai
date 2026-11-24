import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, type ShopFixture } from "./support/shops";

describeDb("상담 표시 순번의 기존 자료 이행(TASK-077)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb({ lastMigration: 36 });
    shop = await createShop(isolated.db, "합성 상담 순번 가게");
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
  });
  it("기존 시각·종류·ID 순으로 채운 뒤 같은 시각의 새 기록은 두 테이블에서 함께 증가", async () => {
    const now = new Date("2026-11-24T06:00:00Z"),
      oldNotice = newUuid();
    await isolated.db.query("UPDATE messages SET created_at=$2 WHERE id=$1", [shop.messageId, now]);
    const notice = (id: string) =>
      isolated.db.query(
        "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,created_at) VALUES($1,$2,$3,$4,$5,'owner_reply',$6,'synthetic','합성 답',$7)",
        [id, shop.shopId, shop.customerId, shop.consultationId, shop.orderId, `notice:${id}:owner_reply`, now],
      );
    await notice(oldNotice);
    const original = (
      await isolated.db.query("SELECT id,body_masked,created_at FROM messages WHERE id=$1", [shop.messageId])
    ).rows;
    await isolated.db.query(
      readFileSync(new URL("../../../db/migrations/0037_consultation_timeline.sql", import.meta.url), "utf8"),
    );
    const a = newUuid(),
      b = newUuid(),
      c = newUuid();
    const message = (id: string) =>
      isolated.db.query(
        "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,body_masked,delivery,created_at) VALUES($1,$2,$3,'outbound','system','text','합성 글','skill_response',$4)",
        [id, shop.shopId, shop.consultationId, now],
      );
    await message(a);
    await notice(b);
    await message(c);
    const rows = (
      await isolated.db.query<{ id: string; timeline_seq: string }>(
        "SELECT id,timeline_seq FROM messages WHERE shop_id=$1 UNION ALL SELECT id,timeline_seq FROM notifications WHERE shop_id=$1 ORDER BY timeline_seq",
        [shop.shopId],
      )
    ).rows;
    expect(rows.map((x) => x.id)).toEqual([shop.messageId, oldNotice, a, b, c]);
    expect(rows.map((x) => x.timeline_seq)).toEqual(["1", "2", "3", "4", "5"]);
    expect(
      (await isolated.db.query("SELECT id,body_masked,created_at FROM messages WHERE id=$1", [shop.messageId])).rows,
    ).toEqual(original);
  });
});
