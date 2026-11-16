import { afterAll, beforeAll, expect, it } from "vitest";
import { sqlStateOf } from "../src/db";
import { REFERENCE_PHOTOS_PER_CONSULTATION, referencePhotoRoom } from "../src/photo-count";
import { ApiError } from "../src/problem";
import { createShopScope, type ShopDb, type ShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { createShop, type ShopFixture } from "./support/shops";

// 05 A11 사진 장수(TASK-022): 신고·완성·후기 사진의 5장은 데이터베이스가 막고, 참고 사진의 상담마다 10장은 앱이 센다.

/** 오류의 SQLSTATE와 제약 이름. */
async function failure(p: Promise<unknown>): Promise<{ state: string | undefined; constraint: string | undefined }> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  if (err === null) return { state: "no error", constraint: undefined };
  // pg의 DatabaseError는 제약 이름(constraint)도 싣는다(src/types/pg.d.ts는 서버가 쓰는 code만 적음)
  const constraint = (err as { constraint?: unknown }).constraint;
  return { state: sqlStateOf(err), constraint: typeof constraint === "string" ? constraint : undefined };
}

/** 사진 테이블마다 부모(가리키는 행) 열. 부모 행 없이 넣어 CHECK가 외래 키보다 먼저 막는지 본다. */
const FIVE_PHOTO_TABLES = [
  { table: "issue_photos", parent: "issue_details_id" },
  { table: "completion_photos", parent: "production_id" },
  { table: "review_photos", parent: "review_id" },
] as const;

const photoValues = "'tmp/a/upl_x', 'image/jpeg', 1024";

