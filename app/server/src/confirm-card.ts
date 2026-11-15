/**
 * 손님 확인 카드의 묶임(04 G9, SPEC-069, 05 TBL-024 confirm_cards). TASK-018은 판단의 바탕만 둔다.
 * 카드는 그 상담·그 사용자·그 주문(또는 초안)의 지금 버전과 30분 기한에 묶인다. 버전이 바뀌었거나 기한이 지난 카드는
 * 거절하고 새 카드를 보낸다. 한 카드는 한 번만 명령을 내린다(G2).
 * 카드를 만들고 보내는 일, 누름을 confirm_cards에 남기는 일(used_at·outcome을 한 번만)은 TASK-081(SPEC-069)이 한다.
 */

/** 카드 기한: 보낸 뒤 30분(05 confirm_cards_expiry_chk). */
export const CARD_TTL_MS = 30 * 60_000;

/** 보낸 시각으로 기한을 정한다. */
export function cardExpiresAt(sentAt: Date): Date {
  return new Date(sentAt.getTime() + CARD_TTL_MS);
}

/** confirm_cards 행에서 판단에 쓰는 값. 주문 카드는 order*, 주문 요청·주문자 정보·알레르기 정보 카드는 draft*가 있다. */
export interface CardBinding {
  readonly consultationId: string;
  readonly customerId: string;
  readonly orderId: string | null;
  readonly orderVersion: number | null;
  readonly draftId: string | null;
  readonly draftRevision: number | null;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
}

/** 누른 때의 사실: 누른 사용자·그 대화의 상담, 지금 주문 버전·초안 고친 번호(카드에 묶인 것만 견줌). */
export interface CardPress {
  readonly consultationId: string;
  readonly customerId: string;
  readonly now: Date;
  readonly currentOrderVersion?: number | null;
  readonly currentDraftRevision?: number | null;
}

/**
 * ok: 명령을 내림. not_recipient: 카드를 받은 사용자·상담이 아님(명령 없음). used: 이미 누른 카드(명령 없음, G2).
 * expired: 30분이 지남(outcome 'expired', 새 카드). stale: 묶인 버전이 바뀜(outcome 'stale', 새 카드).
 */
export type CardVerdict = "ok" | "not_recipient" | "used" | "expired" | "stale";

export function judgeCardPress(card: CardBinding, press: CardPress): CardVerdict {
  if (card.customerId !== press.customerId || card.consultationId !== press.consultationId) return "not_recipient";
  if (card.usedAt !== null) return "used";
  if (press.now.getTime() >= card.expiresAt.getTime()) return "expired";
  if (card.orderId !== null && card.orderVersion !== press.currentOrderVersion) return "stale";
  if (card.draftId !== null && card.draftRevision !== press.currentDraftRevision) return "stale";
  return "ok";
}
