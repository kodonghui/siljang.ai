import { ApiError } from "./problem";
import type { ShopDb } from "./shop-scope";
export interface LedgerUnlinkStored {
  readonly outcome: "done" | "unchanged";
  readonly linkId: string;
  readonly keptWrites: number;
}
/** HTTP/시크릿 삭제 연결 전에 검사하는 가게 범위의 연결 해제 기록 처리. */
export async function unlinkLedgerRecord(_db: ShopDb, _now: Date): Promise<LedgerUnlinkStored> {
  throw new ApiError("not_set");
}
