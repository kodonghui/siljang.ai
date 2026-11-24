import type { Bindings } from "./app";
import { type DbConnector, pgConnector, type RequestDb, sqlStateOf } from "./db";
import { FieldCryptoError } from "./field-crypto";
import { prepareKakaoAiDisclosure } from "./kakao-ai-disclosure";
import { type KakaoAiReply, runKakaoAiTurn } from "./kakao-ai-turn";
import { deliverKakaoCallback, kakaoCallback } from "./kakao-callback";
import { EXPIRED_KAKAO_CALLBACKS } from "./kakao-callback-sources";
import {
  claimKakaoCallback,
  deferExpiredKakaoCallback,
  finishKakaoCallback,
  type KakaoCallbackJob,
  openKakaoCallback,
  prepareKakaoCallbackHandoff,
  releaseKakaoCallback,
} from "./kakao-callback-store";
import { deferredKakaoMessages, deferredKakaoTexts } from "./kakao-deferred";
import { KAKAO_HANDOFF_TEXT, kakaoAiFailureOutcome } from "./kakao-reply";
import { type LogSink, log } from "./log";
import { createServices, type ServiceOverrides } from "./services";
import { readSettings } from "./settings";
import { createShopScope, isUuid, shopRequestDb } from "./shop-scope";

interface ConsumerOptions {
  readonly connect?: DbConnector;
  readonly now?: () => Date;
  readonly fetch?: typeof fetch;
  readonly logSink?: LogSink;
  readonly services?: ServiceOverrides;
}

interface RecoveryOptions {
  readonly logSink?: LogSink;
  readonly clock?: () => number;
  /** 1회 최대25개. 작은 값은 시험에서만 쓴다. */
  readonly limit?: number;
  /** 새 행을 시작할 시간 한도. 진행 중 트랜잭션을 도중에 끊지는 않는다. */
  readonly budgetMs?: number;
}

function recoveryError(error: unknown) {
  const dbCode = sqlStateOf(error);
  return {
    errorName: dbCode !== undefined ? "DatabaseError" : error instanceof Error ? error.name : "Error",
    ...(dbCode === undefined ? {} : { dbCode }),
  };
}

/** 큐가 유실돼도 만료된 콜백은 기존 1분 실행에서 복구한다. 외부로 발신하지 않는다. */
export async function recoverExpiredKakaoCallbacks(db: RequestDb, now: Date, options: RecoveryOptions = {}) {
  const job = "kakao_callback_recovery";
  const clock = options.clock ?? (() => performance.now());
  const startedAt = clock();
  const limit = Math.min(25, Math.max(1, Math.trunc(options.limit ?? 25)));
  const budgetMs = Math.min(5000, Math.max(0, options.budgetMs ?? 5000));
  const summary = { found: 0, deferred: 0, discarded: 0, skipped: 0, failed: 0, stoppedByBudget: false };
  let rows: { shop_id: string; id: string; due_at: Date }[];
  try {
    rows = (await db.query<{ shop_id: string; id: string; due_at: Date }>(EXPIRED_KAKAO_CALLBACKS, [now, limit])).rows;
  } catch (error) {
    log("error", { event: "job_find_failed", job, ...recoveryError(error) }, options.logSink);
    return summary;
  }
  summary.found = rows.length;
  log("info", { event: "kakao_callback_recovery_polled", count: rows.length }, options.logSink);
  for (const row of rows) {
    if (clock() - startedAt >= budgetMs) {
      summary.stoppedByBudget = true;
      log("warn", { event: "job_run_budget_reached", job }, options.logSink);
      break;
    }
    try {
      const scoped = shopRequestDb(createShopScope(row.shop_id, { kind: "job", job: "kakao_callback" }), db);
      const result = await deferExpiredKakaoCallback(scoped, row.id, now, KAKAO_HANDOFF_TEXT);
      summary[result] += 1;
    } catch (error) {
      summary.failed += 1;
      log("warn", { event: "job_act_failed", job, itemId: row.id, ...recoveryError(error) }, options.logSink);
    }
  }
  if (summary.failed > 0) log("error", { event: "job_run_failed", job, count: summary.failed }, options.logSink);
  const done = summary.deferred + summary.discarded;
  if (done > 0) log("info", { event: "kakao_callback_recovery", count: done }, options.logSink);
  return summary;
}

function callbackJob(body: unknown): KakaoCallbackJob | null {
  if (
    typeof body !== "object" ||
    body === null ||
    !("shopId" in body) ||
    !("messageId" in body) ||
    !isUuid(body.shopId) ||
    !isUuid(body.messageId)
  ) {
    return null;
  }
  return { shopId: body.shopId, messageId: body.messageId };
}

