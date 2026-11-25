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
