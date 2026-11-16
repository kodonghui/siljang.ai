/**
 * 05 A11 사진 장수(TASK-022; SPEC-019·053·057·062).
 * - 신고·완성·후기 사진의 5장은 데이터베이스가 막는다: 순서 컬럼 position이 1~5(CHECK, 넘으면 23514)이고 같은 신고 내용·
 *   제작·후기 안에서 순서가 겹치지 않는다(UNIQUE). 앱은 세지 않는다(test/photo-count.test.ts가 데이터베이스로 확인).
 * - 참고 사진의 상담마다 10장(SPEC-019)은 여러 메시지의 행을 세야 해서 앱이 센다: 상담 행을 잠그고(같은 상담에 동시에
 *   온 사진을 차례로 셈) 그 상담의 메시지에 붙은 참고 사진을 센다. 참고 사진을 받는 작업(TASK-065, 카카오)이 사진 행을
 *   넣는 같은 트랜잭션에서 이 도구를 부르고, 남은 수보다 많이 오면 넘는 사진은 받지 않고 이유를 알린다(SPEC-019).
 */
import type { ShopDb } from "./shop-scope";

/** 상담 하나에 붙일 수 있는 참고 사진(SPEC-019). */
export const REFERENCE_PHOTOS_PER_CONSULTATION = 10;

/**
 * 상담에 더 붙일 수 있는 참고 사진 수(0~10). 가게 범위 연결의 트랜잭션 안에서 부른다(상담 행을 FOR UPDATE로 잡음).
 * 다른 가게의 상담이나 없는 상담은 404 not_found(06 DEC-02).
 */
export async function referencePhotoRoom(tx: ShopDb, consultationId: string): Promise<number> {
  const id = await tx.owned("consultations", consultationId, { lock: true });
  const counted = await tx.found<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM reference_photos p
       JOIN messages m ON m.shop_id = p.shop_id AND m.id = p.message_id
      WHERE p.shop_id = $1 AND m.consultation_id = $2`,
    [id],
  );
  return Math.max(0, REFERENCE_PHOTOS_PER_CONSULTATION - counted.n);
}
