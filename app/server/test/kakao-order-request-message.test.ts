import { describe, expect, it } from "vitest";
import { kakaoOrderRequestMessage, kakaoOrderTerms } from "../src/kakao-order-request-message";
import { expectSchema } from "./support/contract";

const card = {
  title: "주문 요청 확인",
  description:
    "픽업 2026-11-28 15:00\n합성 주문자 · 010-0000-0000\n문구: Happy 🎂 Day\n알레르기 정보 동의 안 함\n금액 35,000원\n15:30까지 눌러 주세요",
  confirmLabel: "규정에 동의하고 주문 요청",
  blockId: "synthetic-card",
  cardKey: "synthetic_order_card_1234",
};
const policy = {
  version: 3,
  clauses: [{ title: "제작 전 취소", condition: "제작 시작 전", effect: "취소 수수료를 빼고 환불" }],
};
const blocks = { cardKey: card.cardKey, answerBlockId: "synthetic-allergy", cardBlockId: card.blockId };
const text = (body: unknown) => JSON.stringify(body);

describe("SCR004 주문 요청의9상태 표시(TASK-086)", () => {
  it("그 운영규정 버전과 두 법률 고지를 카드보다 먼저 보내며 원문 문구를 보존한다", () => {
    const body = kakaoOrderRequestMessage({ state: "normal", policy, card, isFriend: false });
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs[0]).toMatchObject({
      simpleText: { text: expect.stringContaining("운영규정 버전 3") },
    });
    expect(text(body)).toContain("· 제작 전 취소: 제작 시작 전 → 취소 수수료를 빼고 환불");
    expect(text(body)).toContain("주문제작이라 청약철회가 제한될 수 있어요");
    expect(text(body)).toContain("미성년자가 법정대리인의 동의 없이 한 주문은 본인이나 법정대리인이 취소할 수 있어요");
    expect(body.template.outputs.at(-1)).toMatchObject({
      textCard: {
        description: expect.stringContaining("Happy 🎂 Day"),
        buttons: [{ label: card.confirmLabel }, { label: "안 할래요" }],
      },
    });
    expect(text(body)).not.toContain("사진 게시");
    expect(text(body)).toContain("채널을 추가하면 결제 안내와 사장님 답을 바로 받아요");
  });
  it("긴 규정은 조문 경계에서 두 글로 나누고 두 고지는 둘째 끝에 함께 둔다", () => {
    const clauses = Array.from({ length: 6 }, (_, i) => ({
      title: `조문${i}`,
      condition: "조".repeat(130),
      effect: "효".repeat(130),
    }));
    const terms = kakaoOrderTerms({ version: 9, clauses });
    expect(terms).toHaveLength(2);
    expect(terms[0]).toContain("1/2");
    expect(terms[1]).toContain("2/2");
    expect(terms[0]).not.toContain("미성년자");
    expect(terms[1]).toMatch(/미성년자가.*취소할 수 있어요$/);
    for (const clause of clauses)
      expect(
        terms.filter((part) => part.includes(`· ${clause.title}: ${clause.condition} → ${clause.effect}`)),
      ).toHaveLength(1);
    const body = kakaoOrderRequestMessage({ state: "normal", card, policy: { version: 9, clauses }, isFriend: true });
    expect(body.template.outputs).toHaveLength(3);
    expectSchema("SkillTemplateResponse", body);
    for (const part of terms) expect([...part].length).toBeLessThanOrEqual(1000);
  });
  it("한도를 넘는 조문이나 요약을 잘라서 합의 내용을 바꾸지 않는다", () => {
    expect(() =>
      kakaoOrderTerms({ version: 1, clauses: [{ title: "취소", condition: "가".repeat(1000), effect: "환불" }] }),
    ).toThrow();
    expect(() =>
      kakaoOrderRequestMessage({
        state: "normal",
        card: { ...card, description: "알".repeat(400) },
        policy,
        isFriend: false,
      }),
    ).toThrow();
  });
  it("카드에 자리가 없으면 채널 권유만 생략하고 주문 요청은 계속 허용한다", () => {
    const body = kakaoOrderRequestMessage({
      state: "normal",
      card: { ...card, description: "가".repeat(380) },
      policy,
      isFriend: false,
    });
    expect(text(body)).not.toContain("채널을 추가하면");
    expect(text(body)).toContain(card.confirmLabel);
    expectSchema("SkillTemplateResponse", body);
  });
  it("알레르기 동의에는 목적·항목·보는 사람·30일 삭제와 별도 거절 버튼을 표시한다", () => {
    const body = kakaoOrderRequestMessage({ state: "allergy", mode: "consent", ...blocks });
    expectSchema("SkillTemplateResponse", body);
    for (const value of [
      "이 주문의 케이크 만들기",
      "알레르기가 있는 재료",
      "이 가게 사장님",
      "주문이 끝나고 30일 뒤",
      "동의하지 않아도 돼요",
    ])
      expect(text(body)).toContain(value);
    expect(body.template.outputs[0]).toMatchObject({
      textCard: {
        buttons: [
          {
            label: "동의하고 알려 주기",
            blockId: blocks.answerBlockId,
            extra: { cardKey: card.cardKey, choice: "confirm" },
          },
          { label: "동의 안 함", blockId: card.blockId, extra: { choice: "decline" } },
        ],
      },
    });
  });
  it.each(["answer", "invalid"] as const)("동의 단계를 끄거나 잘못된 알레르기 답이면 답 블록만 연다: %s", (mode) => {
    const body = kakaoOrderRequestMessage({ state: "allergy", mode, ...blocks });
    expect(text(body)).toContain("알레르기가 있는 재료를 200자까지 알려 주세요(없으면 없음)");
    expect(text(body)).not.toContain("동의 안 함");
    expect(body.template.outputs[0]).toMatchObject({ textCard: { buttons: [{ label: "알레르기 알려 주기" }] } });
    expectSchema("SkillTemplateResponse", body);
  });
  it("주문자 입력 오류는 두 입력 범위와 같은 블록 버튼을 다시 보낸다", () => {
    const body = kakaoOrderRequestMessage({
      state: "orderer",
      invalid: true,
      cardKey: card.cardKey,
      blockId: "synthetic-orderer",
    });
    expect(text(body)).toContain("이름은 1~30자, 연락처는 숫자와 '-'로 8~14자로 넣어 주세요");
    expect(text(body)).toContain("이름·연락처 넣기");
    expectSchema("SkillTemplateResponse", body);
  });
  it.each(["stale", "expired"] as const)("%s는 새 규정과 새 카드로 다시 확인받는다", (state) => {
    const body = kakaoOrderRequestMessage({ state, policy, card, isFriend: true });
    expect(body.template.outputs[0]).toHaveProperty("simpleText");
    expect(body.template.outputs.at(-1)).toMatchObject({
      textCard: {
        description: expect.stringContaining(
          state === "stale" ? "내용이 바뀌었어요. 새 카드를 확인해 주세요" : "시간이 지나 새 카드를 보내 드려요",
        ),
      },
    });
    expectSchema("SkillTemplateResponse", body);
  });
  it("다 찬 날의 가까운 날짜는 세 개까지이며 메시지에는 연도를 남긴다", () => {
    const body = kakaoOrderRequestMessage({
      state: "day-full",
      suggestedDays: ["2026-12-30", "2026-12-31", "2027-01-01"],
    });
    expect(text(body)).toContain("그 사이 그날이 다 찼어요. 이날은 어떠세요?");
    expect(body.template.quickReplies).toHaveLength(3);
    expect(body.template.quickReplies?.[2]?.messageText).toBe("2027-01-01");
    expectSchema("SkillTemplateResponse", body);
    expect(() => kakaoOrderRequestMessage({ state: "day-full", suggestedDays: ["2026-02-30"] })).toThrow();
    expect(() =>
      kakaoOrderRequestMessage({ state: "day-full", suggestedDays: ["2026-12-30", "2026-12-30"] }),
    ).toThrow();
  });
  it("대체 날짜가 없으면 자리 확보 없이 사장님 확인을 안내한다", () => {
    const body = kakaoOrderRequestMessage({ state: "day-full", suggestedDays: [] });
    expect(text(body)).toContain("가까운 날에 자리가 없어요. 사장님께 확인을 요청할 수 있어요");
    expectSchema("SkillTemplateResponse", body);
  });
  it("기본 디자인 주문은 결제 확인 전임을 알리고 서버 결제 안내를 뒤에 보낸다", () => {
    const body = kakaoOrderRequestMessage({
      state: "done",
      kind: "standard",
      orderNo: "A1B2C3D4",
      isFriend: true,
      payment: ["합성 가게 계좌 · 입금 뒤 결제를 알려 주세요"],
    });
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs).toHaveLength(2);
    expect(text(body)).toContain("결제가 확인되면 확정돼요");
    expect(text(body)).toContain("A1B2C3D4");
    expect(() =>
      kakaoOrderRequestMessage({ state: "done", kind: "standard", orderNo: "ABC123", isFriend: true, payment: [] }),
    ).toThrow();
  });
  it("사용한 카드에는 저장한 첫 결과를 다시 표시한다", () => {
    const body = kakaoOrderRequestMessage({
      state: "done",
      kind: "used",
      firstResult: {
        outcome: "card_used",
        text: "이미 처리했어요",
        firstResult: {
          outcome: "order_requested",
          text: "주문을 요청했어요(주문번호 ABC123). 사장님이 보고 알려 드릴게요",
        },
      },
    });
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs).toHaveLength(2);
    expect(text(body)).toContain("ABC123");
  });
  it("알레르기 거절 뒤 긴 규정과 요약도 출력3개 안에 두고 두 법률 고지를 보존한다", () => {
    const clauses = Array.from({ length: 6 }, (_, i) => ({
      title: `조문${i}`,
      condition: "조".repeat(120),
      effect: "효".repeat(120),
    }));
    const body = kakaoOrderRequestMessage({
      state: "normal",
      policy: { version: 7, clauses },
      card,
      isFriend: true,
      afterAllergyDeclined: true,
    });
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs).toHaveLength(3);
    expect(text(body)).toContain("알레르기는 묻지 않고 빼야 할 재료만으로 주문을 이어갈게요");
    expect(body.template.outputs[1]).toMatchObject({
      simpleText: { text: expect.stringMatching(/미성년자가.*취소할 수 있어요$/) },
    });
  });
  it.each([
    [{ state: "permission", reason: "card_not_yours" }, "이 버튼은 카드를 받은 분만 누를 수 있어요"],
    [{ state: "permission", reason: "not_accepting", contactPhone: "02-000-0000" }, "02-000-0000"],
    [{ state: "error", reason: "retry_needed" }, "다시 눌러 주세요"],
    [{ state: "error", reason: "server_error" }, "잠시 뒤 다시 말씀해 주세요"],
    [{ state: "stale", currentStatus: "제작 중" }, "지금은 할 수 없어요: 제작 중"],
    [{ state: "done", kind: "declined" }, "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"],
    [{ state: "done", kind: "order-limit" }, "사장님이 확인한 뒤 알려 드릴게요"],
    [{ state: "done", kind: "custom", orderNo: "ABC123", isFriend: false }, "사장님이 보고 알려 드릴게요"],
  ] as const)("%j 상태의 고정 문구와 SDK 계약을 지킨다", (view, expected) => {
    const body = kakaoOrderRequestMessage(view);
    expect(text(body)).toContain(expected);
    expectSchema("SkillTemplateResponse", body);
  });
});
