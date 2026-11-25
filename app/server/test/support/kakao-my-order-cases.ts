import { kakaoConsultationMessage } from "../../src/kakao-consultation-message";
import { type KakaoMyOrderSummary, type KakaoMyOrderView, kakaoMyOrderMessage } from "../../src/kakao-my-order-message";
import { kakaoReply } from "../../src/kakao-reply";
import type { ShopRequest } from "../../src/routes";

export const myOrderSummary: KakaoMyOrderSummary = {
  orderNo: "AB1234CD",
  status: "confirmed",
  pickupAt: "2026-11-28T06:00:00Z",
  contents: { size: "1호", flavor: "생크림", design: "하트 레터링", options: ["초 추가"], message: "합성 생일 축하" },
  amount: 36000,
  paidAt: "2026-11-25T05:02:00Z",
  changeDeadline: "2026-11-26T05:00:00Z",
  refundNow: { amount: 31000, clause: "제작 전 취소" },
  timeZone: "Asia/Seoul",
};

const responder: Pick<ShopRequest, "json"> = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
};
/** 공통 전송은 서버가 조회·계산한 표시 값만 받으며 업무 조회/본인 확인은 실행하지 않는다. */
export function myOrderBody(view: KakaoMyOrderView) {
  if (view.state === "normal" || view.state === "stale" || view.state === "empty")
    return kakaoConsultationMessage({ state: "normal", contents: [{ kind: "my_order", view }] });
  return kakaoMyOrderMessage(view);
}
export function myOrderSamples() {
  const views: readonly KakaoMyOrderView[] = [
    { state: "normal", order: myOrderSummary },
    { state: "loading" },
    { state: "empty" },
    { state: "error", reason: "not_found" },
    { state: "permission", reason: "not_yours" },
    { state: "stale", order: { ...myOrderSummary, refundNow: { amount: 18000, clause: "제작 시작 뒤 취소" } } },
    { state: "handed-over", recommendChannel: true },
    { state: "rate-limited" },
  ];
  return views.map((view) => ({ state: view.state, body: myOrderBody(view) }));
}
interface MyOrderResponseCase {
  readonly response: string;
  readonly state: string | null;
  readonly display: "skill" | "kakao-client" | "not-shown";
  readonly body: unknown;
}
export async function myOrderResponseCases(): Promise<readonly MyOrderResponseCase[]> {
  const rows: MyOrderResponseCase[] = [];
  const add = (response: string, state: string, body: unknown) =>
    rows.push({ response, state, display: "skill", body });
  const common = async (outcome: Parameters<typeof kakaoReply>[1], state: string) => {
    const response = kakaoReply(responder, outcome, { contactPhone: "02-000-0000" });
    if (response.status !== 200 || response.headers.get("Siljang-Outcome") !== outcome)
      throw new Error("invalid my order fixture response");
    add(`API-070#200:${outcome}`, state, await response.json());
  };
  add("API-070#200:answered", "normal", myOrderBody({ state: "normal", order: myOrderSummary }));
  await common("callback_pending", "loading");
  add("API-070#200:handed_over", "handed-over", myOrderBody({ state: "handed-over" }));
  for (const outcome of [
    "ai_unavailable",
    "ai_timeout",
    "ai_key_missing",
    "ai_limit_reached",
    "ai_cost_limit_reached",
    "masking_failed",
  ] as const)
    await common(outcome, "handed-over");
  add("API-070#200:ai_output_rejected", "normal", myOrderBody({ state: "normal", order: myOrderSummary }));
  add("API-070#200:card_shown", "normal", myOrderBody({ state: "normal", order: myOrderSummary }));
  await common("photo_received", "normal");
  for (const outcome of ["photo_rejected", "photo_download_failed", "unsupported_message"] as const)
    await common(outcome, "error");
  await common("rate_limited", "rate-limited");
  await common("duplicate", "normal");
  await common("not_accepting", "permission");
  rows.push({ response: "API-070#200:channel_test_card", state: null, display: "not-shown", body: null });
  await common("server_error", "error");
  for (const result of ["401:skill_key_invalid", "422:validation_failed", "default:internal"])
    rows.push({ response: `API-070#${result}`, state: "error", display: "kakao-client", body: null });
  return rows;
}
