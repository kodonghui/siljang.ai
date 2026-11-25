import { expect, it } from "vitest";
import { deliverKakaoCallback } from "../src/kakao-callback";
import { kakaoConsultationMessage } from "../src/kakao-consultation-message";
import {
  expandKakaoMessageContents,
  type KakaoMessageContent,
  kakaoMessageTemplate,
} from "../src/kakao-message-content";
import { kakaoMyOrderMessage } from "../src/kakao-my-order-message";
import { expectSchema } from "./support/contract";
import { myOrderSummary as order } from "./support/kakao-my-order-cases";
import { paymentNormal } from "./support/kakao-payment-cases";

const content = (view: unknown) => ({ kind: "my_order", view }) as unknown as KakaoMessageContent;

it("내 주문의 공통 내용은 표시 함수와 같은 카드와 메시지 버튼을 보존한다", () => {
  const view = { state: "normal", order } as const;
  const body = kakaoConsultationMessage({ state: "normal", contents: [content(view)] });
  expectSchema("SkillTemplateResponse", body);
  expect(body).toEqual(kakaoMyOrderMessage(view));
});

it("공통 콜백 직렬화에서도 서버 주문 값과 주문 선택 바로가기를 보존한다", async () => {
  const view = {
    state: "normal",
    orders: [
      { orderNo: "AA000001", pickupAt: order.pickupAt, requestedAt: "2026-11-25T01:00:00Z" },
      { orderNo: "AA000002", pickupAt: order.pickupAt, requestedAt: "2026-11-25T02:00:00Z" },
    ],
    timeZone: "Asia/Seoul",
  } as const;
  const sent: unknown[] = [];
  const result = await deliverKakaoCallback(
    { url: new URL("https://bot-api.kakao.com/v1/callback/synthetic"), deadline: 10000 },
    [content(view)],
    {
      now: () => 100,
      fetch: async (_url, init) => {
        sent.push(JSON.parse(String(init.body)));
        return Response.json({ status: "SUCCESS" });
      },
    },
  );
  expect(result).toBe("delivered");
  expect(sent).toHaveLength(1);
  expectSchema("SkillTemplateResponse", sent[0]);
  expect(sent[0]).toEqual(kakaoMyOrderMessage(view));
  expect(sent[0]).toMatchObject({
    template: { quickReplies: [{ messageText: "AA000002 내 주문" }, { messageText: "AA000001 내 주문" }] },
  });
});

it("긴 내 주문의 여러 출력도 한 번만 펼쳐지고 세 출력 한도를 공통 경로에서 지킨다", () => {
  const view = {
    state: "normal",
    order: { ...order, contents: { ...order.contents, design: "합성".repeat(180) } },
  } as const;
  const body = kakaoMyOrderMessage(view);
  if (!("template" in body)) throw new Error("synthetic my order template missing");
  const expanded = expandKakaoMessageContents([content(view)]);
  expect(expanded).toHaveLength(body.template.outputs.length);
  expect(expandKakaoMessageContents(expanded)).toEqual(expanded);
  expect(kakaoMessageTemplate(expanded)).toEqual(body.template);
  expect(() => kakaoMessageTemplate([...expanded, "추가 답", "또 다른 답"])).toThrow();
});

it("표시 조각의 틀린 번호와 공통 경로의 로딩 내용은 전송 전에 거절한다", () => {
  expect(() => kakaoMessageTemplate([{ kind: "my_order", view: { state: "normal", order }, part: 999 }])).toThrow();
  expect(() => kakaoMessageTemplate([content({ state: "loading" })])).toThrow();
});

const choices = {
  state: "normal",
  orders: Array.from({ length: 10 }, (_, index) => ({
    orderNo: String(index).padStart(8, "A"),
    pickupAt: order.pickupAt,
    requestedAt: new Date(Date.parse("2026-11-25T00:00:00Z") + index * 1000).toISOString(),
  })),
  timeZone: "Asia/Seoul",
} as const;
const mixed: readonly KakaoMessageContent[] = [content(choices), { kind: "payment_notice", view: paymentNormal }];
it("주문 열 개와 결제 안내의 일반 응답은 결제 행동을 먼저 남겨 바로가기가 열 개다", () => {
  const body = kakaoConsultationMessage({ state: "normal", contents: mixed });
  expectSchema("SkillTemplateResponse", body);
  expect(body).toMatchObject({
    template: {
      quickReplies: [
        { messageText: "결제했어요" },
        ...[9, 8, 7, 6, 5, 4, 3, 2, 1].map((index) => ({
          messageText: [String(index).padStart(8, "A"), "내 주문"].join(" "),
        })),
      ],
    },
  });
  expect(JSON.stringify(body)).not.toContain("AAAAAAA0 내 주문");
});
it("주문 선택을 보일 때 날짜 추천을 합쳐도 최종 바로가기는 열 개다", () => {
  const body = kakaoConsultationMessage({
    state: "normal",
    contents: [content(choices)],
    suggestedDays: ["2026-11-27", "2026-11-28", "2026-11-29"],
  });
  expectSchema("SkillTemplateResponse", body);
  expect(body).toMatchObject({
    template: {
      quickReplies: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((index) => ({
        messageText: [String(index).padStart(8, "A"), "내 주문"].join(" "),
      })),
    },
  });
});
it("혼합 콜백도 결제와 최근 주문 아홉 개만 실제 직렬화한다", async () => {
  let sent: unknown;
  expect(
    await deliverKakaoCallback(
      { url: new URL("https://bot-api.kakao.com/v1/callback/synthetic"), deadline: 10000 },
      mixed,
      {
        now: () => 100,
        fetch: async (_url, init) => {
          sent = JSON.parse(String(init.body));
          return Response.json({ status: "SUCCESS" });
        },
      },
    ),
  ).toBe("delivered");
  expectSchema("SkillTemplateResponse", sent);
  expect(sent).toMatchObject({
    template: {
      quickReplies: [
        { messageText: "결제했어요" },
        ...[9, 8, 7, 6, 5, 4, 3, 2, 1].map((index) => ({
          messageText: [String(index).padStart(8, "A"), "내 주문"].join(" "),
        })),
      ],
    },
  });
});
