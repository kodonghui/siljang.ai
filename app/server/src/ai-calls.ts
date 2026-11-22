/**
 * AI 호출 기록 한 행(TASK-026; 05 TBL-048 ai_calls, REQ-150·163, 04 AI-1).
 *
 * - 모델 호출 하나마다 한 행. 성공·실패·시간 초과·사용 한도도 한 행이다. 프롬프트·답 같은 내용은 남기지 않는다(G6, REQ-135·141).
 * - 토큰 네 열은 서로 겹치지 않는다: input_tokens는 캐시를 뺀 입력, cache_read_tokens·cache_write_tokens는 캐시 읽기·쓰기.
 *   그래서 금액 = 네 열 × 요금표 값(ai-prices.ts)으로 다시 셀 수 있다.
 * - fallback_reason은 '이 호출의 답을 쓰지 못한 까닭'이다(schema_invalid·timeout·model_error). 그래프 층(뒤 TASK)이 다시
 *   하기·다시 쓰기·에스컬레이션을 고르고, 서버 확인의 나머지 까닭(amount_mismatch 등)과 cost_limit·call_limit도 그 층이 남긴다.
 * - 순번(attempt)과 다시 한 종류(call_kind)는 nextAttempt로 짓는다. 차례마다 8번 상한(AI-1)은 그래프 층이 호출 전에 막는다.
 */
import type { ShopDb } from "./shop-scope";

export const CALL_KINDS = ["first", "after_tool", "retry", "regenerate"] as const;
export type CallKind = (typeof CALL_KINDS)[number];

export const AI_CALL_RESULTS = ["success", "failure", "timeout", "limit_reached"] as const;
export type AiCallResult = (typeof AI_CALL_RESULTS)[number];

/** 05 ai_calls.fallback_reason 가운데 이 모듈이 남기는 것. */
export type ModuleFallbackReason = "schema_invalid" | "timeout" | "model_error";

/** 차례 안의 호출 하나의 순번과 종류. */
export interface Attempt {
  readonly attempt: number;
  readonly callKind: CallKind;
}

/** 차례의 첫 호출(순번 1, first). 05 ai_calls_kind_chk: first는 순번 1에만. */
export const FIRST_ATTEMPT: Attempt = { attempt: 1, callKind: "first" };

/** 앞 호출 다음의 순번. 이어 하는 까닭은 도구 뒤(after_tool)·다시 하기(retry)·다시 쓰기(regenerate) 가운데 하나. */
export function nextAttempt(previous: Attempt, kind: Exclude<CallKind, "first">): Attempt {
  if (!Number.isSafeInteger(previous.attempt) || previous.attempt < 1) throw new RangeError("attempt starts at 1");
  return { attempt: previous.attempt + 1, callKind: kind };
}

/** ai_calls 한 행에 쓰는 값(가게는 ShopDb의 범위). */
export interface AiCallRow {
  readonly consultationId: string;
  readonly traceId: string;
  readonly attempt: Attempt;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  /** 보낸 추론 설정(effort·최대 출력 토큰). 내용 없음. */
  readonly reasoning: Readonly<Record<string, string | number | null>>;
  readonly sentAt: Date;
  readonly firstTokenMs: number | null;
  readonly totalMs: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  } | null;
  readonly cost: { readonly usd: string; readonly krw: string; readonly basis: string } | null;
  readonly result: AiCallResult;
  readonly stopReason: string | null;
  readonly errorKind: string | null;
  readonly fallbackReason: ModuleFallbackReason | null;
}

/** 한 행을 남기고 그 ID를 돌려준다. 같은 차례·순번이 이미 있으면 05 ai_calls_attempt_uq로 23505. */
export async function recordAiCall(db: ShopDb, row: AiCallRow): Promise<string> {
  const t = row.tokens;
  const { rows } = await db.run<{ id: string }>(
    `INSERT INTO ai_calls (shop_id, consultation_id, trace_id, attempt, call_kind, provider, model, prompt_version, reasoning,
       sent_at, first_token_ms, total_ms, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, cost_krw,
       cost_basis, result, stop_reason, error_kind, fallback_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
     RETURNING id`,
    [
      row.consultationId,
      row.traceId,
      row.attempt.attempt,
      row.attempt.callKind,
      row.provider,
      row.model,
      row.promptVersion,
      JSON.stringify(row.reasoning),
      row.sentAt.toISOString(),
      row.firstTokenMs,
      row.totalMs,
      t?.input ?? null,
      t?.output ?? null,
      t?.cacheRead ?? null,
      t?.cacheWrite ?? null,
      row.cost?.usd ?? null,
      row.cost?.krw ?? null,
      row.cost?.basis ?? null,
      row.result,
      row.stopReason,
      row.errorKind,
      row.fallbackReason,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("ai_calls insert returned no row");
  return id;
}

/** 서버가 성공한 모델 출력을 쓰지 못한 이유만 남긴다. 호출 내용/사용량/비용은 고치지 않는다. */
export async function markAiCallUnused(
  db: ShopDb,
  aiCallId: string,
  consultationId: string,
  reason: ModuleFallbackReason,
): Promise<void> {
  await db.run(
    `UPDATE ai_calls SET fallback_reason = $4 WHERE shop_id = $1 AND id = $2 AND consultation_id = $3
      AND result = 'success' AND fallback_reason IS NULL`,
    [aiCallId, consultationId, reason],
  );
}
