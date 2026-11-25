import type { Bindings } from "./app";
import { type DbConnector, pgConnector, type RequestDb } from "./db";
import { errorFields } from "./error-name";
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
import { readClaimedKakaoCard } from "./kakao-card-delivery";
import { deferredKakaoBatch, deferredKakaoTexts } from "./kakao-deferred";
import { mergeKakaoAmountConfirmations } from "./kakao-message-content";
import { runKakaoPhotoTurn } from "./kakao-photo-turn";
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
    log("error", { event: "job_find_failed", job, ...errorFields(error) }, options.logSink);
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
      log("warn", { event: "job_act_failed", job, itemId: row.id, ...errorFields(error) }, options.logSink);
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
    const photo = await runKakaoPhotoTurn(db, job.messageId, claim, services, now, {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    if (photo.kind === "gone") return "done";
    if (photo.kind === "reply") {
      if (photo.reply.delivered) {
        await finishKakaoCallback(db, job.messageId, claim, photo.reply.text, null, [], photo.reply.id);
        return "done";
      }
      const callback = kakaoCallback(photo.callbackUrl, claim.created_at);
      const usable =
        callback !== null && Math.min(callback.deadline, claim.kakao_callback_deadline_at.getTime()) > now().getTime();
      const batch = !usable
        ? { messages: [], currentBlocked: false }
        : await db.transaction((tx) =>
            deferredKakaoBatch(tx, claim.customer_id, {
              now: now(),
              excludeMessageId: photo.reply.id,
              allowFullOrderCard: true,
              fields: () => services.fieldCrypto(),
            }),
          );
      const previous = batch.messages;
      const previousTexts = deferredKakaoTexts(previous);
      const replyIncluded = !batch.currentBlocked && previousTexts.length < 3;
      const sentAt =
        usable &&
        callback !== null &&
        (await deliverKakaoCallback(
          { ...callback, deadline: Math.min(callback.deadline, claim.kakao_callback_deadline_at.getTime()) },
          [...previousTexts, ...(replyIncluded ? [photo.reply.text] : [])],
          { now: () => now().getTime(), ...(options.fetch === undefined ? {} : { fetch: options.fetch }) },
        )) === "delivered"
          ? now()
          : null;
      await finishKakaoCallback(db, job.messageId, claim, photo.reply.text, sentAt, previous, photo.reply.id, {
        replyIncluded,
      });
      if (sentAt !== null) {
        if (replyIncluded) log("info", { event: "kakao_callback_result", code: photo.reply.outcome }, options.logSink);
        if (previous.some((row) => row.card !== undefined))
          log("info", { event: "kakao_callback_result", code: "card_shown" }, options.logSink);
      }
      return "done";
    }
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
      const reason = await prepareKakaoCallbackHandoff(db, job.messageId, claim, now(), {
        failureReason: maskingFailed ? "masking_failed" : "ai_failure",
      });
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
      raw = await openKakaoCallback(db, services.fieldCrypto(), claim, job.messageId);
    } catch (error) {
      if (!(error instanceof FieldCryptoError)) throw error;
    }

    const candidate = kakaoCallback(raw, claim.created_at);
    const callback =
      candidate !== null && Math.min(candidate.deadline, claim.kakao_callback_deadline_at.getTime()) > now().getTime()
        ? candidate
        : null;
    // 모델을 기다리는 동안 설정이 바뀌었으면 실제 발신 직전에 새 게시 버전을 고른다.
    if (disclosure !== null && callback !== null) {
      disclosure = services.aiConfigured ? await prepareKakaoAiDisclosure(db, claim, services) : undefined;
      if (preparedReply !== undefined && disclosure === undefined) {
        const reason = await prepareKakaoCallbackHandoff(db, job.messageId, claim, now(), {
          discardReplyId: preparedReply.id,
        });
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
    const previousBatch =
      callback === null
        ? { messages: [], currentBlocked: false }
        : await db.transaction((tx) =>
            deferredKakaoBatch(tx, claim.customer_id, {
              disclosureConsultationId: disclosure?.consultationId,
              excludeMessageId: preparedReply?.id,
              now: now(),
              allowFullOrderCard: true,
              fields: () => services.fieldCrypto(),
            }),
          );
    const previous = previousBatch.messages;
    const prefix = disclosure === null || disclosure === undefined ? [] : [disclosure.text];
    const previousTexts = deferredKakaoTexts(previous);
    // 고지·이전 안내가 세 칸을 채우면 새 AI 답은 다음 대화에 남긴다. 이전 안내를 앞질러 보내지 않는다.
    const alreadyIncluded =
      preparedReply?.card?.amountConfirmation !== undefined &&
      mergeKakaoAmountConfirmations(previousTexts, [preparedReply.card]).length === previousTexts.length;
    let replyIncluded = alreadyIncluded || (!previousBatch.currentBlocked && prefix.length + previousTexts.length < 3);
    if (callback !== null && replyIncluded && preparedReply?.card !== undefined) {
      const fresh = await readClaimedKakaoCard(db, job.messageId, claim, now);
      if (fresh === null) {
        await releaseKakaoCallback(db, job.messageId, claim);
        return "done";
      }
      preparedReply = { id: preparedReply.id, delivered: preparedReply.delivered, ...fresh };
    }
    const text = preparedReply?.text ?? KAKAO_HANDOFF_TEXT;
    let transmittedContents = previousTexts;
    if (replyIncluded) {
      const combined = mergeKakaoAmountConfirmations(previousTexts, [preparedReply?.card ?? text]);
      const added = combined.length - previousTexts.length;
      replyIncluded = (!previousBatch.currentBlocked || added === 0) && prefix.length + combined.length <= 3;
      if (replyIncluded) transmittedContents = combined;
    }
    const deliveredAt =
      callback !== null &&
      (await deliverKakaoCallback(
        { ...callback, deadline: Math.min(callback.deadline, claim.kakao_callback_deadline_at.getTime()) },
        [...prefix, ...transmittedContents],
        { now: () => now().getTime(), ...(options.fetch === undefined ? {} : { fetch: options.fetch }) },
      )) === "delivered"
        ? now()
        : null;
    if (
      deliveredAt !== null &&
      (previous.some((row) => row.card !== undefined) || (replyIncluded && preparedReply?.card !== undefined))
    ) {
      log("info", { event: "kakao_callback_result", code: "card_shown" }, options.logSink);
    }
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
            ...errorFields(error),
          },
          options.logSink,
        );
        message.retry({ delaySeconds: 15 });
      }
    }
  };
}
