import { expect, it } from "vitest";
import { customerNoticeContents } from "../src/customer-notice-content";
import { deliverKakaoCallback } from "../src/kakao-callback";
import { kakaoConsultationMessage } from "../src/kakao-consultation-message";
import { kakaoCustomerNoticeMessage } from "../src/kakao-customer-notice-message";
import { renderDeferredKakaoReply } from "../src/kakao-deferred";
import {
  expandKakaoMessageContents,
  type KakaoMessageContent,
  kakaoMessageTemplate,
} from "../src/kakao-message-content";
import type { ShopDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { customerNoticePhotoAsk as photo } from "./support/kakao-customer-notice-cases";

const widget = (view: unknown) => ({ kind: "customer_notice", view }) as unknown as KakaoMessageContent;
const noRead = {
  run: async () => {
    throw new Error("표시할 준비된 안내는 추가 데이터베이스 읽기를 하지 않음");
  },
} as unknown as ShopDb;
it("서버 안내의 공통 내용은 사장님 답 원문을 보존한다", () => {
  const view = { state: "normal", notice: { kind: "owner_reply", text: " 합성 사장님 답\n원문 " } } as const;
  expect(kakaoConsultationMessage({ state: "normal", contents: [widget(view)] })).toEqual(
    kakaoCustomerNoticeMessage(view),
  );
});
it("사진5장의 공통 펼침은 반복해도 같고 콜백도 같은 세 출력을 전한다", async () => {
  const expanded = expandKakaoMessageContents([widget(photo)]);
  expect(expanded).toHaveLength(3);
  expect(expandKakaoMessageContents(expanded)).toEqual(expanded);
  expect(() => kakaoMessageTemplate([...expanded, "추가 답"])).toThrow();
  let sent: unknown;
  expect(
    await deliverKakaoCallback(
      { url: new URL("https://bot-api.kakao.com/v1/callback/synthetic"), deadline: 10000 },
      expanded,
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
  expect(sent).toEqual(kakaoCustomerNoticeMessage(photo));
});
it("사진 안내 세 출력을 먼저 전할 때 현재 답을 보냈다고 하지 않는다", async () => {
  const expanded = expandKakaoMessageContents([widget(photo)]);
  const result = renderDeferredKakaoReply(expanded, (previous) =>
    Response.json(kakaoConsultationMessage({ state: "normal", contents: [...previous, "현재 합성 답"] })),
  );
  expect(result.currentIncluded).toBe(false);
  const body = await result.response.json();
  expectSchema("SkillTemplateResponse", body);
  expect(body).toEqual(kakaoCustomerNoticeMessage(photo));
  expect(JSON.stringify(body)).not.toContain("현재 합성 답");
});
it("실제 안내 읽기의 준비 경로도 UI 내용을 사용하며 최대2000자를 자르지 않는다", async () => {
  const text = "🍰".repeat(2000);
  const contents = await customerNoticeContents(
    noRead,
    {
      id: "synthetic-notice",
      customerId: "synthetic-customer",
      kind: "owner_reply",
      body: text,
    },
    new Date("2026-11-26T00:00:00Z"),
  );
  expect(contents).toMatchObject([{ kind: "customer_notice" }]);
  if (contents === null) throw new Error("synthetic contents missing");
  const body = kakaoConsultationMessage({ state: "normal", contents });
  expectSchema("SkillTemplateResponse", body);
  if (!("template" in body) || !body.template) throw new Error("synthetic template missing");
  expect(body.template.outputs).toHaveLength(2);
  expect(JSON.stringify(body).match(/🍰/gu)).toHaveLength(2000);
});
it("금액 불일치의 실제 준비 경로는 저장 본문의 들어온 금액도 노출하지 않는다", async () => {
  const contents = await customerNoticeContents(
    noRead,
    {
      id: "synthetic-notice",
      customerId: "synthetic-customer",
      kind: "payment_mismatch",
      body: "합성 받은 금액 12,345원",
    },
    new Date("2026-11-26T00:00:00Z"),
  );
  if (contents === null) throw new Error("synthetic contents missing");
  const body = kakaoConsultationMessage({ state: "normal", contents });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain("보내신 금액이 안내와 달라 사장님이 연락드릴게요");
  expect(JSON.stringify(body)).not.toContain("12,345");
});
