import { expect, it } from "vitest";
import { deliverKakaoCallback } from "../src/kakao-callback";
import { kakaoConsultationMessage } from "../src/kakao-consultation-message";
import { renderDeferredKakaoReply } from "../src/kakao-deferred";
import {
  expandKakaoMessageContents,
  type KakaoMessageContent,
  kakaoMessageOutputs,
} from "../src/kakao-message-content";
import { kakaoOrderRequestMessage } from "../src/kakao-order-request-message";
import { expectSchema } from "./support/contract";

const notice = {
  kind: "payment_notice",
  view: {
    state: "normal",
    kind: "first",
    orderNo: "AB1234CD",
    amount: 35000,
    account: { bankName: "합성은행", number: "123456789012", holderName: "합성가게" },
    dueAt: "2026-11-25T12:00:00Z",
    timeZone: "Asia/Seoul",
    cardPaymentUrl: "https://payment.example/synthetic",
  },
} as const;
const reply = (previous: readonly KakaoMessageContent[]) =>
  Response.json(kakaoConsultationMessage({ state: "normal", contents: [...previous, "현재 합성 답"] }));

it("결제 안내는 공통 내용에서 두 출력으로 펼쳐지고 다시 펼쳐도 같으며 은행을 보존한다", () => {
  const expanded = expandKakaoMessageContents([notice]);
  expect(expanded).toHaveLength(2);
  expect(expandKakaoMessageContents(expanded)).toEqual(expanded);
  const outputs = kakaoMessageOutputs([...expanded, "현재 합성 답"]);
  expectSchema("SkillTemplateResponse", { version: "2.0", template: { outputs } });
  expect(outputs).toHaveLength(3);
  expect(JSON.stringify(outputs)).toContain("123456789012");
  expect(JSON.stringify(outputs)).toContain("현재 합성 답");
  expect(() => kakaoMessageOutputs([...expanded, "추가 합성 답", "현재 합성 답"])).toThrow();
});

it("상담과 주문 요청 결과에도 결제했어요 바로가기를 한 번 보존한다", () => {
  const bodies = [
    kakaoConsultationMessage({ state: "normal", contents: [notice, "현재 합성 답"], suggestedDays: ["2026-11-26"] }),
    kakaoOrderRequestMessage({
      state: "done",
      kind: "standard",
      orderNo: "AB1234CD",
      isFriend: true,
      payment: [notice],
    }),
  ];
  for (const body of bodies) {
    expectSchema("SkillTemplateResponse", body);
    expect(JSON.stringify(body).match(/"messageText":"결제했어요"/g) ?? []).toHaveLength(1);
    if (!body.template) throw new Error("template missing");
    expect(body.template.outputs).toHaveLength(3);
  }
  expect(JSON.stringify(bodies[0])).toContain("2026-11-26");
});

it("세 출력만 먼저 전하는 응답도 결제 바로가기를 잃지 않는다", async () => {
  const expanded = expandKakaoMessageContents([notice]);
  const result = renderDeferredKakaoReply(["지난 합성 안내", ...expanded], reply);
  expect(result.currentIncluded).toBe(false);
  const body = await result.response.json();
  expectSchema("SkillTemplateResponse", body);
  expect(body).toMatchObject({
    template: { quickReplies: [{ label: "결제했어요", action: "message", messageText: "결제했어요" }] },
  });
  expect(JSON.stringify(body)).not.toContain("현재 합성 답");
});

it("성공 콜백의 실제 직렬화에도 계좌·결제 버튼과 바로가기를 전한다", async () => {
  const sent: string[] = [];
  const result = await deliverKakaoCallback(
    { url: new URL("https://bot-api.kakao.com/v1/callback/synthetic"), deadline: 10000 },
    [notice, "현재 합성 답"],
    {
      now: () => 100,
      fetch: async (_url, init) => {
        sent.push(String(init.body));
        return Response.json({ status: "SUCCESS" });
      },
    },
  );
  expect(result).toBe("delivered");
  expect(sent).toHaveLength(1);
  const body = JSON.parse(sent[0] ?? "null");
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs).toHaveLength(3);
  expect(body.template.quickReplies).toEqual([{ label: "결제했어요", action: "message", messageText: "결제했어요" }]);
});
