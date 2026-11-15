import { describe, expect, it } from "vitest";
import { type CardBinding, cardExpiresAt, judgeCardPress } from "../src/confirm-card";

// 04 G9·SPEC-069: 카드는 그 상담·그 사용자·그 주문의 지금 버전과 30분 기한에 묶인다.
const sent = new Date("2026-11-16T03:00:00Z");
const card: CardBinding = {
  consultationId: "c-1",
  customerId: "u-1",
  orderId: "o-1",
  orderVersion: 2,
  draftId: null,
  draftRevision: null,
  expiresAt: cardExpiresAt(sent),
  usedAt: null,
};
const press = {
  consultationId: "c-1",
  customerId: "u-1",
  now: new Date("2026-11-16T03:10:00Z"),
  currentOrderVersion: 2,
};

describe("손님 확인 카드 판단", () => {
  it("기한은 보낸 뒤 30분", () => {
    expect(cardExpiresAt(sent).toISOString()).toBe("2026-11-16T03:30:00.000Z");
  });

  it("받은 사용자가 기한 안에 같은 버전에서 누르면 ok", () => {
    expect(judgeCardPress(card, press)).toBe("ok");
  });

  it("버전 2로 만든 카드를 버전 3에서 누르면 stale(새 카드)", () => {
    expect(judgeCardPress(card, { ...press, currentOrderVersion: 3 })).toBe("stale");
  });

  it("30분이 지나면 expired(30분 정각 포함)", () => {
    expect(judgeCardPress(card, { ...press, now: new Date("2026-11-16T03:30:00Z") })).toBe("expired");
  });

  it("다른 사용자나 다른 상담은 not_recipient, 이미 누른 카드는 used", () => {
    expect(judgeCardPress(card, { ...press, customerId: "u-2" })).toBe("not_recipient");
    expect(judgeCardPress(card, { ...press, consultationId: "c-2" })).toBe("not_recipient");
    expect(judgeCardPress({ ...card, usedAt: new Date("2026-11-16T03:05:00Z") }, press)).toBe("used");
  });

  it("초안에 묶인 카드(주문 요청·주문자 정보·알레르기 정보)는 초안 고친 번호를 견줌", () => {
    const draftCard = { ...card, orderId: null, orderVersion: null, draftId: "d-1", draftRevision: 4 };
    expect(judgeCardPress(draftCard, { ...press, currentDraftRevision: 4 })).toBe("ok");
    expect(judgeCardPress(draftCard, { ...press, currentDraftRevision: 5 })).toBe("stale");
  });
});