describeDb("05 A11 사진 장수", () => {
  const db = testDb();
  let f: ShopFixture;
  let other: ShopFixture;
  let scope: ShopScope;

  beforeAll(async () => {
    f = await createShop(db, "사진가게");
    other = await createShop(db, "다른가게");
    scope = createShopScope(f.shopId, { kind: "customer", channelId: f.channelId });
  });

  afterAll(async () => {
    await db.close();
  });

  /** 상담에 사진 메시지를 하나 더 만든다. */
  async function photoMessage(x: ShopFixture, consultationId: string): Promise<string> {
    const id = newUuid();
    await db.query(
      `INSERT INTO messages (id, shop_id, consultation_id, direction, author, kind, kakao_message_id, body_masked, trace_id)
       VALUES ($1, $2, $3, 'inbound', 'customer', 'photo', $4, '[사진]', 'trace-photo')`,
      [id, x.shopId, consultationId, `km-${newUuid()}`],
    );
    return id;
  }

  /** 메시지 하나에 참고 사진을 positions 순서로 넣는다. */
  async function referencePhotos(x: ShopFixture, messageId: string, positions: readonly number[]): Promise<void> {
    for (const position of positions) {
      await db.query(
        `INSERT INTO reference_photos (shop_id, draft_id, message_id, position, storage_key, content_type, byte_size)
         VALUES ($1, $2, $3, $4, $5, 'image/jpeg', 1024)`,
        [x.shopId, x.draftId, messageId, position, `shops/${x.shopId}/reference/${newUuid()}`],
      );
    }
  }

  const room = (consultationId: string, s: ShopScope = scope) =>
    shopRequestDb(s, db).transaction((tx) => referencePhotoRoom(tx, consultationId));

  it("신고·완성·후기 사진의 순서 6과 0은 데이터베이스가 막음(23514 position CHECK, 부모 행 검사보다 먼저)", async () => {
    for (const { table, parent } of FIVE_PHOTO_TABLES) {
      const insert = (position: number) =>
        db.query(
          `INSERT INTO ${table} (shop_id, ${parent}, position, storage_key, content_type, byte_size)
           VALUES ($1, $2, $3, ${photoValues})`,
          [f.shopId, newUuid(), position],
        );
      for (const position of [6, 0]) {
        expect(await failure(insert(position)), `${table} ${position}`).toEqual({
          state: "23514",
          constraint: `${table}_position_check`,
        });
      }
      // 순서 5는 CHECK를 지나 부모 행이 없어 막힘(위의 23514가 순서 때문이었음을 보임)
      expect((await failure(insert(5))).state, `${table} 5`).toBe("23503");
    }
  });

  it("같은 신고 내용·제작·후기 안에서 순서가 겹치면 데이터베이스가 막음(23505, 부모 행 검사보다 먼저)", async () => {
    for (const { table, parent } of FIVE_PHOTO_TABLES) {
      const parentId = newUuid();
      const err = await failure(
        db.query(
          `INSERT INTO ${table} (shop_id, ${parent}, position, storage_key, content_type, byte_size)
           VALUES ($1, $2, 3, ${photoValues}), ($1, $2, 3, ${photoValues})`,
          [f.shopId, parentId],
        ),
      );
      expect(err, table).toEqual({ state: "23505", constraint: `${table}_position_uq` });
    }
  });

  it("참고 사진은 메시지 안 순서 11을 데이터베이스가 막지만, 상담마다 10장은 막지 않음(그래서 앱이 셈)", async () => {
    const insert = (position: number) =>
      db.query(
        `INSERT INTO reference_photos (shop_id, draft_id, message_id, position, storage_key, content_type, byte_size)
         VALUES ($1, $2, $3, $4, ${photoValues})`,
        [f.shopId, newUuid(), newUuid(), position],
      );
    expect(await failure(insert(11))).toEqual({ state: "23514", constraint: "reference_photos_position_check" });
    expect((await failure(insert(10))).state).toBe("23503");
  });

  it("상담에 남은 참고 사진 수: 여러 메시지의 사진을 모두 세고, 다른 상담의 사진은 세지 않음", async () => {
    const c = await createShop(db, "참고가게");
    const s = createShopScope(c.shopId, { kind: "customer", channelId: c.channelId });
    expect(await room(c.consultationId, s)).toBe(REFERENCE_PHOTOS_PER_CONSULTATION);
    await referencePhotos(c, c.messageId, [1, 2, 3, 4, 5, 6]);
    expect(await room(c.consultationId, s)).toBe(4);
    // 끝난 다른 상담(같은 손님)의 사진은 세지 않음
    const ended = newUuid();
    await db.query(
      "INSERT INTO consultations (id, shop_id, customer_id, status, ended_at) VALUES ($1, $2, $3, 'ended', now())",
      [ended, c.shopId, c.customerId],
    );
    await referencePhotos(c, await photoMessage(c, ended), [1, 2, 3]);
    expect(await room(c.consultationId, s)).toBe(4);
    expect(await room(ended, s)).toBe(7);
    // 같은 상담의 다른 메시지 사진은 셈
    await referencePhotos(c, await photoMessage(c, c.consultationId), [1, 2, 3, 4]);
    expect(await room(c.consultationId, s)).toBe(0);
    // 데이터베이스는 11번째 사진을 막지 않음(메시지가 다르면 순서가 겹치지 않음). 앱은 남은 수 0을 보고 받지 않음
    await referencePhotos(c, await photoMessage(c, c.consultationId), [1]);
    expect(await room(c.consultationId, s)).toBe(0);
  });

  it("다른 가게의 상담·없는 상담·형식이 틀린 ID는 같은 404 not_found", async () => {
    for (const id of [other.consultationId, newUuid(), "not-a-uuid"]) {
      const err = await room(id).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, id).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("not_found");
    }
  });

  it("같은 상담에 동시에 온 사진은 차례로 셈(상담 행 잠금: 뒤 트랜잭션은 앞 트랜잭션이 끝날 때까지 기다림)", async () => {
    const c = await createShop(db, "동시가게");
    const s = createShopScope(c.shopId, { kind: "customer", channelId: c.channelId });
    const first = testDb();
    const second = testDb();
    try {
      const secondPid = (await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
      let release: () => void = () => {};
      const hold = new Promise<void>((r) => {
        release = r;
      });
      let locked: () => void = () => {};
      const firstHasLock = new Promise<void>((r) => {
        locked = r;
      });
      const insertFour = async (tx: ShopDb) => {
        for (const position of [1, 2, 3, 4]) {
          await tx.run(
            `INSERT INTO reference_photos (shop_id, draft_id, message_id, position, storage_key, content_type, byte_size)
             VALUES ($1, $2, $3, $4, $5, 'image/jpeg', 1024)`,
            [c.draftId, c.messageId, position, `shops/${c.shopId}/reference/${newUuid()}`],
          );
        }
      };
      const t1 = shopRequestDb(s, first).transaction(async (tx) => {
        const n = await referencePhotoRoom(tx, c.consultationId);
        await insertFour(tx);
        locked();
        await hold;
        return n;
      });
      await firstHasLock;
      let secondDone = false;
      const t2 = shopRequestDb(s, second)
        .transaction((tx) => referencePhotoRoom(tx, c.consultationId))
        .then((n) => {
          secondDone = true;
          return n;
        });
      // 뒤 트랜잭션이 상담 행 잠금을 기다리는지 데이터베이스에서 확인(시간에 기대지 않음)
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i += 1) {
        const r = await db.query<{ w: string | null }>(
          "SELECT wait_event_type AS w FROM pg_stat_activity WHERE pid = $1",
          [secondPid],
        );
        waiting = r.rows[0]?.w === "Lock";
        if (!waiting) await new Promise((r2) => setTimeout(r2, 50));
      }
      expect(waiting).toBe(true);
      expect(secondDone).toBe(false);
      release();
      expect(await t1).toBe(10);
      expect(await t2).toBe(6);
    } finally {
      await first.close();
      await second.close();
    }
  });
});
