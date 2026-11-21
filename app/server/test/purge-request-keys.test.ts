import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { purgeExpiredRequestKeys } from "../src/purge-request-keys";
import { describeDb, newRequestKey, newUuid, testDb } from "./support/db";

const NOW = new Date("2026-11-21T00:00:00Z");
const HOUR = 3_600_000;

describe("요청 키 지우기의 입력 한도", () => {
  it.each([0, -1, 1001, 1.5, Number.NaN])("배치 크기 %s는 쿼리 전에 거절", async (limit) => {
    const query = vi.fn(async () => {
      throw new Error("unexpected query");
    });
    await expect(purgeExpiredRequestKeys({ query }, NOW, limit)).rejects.toBeInstanceOf(RangeError);
    expect(query).not.toHaveBeenCalled();
  });
  it("올바르지 않은 기준 시각은 쿼리 전에 거절", async () => {
    const query = vi.fn(async () => {
      throw new Error("unexpected query");
    });
    await expect(purgeExpiredRequestKeys({ query }, new Date(Number.NaN))).rejects.toBeInstanceOf(RangeError);
    expect(query).not.toHaveBeenCalled();
  });
});

describeDb("24시간 지난 화면 요청 키 지우기(TASK-158, SPEC-065 #8)", () => {
  const db = testDb();
  const actorId = newUuid();
  afterEach(() => db.query("DELETE FROM request_keys WHERE actor_id = $1", [actorId]));
  afterAll(() => db.close());

  async function seed(ageMs: number, leaseMs?: number) {
    const key = newRequestKey();
    await db.query(
      `INSERT INTO request_keys
       (actor_kind, actor_id, request_key, command, request_hash, state, processing_expires_at,
        response_status, response_code, created_at, done_at)
       VALUES ('owner', $1, $2, 'API-008', $3, $4, $5, $6, $7, $8, $9)`,
      [
        actorId,
        key,
        "a".repeat(64),
        leaseMs === undefined ? "done" : "processing",
        leaseMs === undefined ? null : new Date(NOW.getTime() + leaseMs),
        leaseMs === undefined ? 201 : null,
        leaseMs === undefined ? "created" : null,
        new Date(NOW.getTime() - ageMs),
        leaseMs === undefined ? new Date(NOW.getTime() - ageMs) : null,
      ],
    );
    return key;
  }
  async function keys() {
    return (
      await db.query<{ request_key: string }>(
        "SELECT request_key FROM request_keys WHERE actor_id = $1 ORDER BY request_key",
        [actorId],
      )
    ).rows.map((r) => r.request_key);
  }

  it("24시간 경계와 그보다 오래된 완료 키를 지우고 1시간 전 키는 유지", async () => {
    await seed(25 * HOUR);
    await seed(24 * HOUR);
    const recent = await seed(HOUR);
    expect(await purgeExpiredRequestKeys(db, NOW)).toBe(2);
    expect(await keys()).toEqual([recent]);
  });
  it("이어받아 처리 중인 옛 키의 유효한 임대는 보존하고 만료된 옛 키만 지움", async () => {
    const active = await seed(25 * HOUR, 30_000);
    await seed(25 * HOUR, -1);
    const recent = await seed(HOUR, -1);
    expect(await purgeExpiredRequestKeys(db, NOW)).toBe(1);
    expect(await keys()).toEqual([active, recent].sort());
  });
  it("한 번에 정한 수만 지우고 두 번 돌아도 남은 값이 같음", async () => {
    await seed(26 * HOUR);
    const later = await seed(25 * HOUR);
    expect(await purgeExpiredRequestKeys(db, NOW, 1)).toBe(1);
    expect(await keys()).toEqual([later]);
    expect(await purgeExpiredRequestKeys(db, NOW, 1)).toBe(1);
    expect(await purgeExpiredRequestKeys(db, NOW, 1)).toBe(0);
  });
  it("다른 트랜잭션이 잡은 요청 키는 기다리거나 지우지 않음", async () => {
    const key = await seed(25 * HOUR);
    const locker = testDb();
    try {
      await locker.transaction(async (tx) => {
        await tx.query("SELECT request_key FROM request_keys WHERE actor_id = $1 AND request_key = $2 FOR UPDATE", [
          actorId,
          key,
        ]);
        expect(await purgeExpiredRequestKeys(db, NOW)).toBe(0);
        expect(await keys()).toEqual([key]);
      });
      expect(await purgeExpiredRequestKeys(db, NOW)).toBe(1);
    } finally {
      await locker.close();
    }
  });
  it("동시 실행 둘은 같은 키를 두 번 세지 않고 각각 다른 한 행을 지움", async () => {
    await seed(26 * HOUR);
    await seed(25 * HOUR);
    const other = testDb();
    try {
      expect(await Promise.all([purgeExpiredRequestKeys(db, NOW, 1), purgeExpiredRequestKeys(other, NOW, 1)])).toEqual([
        1, 1,
      ]);
      expect(await keys()).toEqual([]);
    } finally {
      await other.close();
    }
  });
});
