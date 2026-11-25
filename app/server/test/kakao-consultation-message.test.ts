import { describe, expect, it } from "vitest";
import { kakaoConsultationMessage, kakaoQuoteMessage } from "../src/kakao-consultation-message";
import { expectSchema } from "./support/contract";

const card = {
  title: "주문 요청",
  description: "서버가 확인한 주문 요약",
  confirmLabel: "주문 요청",
  blockId: "synthetic-confirm",
  cardKey: "synthetic_card_key_1234",
};
function texts(body: unknown): string {
  return JSON.stringify(body);
}

describe("SCR-003 상담의 카카오 응답(TASK-085)", () => {
  it.each([
    [{ state: "normal", contents: ["가게 규칙으로 확인한 답"] }, "가게 규칙으로 확인한 답"],
    [{ state: "loading" }, "답을 준비하고 있어요"],
    [{ state: "empty" }, "다시 한번 말씀해 주시겠어요?"],
    [{ state: "error", reason: "photo_download_failed" }, "사진을 받지 못했어요. 다시 보내 주세요"],
    [
      { state: "permission", contactPhone: "02-000-0000" },
      "아직 상담을 받지 않아요. 가게로 연락해 주세요: 02-000-0000",
    ],
    [{ state: "stale", contents: ["가격표가 바뀌어 지금 금액은 38,000원이에요. 이 금액으로 주문할까요?"] }, "38,000원"],
    [{ state: "handed-over", recommendChannel: true }, "채널을 추가하시면 답을 바로 받아 보실 수 있어요"],
    [{ state: "fixed-answer" }, "이 가게 주문 상담만 도와드려요"],
    [{ state: "rate-limited" }, "잠시 뒤 다시 말씀해 주세요"],
    [
      { state: "link-test", mode: "initial", next: "card", blockId: "synthetic-confirm" },
      "시험 버튼 5개를 하나씩 눌러 주세요",
    ],
  ] as const)("%j 상태는 정의된 문구와 계약을 지킨다", (view, expected) => {
    const body = kakaoConsultationMessage(view);
    expect(texts(body)).toContain(expected);
    expectSchema("SkillResponse", body);
  });

  it("견적의 금액·표시 방식·기한만 내보내고 내부 근거와 남은 자리를 보이지 않는다", () => {
    const quote = { amount: 35000, amountMax: null, displayKind: "fixed" as const, validUntil: "2026-11-28T06:00:00Z" };
    const body = kakaoQuoteMessage(quote, "Asia/Seoul");
    expect(texts(body)).toContain("35,000원");
    expect(texts(body)).toContain("11월 28일 15:00");
    expect(texts(body)).toContain("견적만으로 그날 자리를 잡아 두지는 않아요");
    expectSchema("SkillTemplateResponse", body);
  });

  it.each([
    [{ amount: 35000, amountMax: null, displayKind: "from" as const }, "35,000원부터"],
    [{ amount: 35000, amountMax: 45000, displayKind: "range" as const }, "35,000~45,000원"],
  ])("견적 표시 방식 %j을 바꾸지 않는다", (money, expected) => {
    const body = kakaoQuoteMessage({ ...money, validUntil: "2026-11-28T06:00:00Z" }, "Asia/Seoul", {
      custom: true,
      renewed: true,
    });
    expect(texts(body)).toContain(expected);
    expect(texts(body)).toContain("사장님이 보고 금액을 정해 수락해야 결제 안내가 가요");
    expect(texts(body)).toContain("이 금액으로 주문할까요?");
    expect(texts(body)).not.toContain("cardKey");
    expectSchema("SkillTemplateResponse", body);
  });

  it("서버가 고른 가까운 날 세 개만 연도 있는 메시지 바로가기로 보낸다", () => {
    const body = kakaoConsultationMessage({
      state: "normal",
      contents: ["20일은 마감됐어요. 이날은 어떠세요?"],
      suggestedDays: ["2026-11-19", "2026-11-21", "2026-11-22"],
    });
    expect(body).toMatchObject({
      template: {
        quickReplies: [
          { action: "message", label: "11월 19일", messageText: "2026-11-19" },
          { action: "message", label: "11월 21일", messageText: "2026-11-21" },
          { action: "message", label: "11월 22일", messageText: "2026-11-22" },
        ],
      },
    });
    expectSchema("SkillTemplateResponse", body);
    expect(() =>
      kakaoConsultationMessage({
        state: "normal",
        contents: ["날짜 안내"],
        suggestedDays: ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"],
      }),
    ).toThrow();
    expect(() =>
      kakaoConsultationMessage({ state: "normal", contents: ["날짜 안내"], suggestedDays: ["2026-02-30"] }),
    ).toThrow();
  });

  it("카드 앞 안내를 보존하고 출력3개·제목/설명 합400자에서 끊는다", () => {
    const body = kakaoConsultationMessage({ state: "normal", contents: ["AI 상담 고지", "취소·환불 규정", card] });
    expectSchema("SkillTemplateResponse", body);
    expect(() => kakaoConsultationMessage({ state: "normal", contents: ["첫째", "둘째", "셋째", card] })).toThrow();
    expect(() =>
      kakaoConsultationMessage({ state: "normal", contents: [{ ...card, description: "가".repeat(399) }] }),
    ).toThrow();
  });

  it("중복과 같은 제한 구간의 뒤 요청은 빈 출력이고, 빈 AI 답의 질문과 구분한다", () => {
    for (const view of [
      { state: "normal", contents: [], silent: true },
      { state: "rate-limited", silent: true },
    ] as const) {
      expect(kakaoConsultationMessage(view)).toEqual({ version: "2.0", template: { outputs: [] } });
    }
    expect(texts(kakaoConsultationMessage({ state: "empty" }))).toContain("다시 한번");
    expect(() => kakaoConsultationMessage({ state: "normal", contents: [] })).toThrow();
  });

  it("이미 닿은 시험 블록과 다음 버튼을 분리하고 주문용 키를 만들지 않는다", () => {
    const body = kakaoConsultationMessage({
      state: "link-test",
      mode: "verified",
      completed: "allergy_answer",
      verifiedCount: 3,
      next: "depositor_name",
      blockId: "synthetic-depositor",
    });
    expect(texts(body)).toContain("알레르기 답 블록이 닿았어요(3/5)");
    expect(texts(body)).toContain("시험: 입금자 이름");
    expect(texts(body)).not.toContain("cardKey");
    expectSchema("SkillTemplateResponse", body);
  });
});
