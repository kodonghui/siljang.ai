import { ApiError } from "./problem";
import type { ShopDb } from "./shop-scope";
export interface LedgerUnlinkStored {
  readonly outcome: "done" | "unchanged";
  readonly linkId: string;
  readonly keptWrites: number;
}
/** HTTP/시크릿 삭제 연결 전에 검사하는 가게 범위의 연결 해제 기록 처리. */
export async function unlinkLedgerRecord(db: ShopDb, now: Date): Promise<LedgerUnlinkStored> {
  if (!Number.isFinite(now.getTime())) throw new RangeError("invalid ledger unlink clock");
  if (db.scope.via.kind !== "owner") throw new ApiError("unauthenticated");
  const row = (
    await db.run<{ outcome: "done" | "unchanged"; link_id: string; kept_writes: number }>(
      "SELECT * FROM public.unlink_owner_ledger($1,$2,$3)",
      [db.scope.via.ownerId, now],
    )
  ).rows[0];
  if (row === undefined) throw new ApiError("not_set");
  return { outcome: row.outcome, linkId: row.link_id, keptWrites: row.kept_writes };
}
