import type { Bindings } from "./app";
import { type DbConnector, pgConnector } from "./db";
import { FieldCryptoError } from "./field-crypto";
import { deliverKakaoCallback, KAKAO_CONSULTATION_UNAVAILABLE_TEXT, kakaoCallback } from "./kakao-callback";
import {
  claimKakaoCallback,
  deferExpiredKakaoCallback,
  finishKakaoCallback,
  type KakaoCallbackJob,
  openKakaoCallback,
} from "./kakao-callback-store";
import { type LogSink, log } from "./log";
import { createServices } from "./services";
import { readSettings } from "./settings";
import { createShopScope, isUuid, shopRequestDb } from "./shop-scope";

interface ConsumerOptions {
  readonly connect?: DbConnector;
  readonly now?: () => Date;
  readonly fetch?: typeof fetch;
  readonly logSink?: LogSink;
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

  const now = options.now ?? (() => new Date());
  const settings = readSettings(env);
  const services = createServices(env, settings);
  const conn = (options.connect ?? pgConnector)(settings.secrets.DATABASE_URL);
  const scope = createShopScope(job.shopId, { kind: "job", job: "kakao_callback" });
  const db = shopRequestDb(scope, conn);
  try {
    const claim = await claimKakaoCallback(db, job.messageId, now());
    if (claim === "busy") return "retry";
    if (claim === null) {
      await deferExpiredKakaoCallback(db, job.messageId, now(), KAKAO_CONSULTATION_UNAVAILABLE_TEXT);
      return "done";
    }

    let raw: string | undefined;
    try {
      raw = await openKakaoCallback(db, services.fieldCrypto(), claim);
    } catch (error) {
      if (!(error instanceof FieldCryptoError)) throw error;
    }

    const callback = kakaoCallback(raw, claim.created_at);
    const deliveredAt =
      callback !== null &&
      (await deliverKakaoCallback(
        { ...callback, deadline: Math.min(callback.deadline, claim.kakao_callback_deadline_at.getTime()) },
        KAKAO_CONSULTATION_UNAVAILABLE_TEXT,
        { now: () => now().getTime(), ...(options.fetch === undefined ? {} : { fetch: options.fetch }) },
      )) === "delivered"
        ? now()
        : null;
    await finishKakaoCallback(db, job.messageId, claim, KAKAO_CONSULTATION_UNAVAILABLE_TEXT, deliveredAt);
    return "done";
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
