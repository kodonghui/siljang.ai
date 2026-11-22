import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop } from "./support/shops";

describeDb("TASK-042 기존 채널 설정 순번 보정", () => {
  it.each([false, true])(
    "기존 heap 순서와 만든 시각/동률ID 순서가 다를 때도 최신 설정을 고름(동률:%s)",
    async (tie) => {
      const isolated = await isolatedTestDb({ lastMigration: 26 });
      try {
        const shop = await createShop(isolated.db, "합성 이전 채널 가게");
        await isolated.db.query("UPDATE kakao_channels SET created_at='2020-01-01T00:00:00Z' WHERE shop_id=$1", [
          shop.shopId,
        ]);
        const [low, high] = [newUuid(), newUuid()].sort() as [string, string];
        for (const [id, at] of [
          [high, "2020-01-03T00:00:00Z"],
          [low, tie ? "2020-01-03T00:00:00Z" : "2020-01-02T00:00:00Z"],
        ])
          await isolated.db.query(
            "INSERT INTO kakao_channels (id,shop_id,bot_id,status,created_at) VALUES ($1,$2,$3,'failed',$4)",
            [id, shop.shopId, newUuid().replaceAll("-", "").slice(0, 24), at],
          );
        await isolated.db.query(
          readFileSync(new URL("../../../db/migrations/0027_kakao_channel_configuration.sql", import.meta.url), "utf8"),
        );
        const current = async () =>
          (
            await isolated.db.query<{ id: string }>(
              "SELECT id FROM kakao_channels WHERE shop_id=$1 AND status<>'retired' ORDER BY configuration_order DESC LIMIT 1",
              [shop.shopId],
            )
          ).rows[0]?.id;
        expect(await current()).toBe(low);
        await isolated.db.query(
          readFileSync(
            new URL("../../../db/migrations/0028_kakao_channel_configuration_backfill.sql", import.meta.url),
            "utf8",
          ),
        );
        expect(await current()).toBe(high);
        const next = newUuid();
        await isolated.db.query("INSERT INTO kakao_channels (id,shop_id,bot_id,status) VALUES ($1,$2,$3,'failed')", [
          next,
          shop.shopId,
          newUuid().replaceAll("-", "").slice(0, 24),
        ]);
        expect(await current()).toBe(next);
      } finally {
        await isolated.close();
      }
    },
  );
});
