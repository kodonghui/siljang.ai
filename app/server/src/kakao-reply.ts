import type { AiFailure } from "./ai-model";
import { KAKAO_CONSULTATION_UNAVAILABLE_TEXT } from "./kakao-callback";
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
type Outcome = (typeof KAKAO_COMMON_OUTCOMES)[number] | "notice_gone";
type TextOutcome = Exclude<Outcome, "callback_pending" | "duplicate">;
const HANDOFF_TEXT = "사장님 확인 뒤 답드릴게요.";
const TEXT: Readonly<Record<TextOutcome, string>> = {
  ai_unavailable: HANDOFF_TEXT,
  ai_timeout: HANDOFF_TEXT,
  ai_key_missing: HANDOFF_TEXT,
  ai_limit_reached: HANDOFF_TEXT,
  ai_cost_limit_reached: HANDOFF_TEXT,
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
    readonly previous?: readonly string[];
  } = {},
): Response {
  const headers = { "Siljang-Outcome": outcome, "Cache-Control": "no-store" };
  if (outcome === "callback_pending") {
    return r.json({ version: "2.0", useCallback: true, data: { text: "답을 준비하고 있어요" } }, 200, headers);
  }
  const outputs: { simpleText: { text: string } }[] = [];
  if (outcome !== "duplicate" && !(outcome === "rate_limited" && options.silent)) {
    const previous = options.previous ?? [];
    if (previous.length > 2 || previous.some((text) => [...text].length < 1 || [...text].length > 1000))
      throw new RangeError("invalid deferred Kakao replies");
    for (const text of previous) outputs.push({ simpleText: { text } });
    const text =
      outcome === "not_accepting" && options.contactPhone !== undefined
        ? `${TEXT.not_accepting}. 가게로 연락해 주세요: ${options.contactPhone}`
        : TEXT[outcome];
    outputs.push({ simpleText: { text } });
  }
  return r.json({ version: "2.0", template: { outputs } }, 200, headers);
}
