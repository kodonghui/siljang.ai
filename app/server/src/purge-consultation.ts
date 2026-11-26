import type { ShopDb } from "./shop-scope";

/** SPEC-065 #2. 범위/보관 조건·잠금·내용/삭제 대기를 DB 함수의 같은 트랜잭션에서 처리한다. */
export async function purgeConsultation(db: ShopDb, consultationId: string, now: Date): Promise<number> {
  if (Number.isNaN(now.getTime())) throw new RangeError("invalid purge cutoff");
  const result = await db.found<{ purged: number }>("SELECT public.purge_closed_consultation($1,$2,$3) AS purged", [
    consultationId,
    now,
  ]);
  return result.purged;
}
