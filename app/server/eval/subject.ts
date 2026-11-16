/**
 * 평가 대상(TASK-027). 대상 하나 = 프롬프트 + 모델 호출 방법. 지금은 기준 프롬프트 버전 0(prompt-v0.ts)을 TASK-026의
 * 모델 호출 모듈(createAiModel)로 한 번 호출하는 대상 하나다.
 *
 * - TASK-069의 그래프가 나오면 같은 Subject 꼴로 그 그래프를 대상으로 더한다(서버 확인·다시 하기·AI 상담 고지 포함).
 *   그때 sendsNotice가 true가 되어 SPEC-018의 고지 경로도 잰다.
 * - 호출은 운영과 같은 모듈을 그대로 쓴다(appEnv production: 추적 도구가 켜져 있으면 호출하지 않음, REQ-138).
 * - ai_calls 행은 데이터베이스에 쓰지 않는다. 모델 호출 모듈이 보내는 INSERT 하나를 받아 같은 열 이름의 값으로 모으고
 *   결과 파일에 남긴다(captureAiCalls). 그 밖의 SQL이 오면 멈춘다.
 * - 가게 범위는 합성 가게의 ID로 만든다. 출처(via)는 서버 안의 일(job)이고 이름은 ai_eval이다.
 */
import { randomUUID } from "node:crypto";
import { FIRST_ATTEMPT } from "../src/ai-calls";
import { createAiModel } from "../src/ai-model";
import type { Queryable, Rows } from "../src/db";
import type { AiSettings } from "../src/settings";
import { createShopScope, shopDb } from "../src/shop-scope";
import { buildMessagesV0, inputText, PROMPT_V0_VERSION } from "./prompt-v0";
import { EVAL_SHOPS } from "./shops";
import type { AiCallRecord, EvalCase, SentMessage, TurnResult } from "./types";

/** 대상이 한 차례에 돌려주는 것. input은 AI가 받은 글 전부(채점용, 결과 파일에는 싣지 않음). */
export interface SubjectTurn extends TurnResult {
  readonly input: string;
}

export interface SubjectContext {
  readonly ai: AiSettings;
  /** 모델 회사로 보내는 fetch. 모의 실행은 모의 응답, 실제 실행은 전역 fetch. */
  readonly fetch: typeof fetch;
  readonly runId: string;
  readonly now?: () => Date;
}

export interface Subject {
  readonly name: string;
  readonly promptVersion: string;
  /** 상담의 첫 메시지에 서버의 AI 상담 고지를 먼저 보내는 대상인지(SPEC-018). false면 고지 경로는 '재지 않음'. */
  readonly sendsNotice: boolean;
  /** 한 차례에 모델을 호출하는 최대 횟수(비용 위 끝 셈). 버전 0은 1, AI-1 그래프는 8(04 AI-1 '시간과 다시 하기'). */
  readonly maxCallsPerTurn: number;
  /** 한 번의 호출에 보내는 글 전부(비용 어림). */
  requestText(c: EvalCase): string;
  respond(c: EvalCase, ctx: SubjectContext): Promise<SubjectTurn>;
}

/** 호출 실패 때 손님에게 가는 정해진 문장(AI-1 '실패'의 자리). 평가에서는 no_output으로 따로 센다. */
export const FALLBACK_REPLY = "지금은 답을 만들지 못했어요. 사장님께 전달할게요.";

const INSERT_AI_CALLS = /^\s*INSERT\s+INTO\s+ai_calls\s*\(([^)]*)\)/i;

/** recordAiCall의 INSERT 하나만 받아 ai_calls 한 행과 같은 열 이름의 값으로 into에 모은다. 데이터베이스에 쓰지 않는다. */
export function captureAiCalls(into: AiCallRecord[]): Queryable {
  return {
    async query<R>(sql: string, params: readonly unknown[] = []): Promise<Rows<R>> {
      const m = INSERT_AI_CALLS.exec(sql);
      if (m === null) throw new Error("eval captures only the ai_calls insert");
      const columns = (m[1] ?? "").split(",").map((s) => s.trim());
      if (columns.length !== params.length) throw new Error("ai_calls insert has a different number of values");
      const id = randomUUID();
      const row: Record<string, unknown> = { id };
      columns.forEach((column, i) => {
        const value = params[i];
        row[column] = column === "reasoning" && typeof value === "string" ? JSON.parse(value) : value;
      });
      into.push(row);
      return { rows: [{ id } as R], rowCount: 1 };
    },
  };
}

/** 기준 대상: 프롬프트 버전 0을 모델 호출 모듈로 한 번 호출(다시 하기 없음). */
export const baselineSubject: Subject = {
  name: "baseline-v0",
  promptVersion: PROMPT_V0_VERSION,
  sendsNotice: false,
  maxCallsPerTurn: 1,
  requestText: (c) => inputText(buildMessagesV0(c)),
  async respond(c, ctx) {
    const messages = buildMessagesV0(c);
    const calls: AiCallRecord[] = [];
    const db = shopDb(createShopScope(EVAL_SHOPS[c.shop].id, { kind: "job", job: "ai_eval" }), captureAiCalls(calls));
    const model = createAiModel("production", ctx.ai, {
      fetch: ctx.fetch,
      ...(ctx.now !== undefined ? { now: ctx.now } : {}),
    });
    const outcome = await model.call({
      db,
      consultationId: randomUUID(),
      traceId: `${ctx.runId}:${c.id}`,
      attempt: FIRST_ATTEMPT,
      promptVersion: PROMPT_V0_VERSION,
      messages,
    });
    const sent: SentMessage[] = outcome.ok
      ? [{ kind: "ai_reply", text: outcome.output.reply }]
      : [{ kind: "fixed", text: FALLBACK_REPLY }];
    return {
      sent,
      output: outcome.ok ? outcome.output : null,
      failure: outcome.ok ? null : outcome.failure,
      calls,
      input: inputText(messages),
    };
  },
};
