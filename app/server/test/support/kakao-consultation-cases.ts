/** 실제 응답 표시 함수를 호출한 합성 자료. AI 업무 실행이나 실제 카카오 화면 확인 결과는 아니다. */
import { kakaoConsultationMessage } from "../../src/kakao-consultation-message";
import { kakaoReply } from "../../src/kakao-reply";
import type { ShopRequest } from "../../src/routes";

const responder: Pick<ShopRequest, "json"> = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
};
const card = {
  title: "주문 요청",
  description: "합성 주문 요약 · 서버가 확인한 금액",
  confirmLabel: "주문 요청",
  blockId: "synthetic-confirm",
  cardKey: "synthetic_card_key_1234",
};
export interface ConsultationResponseCase {
  readonly response: string;
  readonly state: string | null;
  readonly display: "skill" | "kakao-client" | "not-shown";
  readonly body: unknown;
}

export async function consultationResponseCases(): Promise<readonly ConsultationResponseCase[]> {
  const rows: ConsultationResponseCase[] = [];
  const add = (response: string, state: string, body: unknown) =>
    rows.push({ response, state, display: "skill", body });
  const common = async (outcome: Parameters<typeof kakaoReply>[1], state: string) => {
    const response = kakaoReply(responder, outcome, { contactPhone: "02-000-0000" });
    if (response.status !== 200 || response.headers.get("Siljang-Outcome") !== outcome)
      throw new Error("invalid fixture response");
    add(`API-070#200:${outcome}`, state, await response.json());
  };
  add(
    "API-070#200:answered",
    "normal",
    kakaoConsultationMessage({ state: "normal", contents: ["원하시는 날짜와 크기를 말씀해 주세요"] }),
  );
  await common("callback_pending", "loading");
  add(
    "API-070#200:handed_over",
    "handed-over",
    kakaoConsultationMessage({ state: "handed-over", recommendChannel: true }),
  );
  for (const outcome of [
    "ai_unavailable",
    "ai_timeout",
    "ai_key_missing",
    "ai_limit_reached",
    "ai_cost_limit_reached",
    "masking_failed",
  ] as const)
    await common(outcome, "handed-over");
  add("API-070#200:ai_output_rejected", "fixed-answer", kakaoConsultationMessage({ state: "fixed-answer" }));
  add(
    "API-070#200:card_shown",
    "normal",
    kakaoConsultationMessage({ state: "normal", contents: ["그 버전의 취소·환불 규정", card] }),
  );
  await common("photo_received", "normal");
  for (const outcome of ["photo_rejected", "photo_download_failed", "unsupported_message"] as const)
    await common(outcome, "error");
  await common("rate_limited", "rate-limited");
  await common("duplicate", "normal");
  await common("not_accepting", "permission");
  add(
    "API-070#200:channel_test_card",
    "link-test",
    kakaoConsultationMessage({ state: "link-test", mode: "initial", next: "card", blockId: "synthetic-confirm" }),
  );
  await common("server_error", "error");
  for (const result of ["401:skill_key_invalid", "422:validation_failed", "default:internal"])
    rows.push({ response: `API-070#${result}`, state: "error", display: "kakao-client", body: null });
  rows.push({ response: "API-073#200:notice_shown", state: null, display: "not-shown", body: null });
  add("API-073#200:notice_test", "link-test", kakaoConsultationMessage({ state: "link-test", mode: "notice" }));
  for (const result of ["200:notice_gone", "401:skill_key_invalid", "422:validation_failed", "default:internal"])
    rows.push({ response: `API-073#${result}`, state: null, display: "not-shown", body: null });
  return rows;
}