export async function consumeKakaoCallback(
  body: unknown,
  env: Bindings,
  options: ConsumerOptions = {},
): Promise<"done" | "retry"> {
  const job = callbackJob(body);
  if (job === null) return "done";

  const now = options.now ?? options.services?.now ?? (() => new Date());
  const settings = readSettings(env);
  const services = createServices(env, settings, { ...options.services, now });
  const conn = (options.connect ?? pgConnector)(settings.secrets.DATABASE_URL);
  const scope = createShopScope(job.shopId, { kind: "job", job: "kakao_callback" });
  const db = shopRequestDb(scope, conn);
  let owned: Exclude<Awaited<ReturnType<typeof claimKakaoCallback>>, "busy"> = null;
  try {
    const claim = await claimKakaoCallback(db, job.messageId, now());
    if (claim === "busy") return "retry";
    if (claim === null) {
      await deferExpiredKakaoCallback(db, job.messageId, now(), KAKAO_HANDOFF_TEXT);
      return "done";
    }

    owned = claim;
    let disclosure = services.aiConfigured ? await prepareKakaoAiDisclosure(db, claim, services) : undefined;
    let preparedReply: KakaoAiReply | undefined;
    let maskingFailed = false;
    let failureCode: string = kakaoAiFailureOutcome(services.aiConfigured ? "unavailable" : "key_missing");
    if (services.aiConfigured) {
      const turn = await runKakaoAiTurn(db, job.messageId, claim, services, now, disclosure ?? undefined);
      if (turn.kind === "gone") return "done";
      if (turn.kind === "busy") {
        await releaseKakaoCallback(db, job.messageId, claim);
        return "retry";
      }
      if (turn.kind === "reply") preparedReply = turn.reply;
      else if (turn.kind === "masking_failure") {
        maskingFailed = true;
        failureCode = "masking_failed";
      } else if (turn.kind === "failure")
        failureCode = turn.failure === "schema_invalid" ? "ai_output_rejected" : kakaoAiFailureOutcome(turn.failure);
    }
    if (preparedReply?.delivered) {
      await finishKakaoCallback(db, job.messageId, claim, preparedReply.text, null, [], preparedReply.id);
      return "done";
    }
    if (preparedReply === undefined) {
      const reason = await prepareKakaoCallbackHandoff(
        db,
        job.messageId,
        claim,
        now(),
        maskingFailed ? "masking_failed" : "ai_failure",
      );
      if (reason === false) return "done";
      log(
        "warn",
        {
          event: "kakao_callback_handoff",
          code: reason === "ai_cost_limit" ? "ai_cost_limit_reached" : failureCode,
        },
        options.logSink,
      );
    }
    let raw: string | undefined;
    try {
      raw = await openKakaoCallback(db, services.fieldCrypto(), claim);
    } catch (error) {
      if (!(error instanceof FieldCryptoError)) throw error;
    }

    const callback = kakaoCallback(raw, claim.created_at);
    // 모델을 기다리는 동안 설정이 바뀌었으면 실제 발신 직전에 새 게시 버전을 고른다.
    if (disclosure !== null && callback !== null) {
      const firstPreparedAt = disclosure?.at;
      disclosure = services.aiConfigured ? await prepareKakaoAiDisclosure(db, claim, services) : undefined;
      if (disclosure !== null && disclosure !== undefined && firstPreparedAt !== undefined)
        disclosure = { ...disclosure, at: firstPreparedAt };
      if (preparedReply !== undefined && disclosure === undefined) {
        const reason = await prepareKakaoCallbackHandoff(db, job.messageId, claim, now());
        if (reason === false) return "done";
        preparedReply = undefined;
        failureCode = kakaoAiFailureOutcome("unavailable");
        log(
          "warn",
          { event: "kakao_callback_handoff", code: reason === "ai_cost_limit" ? "ai_cost_limit_reached" : failureCode },
          options.logSink,
        );
      }
    }
    const previous =
      callback === null
        ? []
        : (
            await deferredKakaoMessages(db, claim.customer_id, {
              disclosureConsultationId: disclosure?.consultationId,
            })
          ).filter((row) => preparedReply === undefined || row.source !== "message" || row.id !== preparedReply.id);
    const text = preparedReply?.text ?? KAKAO_HANDOFF_TEXT;
    const prefix = disclosure === null || disclosure === undefined ? [] : [disclosure.text];
    const previousTexts = deferredKakaoTexts(previous);
    // 고지·이전 안내가 세 칸을 채우면 새 AI 답은 다음 대화에 남긴다. 이전 안내를 앞질러 보내지 않는다.
    const replyIncluded = prefix.length + previousTexts.length < 3;
    const deliveredAt =
      callback !== null &&
      (await deliverKakaoCallback(
        { ...callback, deadline: Math.min(callback.deadline, claim.kakao_callback_deadline_at.getTime()) },
        [...prefix, ...previousTexts, ...(replyIncluded ? [text] : [])],
        { now: () => now().getTime(), ...(options.fetch === undefined ? {} : { fetch: options.fetch }) },
      )) === "delivered"
        ? now()
        : null;
    await finishKakaoCallback(db, job.messageId, claim, text, deliveredAt, previous, preparedReply?.id, {
      ...(disclosure === null || disclosure === undefined ? {} : { disclosure }),
      replyIncluded,
    });
    return "done";
  } catch (error) {
    if (owned !== null) await releaseKakaoCallback(db, job.messageId, owned).catch(() => {});
    throw error;
  } finally {
    await conn.close();
  }
}

interface CallbackBatch {
  readonly messages: readonly {
    readonly body: unknown;
    ack(): void;
    retry(options: { readonly delaySeconds: number }): void;
  }[];
}

export function createKakaoCallbackHandler(options: ConsumerOptions = {}) {
  return async (batch: CallbackBatch, env: Bindings): Promise<void> => {
    for (const message of batch.messages) {
      try {
        if ((await consumeKakaoCallback(message.body, env, options)) === "retry") {
          message.retry({ delaySeconds: 15 });
        } else {
          message.ack();
        }
      } catch (error) {
        log(
          "error",
          {
            event: "kakao_callback_failed",
            ...(error instanceof Error ? { errorName: error.name } : {}),
          },
          options.logSink,
        );
        message.retry({ delaySeconds: 15 });
      }
    }
  };
}
