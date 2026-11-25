import type { AiFailure } from "./ai-model";
import { KAKAO_CONSULTATION_UNAVAILABLE_TEXT } from "./kakao-callback";
import { type KakaoMessageContent, type KakaoMessageOutput, kakaoMessageOutputs } from "./kakao-message-content";
import type { ShopRequest } from "./routes";

/** TASK-028의 API-070 고정 결과. AI 처리와 에스컬레이션은 각 처리기가 끝낸 뒤 이 응답을 사용한다. */
export const KAKAO_COMMON_OUTCOMES = [
  "callback_pending",
  "ai_unavailable",
  "ai_timeout",
  "ai_key_missing",
  "ai_limit_reached",
  "ai_cost_limit_reached",
  "unsupported_message",
  "rate_limited",
  "duplicate",
  "not_accepting",
  "server_error",
] as const;
type Outcome =
  | (typeof KAKAO_COMMON_OUTCOMES)[number]
  | "notice_gone"
  | "masking_failed"
  | "review_saved"
  | "review_not_allowed"
  | "review_invalid";
type TextOutcome = Exclude<Outcome, "callback_pending" | "duplicate">;
export const KAKAO_HANDOFF_TEXT = "사장님 확인 뒤 답드릴게요.";
const TEXT: Readonly<Record<TextOutcome, string>> = {
  review_saved: "후기를 남겨 주셔서 고마워요",
  review_not_allowed: "받으신 주문에만 후기를 남길 수 있어요",
  review_invalid: "후기는 1,000자, 사진은 5장까지 남길 수 있어요",
  masking_failed: KAKAO_HANDOFF_TEXT,
  ai_unavailable: KAKAO_HANDOFF_TEXT,
  ai_timeout: KAKAO_HANDOFF_TEXT,
  ai_key_missing: KAKAO_HANDOFF_TEXT,
  ai_limit_reached: KAKAO_HANDOFF_TEXT,
  ai_cost_limit_reached: KAKAO_HANDOFF_TEXT,
  not_accepting: KAKAO_CONSULTATION_UNAVAILABLE_TEXT,
  unsupported_message: "글이나 사진으로 말씀해 주세요",
  rate_limited: "잠시 뒤 다시 말씀해 주세요",
  server_error: "잠시 뒤 다시 말씀해 주세요",
  notice_gone: "지금은 전할 안내가 없어요",
};
const AI_FAILURE_OUTCOMES = {
  timeout: "ai_timeout",
  unavailable: "ai_unavailable",
  key_missing: "ai_key_missing",
  limit_reached: "ai_limit_reached",
} as const satisfies Record<Exclude<AiFailure, "schema_invalid">, Outcome>;

/** 출력 검증 실패는 TASK-069의 ai_output_rejected이며 호출 실패와 구분한다. */
export function kakaoAiFailureOutcome(failure: Exclude<AiFailure, "schema_invalid">) {
  if (!Object.hasOwn(AI_FAILURE_OUTCOMES, failure)) throw new Error("unsupported model failure");
  return AI_FAILURE_OUTCOMES[failure];
}

export function kakaoReply(
  r: Pick<ShopRequest, "json">,
  outcome: Outcome,
  options: {
    readonly silent?: boolean;
    readonly contactPhone?: string | undefined;
    readonly previous?: readonly KakaoMessageContent[];
    /** API-072는 반복 요청에도 처음의 감사 답을 보낸다. API-070의 빈 출력과 구분한다. */
    readonly repeatReview?: boolean;
  } = {},
): Response {
  const headers = { "Siljang-Outcome": outcome, "Cache-Control": "no-store" };
  if (outcome === "callback_pending") {
    return r.json({ version: "2.0", useCallback: true, data: { text: "답을 준비하고 있어요" } }, 200, headers);
  }
  const outputs: KakaoMessageOutput[] = [];
  if (outcome === "duplicate" && options.repeatReview) outputs.push({ simpleText: { text: TEXT.review_saved } });
  if (outcome !== "duplicate" && !(outcome === "rate_limited" && options.silent)) {
    const previous = options.previous ?? [];
    if (previous.length > 2) throw new RangeError("invalid deferred Kakao replies");
    outputs.push(...kakaoMessageOutputs(previous));
    const text =
      outcome === "not_accepting" && options.contactPhone !== undefined
        ? `${TEXT.not_accepting}. 가게로 연락해 주세요: ${options.contactPhone}`
        : TEXT[outcome];
    outputs.push({ simpleText: { text } });
  }
  return r.json({ version: "2.0", template: { outputs } }, 200, headers);
}
