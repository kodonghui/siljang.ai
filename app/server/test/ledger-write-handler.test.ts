import { describe, expect, it, vi } from "vitest";
import { createLedgerWriteHandler } from "../src/ledger-write-handler";
import { Secret } from "../src/settings";
import type { ShopDb } from "../src/shop-scope";

const shopId = crypto.randomUUID(),
  linkId = crypto.randomUUID(),
  writeId = crypto.randomUUID();
const item = { source: "ledger_write" as const, shopId, id: writeId, dueAt: new Date("2026-11-28T00:00:00Z") };
const ctx = { job: "ledger_write", now: item.dueAt, leaseUntil: new Date("2026-11-28T00:02:00Z") };
const row = {
  shopId,
  eventId: writeId,
  orderId: crypto.randomUUID(),
  uncertain: false,
  auditing: false,
  linkId,
  file: "synthetic_sheet_1234567890",
  tab: "장부",
  values: ["ABC123", "이름", "010-1234-5678", "", "", "", 1000, "", "", 0, "", ""],
};

describe("장부 쓰기 임대 처리", () => {
  it("현재 값을 임대하고 시트 성공을 같은 임대에만 기록한다", async () => {
    const claim = vi.fn(async () => row),
      finish = vi.fn(async () => {}),
      credential = vi.fn(async () => new Secret("token"));
    const columns = { columns: [{ header: "주문번호", column: "AA" }], movedRight: true, ownershipToken: "proof" };
    const write = vi.fn(async () => ({ status: "written" as const, columns }));
    const handler = createLedgerWriteHandler({ claim, finish, credential, write });
    const db = {} as ShopDb;
    const prepared = await handler.lease(db, item, ctx);
    expect(prepared).not.toBeNull();
    if (!prepared) throw new Error("missing lease");
    const outcome = await handler.act(prepared, ctx);
    await handler.record(db, item, prepared, { ok: true, value: outcome }, ctx);
    expect(claim).toHaveBeenCalledWith(db, item, ctx);
    expect(write).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith(db, item, ctx, { status: "written", columns });
  });
  it("실패와 권한 상실을 구분하여 기록하고 임대 실패에는 호출하지 않는다", async () => {
    const finish = vi.fn(async () => {}),
      write = vi.fn(async () => ({ status: "auth_lost" as const }));
    const handler = createLedgerWriteHandler({ claim: async () => row, finish, credential: async () => null, write });
    const db = {} as ShopDb,
      prepared = await handler.lease(db, item, ctx);
    if (!prepared) throw new Error("missing lease");
    expect(await handler.act(prepared, ctx)).toEqual({ status: "auth_lost" });
    expect(write).not.toHaveBeenCalled();
    await handler.record(db, item, prepared, { ok: false, errorName: "Error" }, ctx);
    expect(finish).toHaveBeenCalledWith(db, item, ctx, { status: "retry" });
  });
  it("암호화 설정 오류는 임대를 되돌리지 않고 재시도 상태로 기록한다", async () => {
    const finish = vi.fn(async () => {});
    const handler = createLedgerWriteHandler({
      claim: async () => row,
      finish,
      credential: async () => {
        throw new Error("key unavailable");
      },
      write: async () => ({ status: "auth_lost" }),
    });
    const db = {} as ShopDb,
      prepared = await handler.lease(db, item, ctx);
    if (!prepared) throw new Error("missing lease");
    await expect(handler.act(prepared, ctx)).rejects.toThrow();
    await handler.record(db, item, prepared, { ok: false, errorName: "Error" }, ctx);
    expect(finish).toHaveBeenCalledWith(db, item, ctx, { status: "retry" });
  });
  it("중복 주문은 일반 장애로 덮어쓰지 않고 사장님 확인 상태로 남긴다", async () => {
    const finish = vi.fn(async () => {});
    const handler = createLedgerWriteHandler({
      claim: async () => row,
      finish,
      credential: async () => new Secret("token"),
      write: async () => ({ status: "auth_lost" }),
    });
    const db = {} as ShopDb,
      prepared = await handler.lease(db, item, ctx);
    if (!prepared) throw new Error("missing lease");
    await handler.record(db, item, prepared, { ok: false, errorName: "LedgerDuplicateError" }, ctx);
    expect(finish).toHaveBeenCalledWith(db, item, ctx, { status: "duplicate" });
  });
  it("실행기 외부 호출 시간 초과도 결과 불확실 상태로 남긴다", async () => {
    const finish = vi.fn(async () => {});
    const handler = createLedgerWriteHandler({
      claim: async () => row,
      finish,
      credential: async () => new Secret("token"),
      write: async () => ({ status: "auth_lost" }),
    });
    const db = {} as ShopDb,
      prepared = await handler.lease(db, item, ctx);
    if (!prepared) throw new Error("missing lease");
    await handler.record(db, item, prepared, { ok: false, errorName: "JobActTimeoutError" }, ctx);
    expect(finish).toHaveBeenCalledWith(db, item, ctx, { status: "uncertain" });
  });
});
