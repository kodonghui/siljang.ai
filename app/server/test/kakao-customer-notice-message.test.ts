import { expect, it } from "vitest";
import { type KakaoCustomerNoticeView, kakaoCustomerNoticeMessage } from "../src/kakao-customer-notice-message";
import { expectSchema } from "./support/contract";
import { customerNoticePhotoAsk as ask, customerNoticePhotos as photos } from "./support/kakao-customer-notice-cases";

it.each([
  { text: "가".repeat(1000), regulation: ["나".repeat(1000), "다".repeat(1000)] },
  { text: "가".repeat(1250), regulation: ["나".repeat(600), "다".repeat(600)] },
])("저장된 확정 사실과 두 규정을 자르지 않고 세 출력에 보존한다", (notice) => {
  const body = kakaoCustomerNoticeMessage({ state: "normal", notice: { kind: "order_confirmed_saved", ...notice } });
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs).toHaveLength(3);
  const whole = body.template.outputs.map((o) => ("simpleText" in o ? o.simpleText.text : "")).join("");
  for (const char of ["가", "나", "다"])
    expect([...whole].filter((c) => c === char)).toHaveLength(
      [...notice.text, ...notice.regulation.join("")].filter((c) => c === char).length,
    );
});

it.each([`${"가".repeat(1000)}\n`, `${" ".repeat(1000)}가`, `${"🍰".repeat(1000)}\u3000`])(
  "분할한 공백 조각도 전체 원문의 일부로 보존한다",
  (text) => {
    const body = kakaoCustomerNoticeMessage({ state: "normal", notice: { kind: "server_text", text } });
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs.map((o) => ("simpleText" in o ? o.simpleText.text : "")).join("")).toBe(text);
  },
);

it("사장님 답은 원문의 공백과 줄바꿈을 그대로 전하고 AI가 고치지 않는다", () => {
  const text = "  합성 사장님 답이에요.\n\n확인한 뒤 안내드릴게요.  ";
  const body = kakaoCustomerNoticeMessage({ state: "normal", notice: { kind: "owner_reply", text } });
  expectSchema("SkillTemplateResponse", body);
  expect(body).toEqual({ version: "2.0", template: { outputs: [{ simpleText: { text } }] } });
});

const render = (view: unknown) => kakaoCustomerNoticeMessage(view as KakaoCustomerNoticeView);
it.each([
  [{ state: "normal", notice: { kind: "delay_notice" } }, "사장님 확인이 늦어지고 있어요"],
  [{ state: "normal", notice: { kind: "no_answer_closed", target: "custom" } }, "주문 요청이 닫혔어요"],
  [{ state: "normal", notice: { kind: "no_answer_closed", target: "change" } }, "주문은 원래대로예요"],
  [{ state: "normal", notice: { kind: "no_answer_closed", target: "handoff" } }, "필요하시면 다시 물어봐 주세요"],
  [{ state: "deferred", notice: { kind: "owner_reply", text: "합성 전달할 사장님 답" } }, "합성 전달할 사장님 답"],
  [{ state: "stale", reason: "gone" }, "지금은 전할 안내가 없어요"],
])("%j의 정해진 안내를 보인다", (view, text) => {
  const body = render(view);
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain(text);
});

it("금액 불일치 안내에는 서버 입력에 들어온 금액이 있어도 보이지 않는다", () => {
  const body = render({ state: "normal", notice: { kind: "payment_mismatch", receivedAmount: 12345 } });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain("보내신 금액이 안내와 달라 사장님이 연락드릴게요");
  expect(JSON.stringify(body)).not.toContain("12345");
  expect(JSON.stringify(body)).not.toContain("12,345");
});

it("전날 안내는 서버 픽업 시각과 위치 또는 연락처를 보인다", () => {
  const input = {
    kind: "day_before",
    orderNo: "AB1234CD",
    pickupAt: "2026-11-27T05:00:00Z",
    timeZone: "Asia/Seoul",
    contactPhone: "02-000-0000",
  };
  const without = render({ state: "normal", notice: input });
  const located = render({ state: "normal", notice: { ...input, location: "합성 픽업 장소" } });
  expectSchema("SkillTemplateResponse", without);
  expect(JSON.stringify(without)).toContain("11월 27일 14:00");
  expect(JSON.stringify(without)).toContain("02-000-0000");
  expect(JSON.stringify(without)).not.toContain("undefined");
  expect(JSON.stringify(located)).toContain("합성 픽업 장소");
});

it("확정 안내는 확인한 금액과 가게 신원/내용 뒤 그 주문의 규정 글을 따로 보인다", () => {
  const regulation = "합성 주문의 취소·환불 규정 원문";
  const body = render({
    state: "normal",
    notice: {
      kind: "order_confirmed",
      orderNo: "AB1234CD",
      summary: "1호 생크림 합성 디자인",
      pickupAt: "2026-11-27T05:00:00Z",
      timeZone: "Asia/Seoul",
      paidAmount: 36000,
      identity: {
        businessName: "합성 상호",
        representativeName: "합성 대표",
        address: "합성 사업장 주소",
        contactPhone: "02-000-0000",
      },
      regulation,
    },
  });
  expectSchema("SkillTemplateResponse", body);
  expect(body).toMatchObject({ template: { outputs: [{ simpleText: {} }, { simpleText: { text: regulation } }] } });
  for (const fact of [
    "AB1234CD",
    "1호 생크림",
    "36,000원",
    "11월 27일 14:00",
    "합성 상호",
    "합성 대표",
    "합성 사업장 주소",
    "02-000-0000",
  ])
    expect(JSON.stringify(body)).toContain(fact);
});

it("완성 사진5장과 원본 비율/대체 글·동의 카드가 출력3개 안에 함께 온다", () => {
  const body = render(ask);
  expectSchema("SkillTemplateResponse", body);
  expect(body).toMatchObject({
    template: {
      outputs: [
        {
          carousel: {
            type: "basicCard",
            items: photos.map((photo) => ({
              thumbnail: { imageUrl: photo.url, altText: photo.altText, fixedRatio: true },
            })),
          },
        },
        { simpleText: { text: "바꾸고 싶으시면 말씀해 주세요" } },
        {
          textCard: {
            buttons: [
              {
                label: "올려도 돼요",
                action: "block",
                blockId: ask.blockId,
                extra: { cardKey: ask.cardKey, choice: "confirm" },
              },
              {
                label: "안 돼요",
                action: "block",
                blockId: ask.blockId,
                extra: { cardKey: ask.cardKey, choice: "decline" },
              },
            ],
          },
        },
      ],
    },
  });
  expect(JSON.stringify(body)).toContain("15:30까지 눌러 주세요");
  expect(JSON.stringify(body)).toContain("언제든 철회");
});

it("사진 게시 동의의 처음 저장 결과는 다시 묻거나 다른 사진을 드러내지 않는다", () => {
  const body = render({ ...ask, mode: "saved", customerId: "synthetic_private_customer_id" });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain("알려 주셔서 고마워요. 사진 게시 동의는 언제든 철회할 수 있어요");
  expect(JSON.stringify(body)).not.toContain("photos.example");
  expect(JSON.stringify(body)).not.toContain("synthetic_private_customer_id");
});

it("의미 없어진 안내와 발송 오류는 손님에게 오류 본문을 만들지 않는다", () => {
  expect(render({ state: "stale", reason: "meaningless" })).toBeNull();
  expect(render({ state: "error" })).toBeNull();
});
